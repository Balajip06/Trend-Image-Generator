import { beforeEach, describe, expect, it } from 'vitest'
import { asUser, createTestUser, getSql, resetTables } from './db'

/**
 * Red-team C1: `profiles_self_update` column lockdown via the
 * `enforce_profiles_self_update_lockdown` BEFORE UPDATE trigger
 * (migration 0029, which replaced 0020's broken WITH CHECK approach).
 *
 * The trigger RAISES a check_violation (SQLSTATE 42501 at RLS layer,
 * P0001 at trigger layer — Postgres reports the wrapped error to the
 * client). Tests assert the SQL call rejects rather than checking a
 * zero-row return — the broken 0020 approach silently allowed the
 * mutation, the 0029 approach hard-rejects.
 */
describe('profiles_self_update column lockdown', () => {
  beforeEach(async () => {
    await resetTables(['generations', 'profiles'])
    const sql = getSql()
    await sql.unsafe(`delete from auth.users where email like 'int-%@test.local'`)
  })

  it('blocks user from self-granting is_vip', async () => {
    const user = await createTestUser({ credits: 0 })

    await expect(
      asUser(user.id, async (tx) => {
        await tx`update public.profiles set is_vip = true where id = ${user.id}`
      })
    ).rejects.toThrow(/is_vip is locked|check/i)

    const sql = getSql()
    const [profile] = await sql<{ is_vip: boolean }[]>`
      select is_vip from public.profiles where id = ${user.id}
    `
    expect(profile.is_vip).toBe(false)
  })

  it('blocks user from self-incrementing credits_balance', async () => {
    const user = await createTestUser({ credits: 0 })

    await expect(
      asUser(user.id, async (tx) => {
        await tx`update public.profiles set credits_balance = 99 where id = ${user.id}`
      })
    ).rejects.toThrow(/credits_balance is locked|check/i)

    const sql = getSql()
    const [profile] = await sql<{ credits_balance: number }[]>`
      select credits_balance from public.profiles where id = ${user.id}
    `
    expect(profile.credits_balance).toBe(0)
  })

  it('blocks user from zeroing free_used_this_week', async () => {
    const user = await createTestUser({ credits: 0, freeUsed: 5 })

    await expect(
      asUser(user.id, async (tx) => {
        await tx`update public.profiles set free_used_this_week = 0 where id = ${user.id}`
      })
    ).rejects.toThrow(/free_used_this_week is locked|check/i)

    const sql = getSql()
    const [profile] = await sql<{ free_used_this_week: number }[]>`
      select free_used_this_week from public.profiles where id = ${user.id}
    `
    expect(profile.free_used_this_week).toBe(5)
  })

  it('allows user to update their own name + avatar_url', async () => {
    const user = await createTestUser({})

    await asUser(user.id, async (tx) => {
      await tx`update public.profiles set name = 'Updated', avatar_url = 'https://example.test/a.png' where id = ${user.id}`
    })

    const sql = getSql()
    const [profile] = await sql<{ name: string | null; avatar_url: string | null }[]>`
      select name, avatar_url from public.profiles where id = ${user.id}
    `
    expect(profile.name).toBe('Updated')
    expect(profile.avatar_url).toBe('https://example.test/a.png')
  })

  it('allows user to soft-delete via null→timestamp transition', async () => {
    const user = await createTestUser({})

    await asUser(user.id, async (tx) => {
      await tx`update public.profiles set deleted_at = now() where id = ${user.id}`
    })

    const sql = getSql()
    const [profile] = await sql<{ deleted_at: string | null }[]>`
      select deleted_at from public.profiles where id = ${user.id}
    `
    expect(profile.deleted_at).not.toBeNull()
  })

  it('blocks user from clearing deleted_at once stamped (resurrection)', async () => {
    const user = await createTestUser({})
    const sql = getSql()
    await sql`update public.profiles set deleted_at = now() where id = ${user.id}`

    // USING clause rejects pre-image with deleted_at set, so the row is
    // not visible to the UPDATE at all → 0 rows affected, no raise.
    // (The trigger only fires on rows that pass RLS USING.)
    await asUser(user.id, async (tx) => {
      const result = await tx<{ count: number }[]>`
        with upd as (
          update public.profiles set deleted_at = null where id = ${user.id} returning 1
        )
        select count(*)::int from upd
      `
      expect(result[0].count).toBe(0)
    })

    const [profile] = await sql<{ deleted_at: string | null }[]>`
      select deleted_at from public.profiles where id = ${user.id}
    `
    expect(profile.deleted_at).not.toBeNull()
  })

  it('service-role still mutates locked columns (the legitimate credit-grant path)', async () => {
    const user = await createTestUser({ credits: 0 })

    const sql = getSql()
    await sql`update public.profiles set credits_balance = 50 where id = ${user.id}`

    const [profile] = await sql<{ credits_balance: number }[]>`
      select credits_balance from public.profiles where id = ${user.id}
    `
    expect(profile.credits_balance).toBe(50)
  })
})
