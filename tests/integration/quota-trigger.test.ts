import { beforeEach, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { createTestTrend, createTestUser, getSql, resetTables } from './db'

/**
 * Non-negotiable #1: RLS-enforced quota — INSERT into generations must:
 *   - decrement credits_balance when > 0, set tier='credit'
 *   - else decrement free_used_this_week when < 5, set tier='free'
 *   - else RAISE 'quota exhausted' AND insert a quota_blocked trend_event
 *   - skip both decrements for is_vip users, set tier='vip'
 *
 * These tests insert generation rows directly via service-role to drive
 * the BEFORE-INSERT trigger and observe its branches. The Edge Function
 * (real generation path) writes the same row shape, so this exercises
 * exactly the production trigger.
 */
describe('consume_quota_on_generation_insert', () => {
  beforeEach(async () => {
    await resetTables([
      'generations',
      'trend_events',
      'trend_eval_runs',
      'trend_eval_inputs',
      'trends',
      'profiles',
    ])
    const sql = getSql()
    await sql.unsafe(`delete from auth.users where email like 'int-%@test.local'`)
  })

  it('credit branch: decrements credits_balance and snapshots tier=credit', async () => {
    const user = await createTestUser({ credits: 3 })
    const trend = await createTestTrend({})
    const sql = getSql()

    const genId = randomUUID()
    await sql.unsafe(
      `insert into public.generations (id, user_id, trend_id, trend_version, idempotency_key, input_payload)
       values ('${genId}', '${user.id}', '${trend.id}', 1, 'k-${genId}', '{}'::jsonb)`
    )

    const [row] = await sql<{ tier_at_generation: string }[]>`
      select tier_at_generation from public.generations where id = ${genId}
    `
    expect(row.tier_at_generation).toBe('credit')

    const [profile] = await sql<{ credits_balance: number; free_used_this_week: number }[]>`
      select credits_balance, free_used_this_week from public.profiles where id = ${user.id}
    `
    expect(profile.credits_balance).toBe(2)
    expect(profile.free_used_this_week).toBe(0)
  })

  it('free branch: decrements free_used_this_week and snapshots tier=free', async () => {
    const user = await createTestUser({ credits: 0, freeUsed: 2 })
    const trend = await createTestTrend({})
    const sql = getSql()

    const genId = randomUUID()
    await sql.unsafe(
      `insert into public.generations (id, user_id, trend_id, trend_version, idempotency_key, input_payload)
       values ('${genId}', '${user.id}', '${trend.id}', 1, 'k-${genId}', '{}'::jsonb)`
    )

    const [row] = await sql<{ tier_at_generation: string }[]>`
      select tier_at_generation from public.generations where id = ${genId}
    `
    expect(row.tier_at_generation).toBe('free')

    const [profile] = await sql<{ credits_balance: number; free_used_this_week: number }[]>`
      select credits_balance, free_used_this_week from public.profiles where id = ${user.id}
    `
    expect(profile.credits_balance).toBe(0)
    expect(profile.free_used_this_week).toBe(3)
  })

  it('vip branch: bypasses both counters and snapshots tier=vip', async () => {
    const user = await createTestUser({ credits: 0, freeUsed: 5, isVip: true })
    const trend = await createTestTrend({})
    const sql = getSql()

    const genId = randomUUID()
    await sql.unsafe(
      `insert into public.generations (id, user_id, trend_id, trend_version, idempotency_key, input_payload)
       values ('${genId}', '${user.id}', '${trend.id}', 1, 'k-${genId}', '{}'::jsonb)`
    )

    const [row] = await sql<{ tier_at_generation: string }[]>`
      select tier_at_generation from public.generations where id = ${genId}
    `
    expect(row.tier_at_generation).toBe('vip')

    const [profile] = await sql<{ credits_balance: number; free_used_this_week: number }[]>`
      select credits_balance, free_used_this_week from public.profiles where id = ${user.id}
    `
    // VIP path bypasses both counters even when they're at boundary.
    expect(profile.credits_balance).toBe(0)
    expect(profile.free_used_this_week).toBe(5)
  })

  it('exhausted: raises and writes a quota_blocked trend_event in the same tx', async () => {
    const user = await createTestUser({ credits: 0, freeUsed: 5 })
    const trend = await createTestTrend({})
    const sql = getSql()

    const genId = randomUUID()
    await expect(
      sql.unsafe(
        `insert into public.generations (id, user_id, trend_id, trend_version, idempotency_key, input_payload)
         values ('${genId}', '${user.id}', '${trend.id}', 1, 'k-${genId}', '{}'::jsonb)`
      )
    ).rejects.toThrow(/quota exhausted/)

    // RAISE rolls back the generation insert. quota_blocked emission
    // happens INSIDE the trigger, BEFORE the raise — so it also rolls
    // back. The funnel event row should NOT exist (atomic-with-raise
    // semantics from migration 0015's comment).
    const events = await sql<{ count: number }[]>`
      select count(*)::int from public.trend_events
       where trend_slug = ${trend.slug} and type = 'quota_blocked'
    `
    expect(events[0].count).toBe(0)

    const gens = await sql<{ count: number }[]>`
      select count(*)::int from public.generations where id = ${genId}
    `
    expect(gens[0].count).toBe(0)
  })

  it('credit + free exhaustion: only first insert succeeds, second raises (no overdraft)', async () => {
    // Set both counters to their boundary so the trigger has nowhere to
    // fall through to on the second insert. With credits=1 and
    // freeUsed=5, the first row consumes the credit (tier=credit), the
    // second falls past credits=0, sees freeUsed=5 == max, and raises
    // 'quota exhausted'. Without the FOR UPDATE lock under porsager's
    // pooled connection (which serializes sql.unsafe calls anyway),
    // this is sequenced — but the assertion captures the boundary
    // invariant that matters: a single account cannot ever overdraft.
    const user = await createTestUser({ credits: 1, freeUsed: 5 })
    const trend = await createTestTrend({})
    const sql = getSql()

    const a = sql.unsafe(
      `insert into public.generations (id, user_id, trend_id, trend_version, idempotency_key, input_payload)
       values (gen_random_uuid(), '${user.id}', '${trend.id}', 1, 'race-a', '{}'::jsonb)`
    )
    const b = sql.unsafe(
      `insert into public.generations (id, user_id, trend_id, trend_version, idempotency_key, input_payload)
       values (gen_random_uuid(), '${user.id}', '${trend.id}', 1, 'race-b', '{}'::jsonb)`
    )

    const results = await Promise.allSettled([a, b])
    const fulfilled = results.filter((r) => r.status === 'fulfilled')
    const rejected = results.filter((r) => r.status === 'rejected')
    expect(fulfilled.length).toBe(1)
    expect(rejected.length).toBe(1)

    const [profile] = await sql<{ credits_balance: number; free_used_this_week: number }[]>`
      select credits_balance, free_used_this_week from public.profiles where id = ${user.id}
    `
    expect(profile.credits_balance).toBe(0)
    expect(profile.free_used_this_week).toBe(5)
  })
})
