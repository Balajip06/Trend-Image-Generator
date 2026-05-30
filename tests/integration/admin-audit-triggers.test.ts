import { beforeEach, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { createTestUser, getSql, resetTables } from './db'

/**
 * Red-team C4: admin_audit_log writes must originate from DB triggers,
 * not call-site code paths. Tests cover both attribution channels:
 *   - auth.uid() when the mutation runs via authed JWT
 *   - current_setting('app.admin_actor', true) when service-role
 */
describe('admin_audit_log triggers', () => {
  beforeEach(async () => {
    await resetTables([
      'admin_audit_log',
      'trend_eval_runs',
      'trend_eval_inputs',
      'trends',
      'generations',
      'profiles',
    ])
    const sql = getSql()
    await sql.unsafe(`delete from auth.users where email like 'int-%@test.local'`)
  })

  it('writes a trend_create audit row on INSERT', async () => {
    const sql = getSql()
    const trendId = randomUUID()
    await sql.unsafe(
      `insert into public.trends (id, slug, title, prompt_template)
       values ('${trendId}', 'audit-create', 't', 'p')`
    )

    const rows = await sql<{ action: string; target_id: string }[]>`
      select action, target_id from public.admin_audit_log where target_table = 'trends' and target_id = ${trendId}
    `
    expect(rows.length).toBe(1)
    expect(rows[0].action).toBe('trend_create')
  })

  it('writes a trend_is_active_change row on is_active flip', async () => {
    const sql = getSql()
    const trendId = randomUUID()
    await sql.unsafe(
      `insert into public.trends (id, slug, title, prompt_template, eval_status)
       values ('${trendId}', 'audit-active', 't', 'p', 'untested')`
    )
    // Seed pass + transition to passed to satisfy proof trigger before activating.
    const inputId = randomUUID()
    await sql.unsafe(
      `insert into public.trend_eval_inputs (id, trend_id, label, image_url)
       values ('${inputId}', '${trendId}', 'l', 'https://example.test/i.png')`
    )
    await sql.unsafe(
      `insert into public.trend_eval_runs (id, trend_id, prompt_version, eval_input_id, admin_rating)
       values (gen_random_uuid(), '${trendId}', 1, '${inputId}', 'pass')`
    )
    await sql.unsafe(`update public.trends set eval_status = 'passed' where id = '${trendId}'`)
    await sql.unsafe(`update public.trends set is_active = true where id = '${trendId}'`)

    const rows = await sql<{ action: string }[]>`
      select action from public.admin_audit_log where target_id = ${trendId} order by created_at asc
    `
    const actions = rows.map((r) => r.action)
    expect(actions).toContain('trend_create')
    expect(actions).toContain('trend_eval_status_change')
    expect(actions).toContain('trend_is_active_change')
  })

  it('writes vip_grant + vip_revoke on profiles.is_vip flip', async () => {
    const user = await createTestUser({})
    const sql = getSql()

    await sql`update public.profiles set is_vip = true where id = ${user.id}`
    await sql`update public.profiles set is_vip = false where id = ${user.id}`

    const rows = await sql<{ action: string }[]>`
      select action from public.admin_audit_log where target_id = ${user.id} order by created_at asc
    `
    const actions = rows.map((r) => r.action)
    expect(actions).toContain('vip_grant')
    expect(actions).toContain('vip_revoke')
  })

  it('captures actor from app.admin_actor GUC for service-role writes', async () => {
    const actor = await createTestUser({})
    const user = await createTestUser({})
    const sql = getSql()

    await sql.begin(async (tx) => {
      await tx.unsafe(`set local app.admin_actor = '${actor.id}'`)
      await tx.unsafe(`update public.profiles set is_vip = true where id = '${user.id}'`)
    })

    const rows = await sql<{ admin_id: string | null }[]>`
      select admin_id from public.admin_audit_log
       where target_id = ${user.id} and action = 'vip_grant'
    `
    expect(rows.length).toBe(1)
    expect(rows[0].admin_id).toBe(actor.id)
  })

  it('does NOT write on no-op update where is_vip is unchanged', async () => {
    const user = await createTestUser({ isVip: true })
    const sql = getSql()

    // createTestUser flipped is_vip false→true via setup; that legitimately
    // fired a vip_grant audit row. Clear the log so the assertion below
    // measures only what the no-op update produced.
    await sql`delete from public.admin_audit_log where target_id = ${user.id}`

    // Touch a different column. The trigger guards on `is_vip is not distinct`.
    await sql`update public.profiles set name = 'noop' where id = ${user.id}`

    const rows = await sql<{ count: number }[]>`
      select count(*)::int from public.admin_audit_log
       where target_id = ${user.id} and action in ('vip_grant','vip_revoke')
    `
    expect(rows[0].count).toBe(0)
  })
})
