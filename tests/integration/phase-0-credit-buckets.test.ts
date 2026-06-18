import { beforeEach, describe, expect, it } from 'vitest'
import { createTestUser, getSql, resetTables, asUser } from './db'

/**
 * Phase 0 integration tests — credit-bucket migration (20260601000001–0003).
 *
 * Verifies:
 *  1. Schema: monthly_credits, purchased_credits, credits_balance columns exist.
 *  2. credits_balance is a GENERATED column = monthly_credits + purchased_credits.
 *  3. Lockdown trigger rejects user self-write of purchased_credits.
 *  4. Lockdown trigger rejects user self-write of monthly_credits.
 *  5. generation_tier enum contains 'monthly' and 'kimp' values.
 *  6. grant_credits RPC increments purchased_credits (non-expiring bucket).
 */
describe('Phase 0: credit bucket schema', () => {
  it('profiles has monthly_credits, purchased_credits, credits_balance columns', async () => {
    const sql = getSql()
    // Query pg catalog directly — no user needed.
    const rows = await sql<{ column_name: string; is_generated: string }[]>`
      select column_name, is_generated
      from information_schema.columns
      where table_schema = 'public'
        and table_name   = 'profiles'
        and column_name  in ('monthly_credits', 'purchased_credits', 'credits_balance')
      order by column_name
    `
    const names = rows.map((r) => r.column_name).sort()
    expect(names).toEqual(['credits_balance', 'monthly_credits', 'purchased_credits'])
  })

  it('credits_balance is ALWAYS GENERATED (not writable)', async () => {
    const sql = getSql()
    const [row] = await sql<{ is_generated: string; generation_expression: string }[]>`
      select is_generated, generation_expression
      from information_schema.columns
      where table_schema = 'public'
        and table_name   = 'profiles'
        and column_name  = 'credits_balance'
    `
    expect(row.is_generated).toBe('ALWAYS')
    expect(row.generation_expression).toMatch(/monthly_credits.*purchased_credits|purchased_credits.*monthly_credits/)
  })

  it('credits_balance equals monthly_credits + purchased_credits', async () => {
    const user = await createTestUser({})
    const sql = getSql()

    // Seed both buckets via service-role (bypasses RLS + trigger).
    await sql.unsafe(
      `update public.profiles
          set monthly_credits = 7, purchased_credits = 13
        where id = '${user.id}'`
    )

    const [profile] = await sql<{
      monthly_credits: number
      purchased_credits: number
      credits_balance: number
    }[]>`
      select monthly_credits, purchased_credits, credits_balance
      from public.profiles
      where id = ${user.id}
    `
    expect(profile.monthly_credits).toBe(7)
    expect(profile.purchased_credits).toBe(13)
    expect(profile.credits_balance).toBe(20)
  })
})

describe('Phase 0: grant_credits RPC', () => {
  beforeEach(async () => {
    await resetTables(['generations', 'profiles'])
    const sql = getSql()
    await sql.unsafe(`delete from auth.users where email like 'int-%@test.local'`)
  })

  it('grant_credits increments purchased_credits and credits_balance reflects the total', async () => {
    const user = await createTestUser({})
    const sql = getSql()

    await sql`
      select public.grant_credits(
        ${user.id}::uuid,
        10::int,
        'test'::text,
        'task-8-ref'::text
      )
    `

    const [profile] = await sql<{
      purchased_credits: number
      monthly_credits: number
      credits_balance: number
    }[]>`
      select purchased_credits, monthly_credits, credits_balance
      from public.profiles
      where id = ${user.id}
    `
    expect(profile.purchased_credits).toBe(10)
    expect(profile.monthly_credits).toBe(0)
    expect(profile.credits_balance).toBe(10)
  })

  it('grant_credits is additive — multiple calls accumulate', async () => {
    const user = await createTestUser({})
    const sql = getSql()

    await sql`select public.grant_credits(${user.id}::uuid, 5::int, 'test'::text, 'ref-1'::text)`
    await sql`select public.grant_credits(${user.id}::uuid, 3::int, 'test'::text, 'ref-2'::text)`

    const [profile] = await sql<{ purchased_credits: number }[]>`
      select purchased_credits from public.profiles where id = ${user.id}
    `
    expect(profile.purchased_credits).toBe(8)
  })
})

describe('Phase 0: lockdown — new credit columns are self-write-blocked', () => {
  beforeEach(async () => {
    await resetTables(['generations', 'profiles'])
    const sql = getSql()
    await sql.unsafe(`delete from auth.users where email like 'int-%@test.local'`)
  })

  it('rejects user self-update of purchased_credits', async () => {
    const user = await createTestUser({})

    await expect(
      asUser(user.id, async (tx) => {
        await tx`update public.profiles set purchased_credits = 9999 where id = ${user.id}`
      })
    ).rejects.toThrow(/purchased_credits is locked|check/i)

    const sql = getSql()
    const [profile] = await sql<{ purchased_credits: number }[]>`
      select purchased_credits from public.profiles where id = ${user.id}
    `
    expect(profile.purchased_credits).toBe(0)
  })

  it('rejects user self-update of monthly_credits', async () => {
    const user = await createTestUser({})

    await expect(
      asUser(user.id, async (tx) => {
        await tx`update public.profiles set monthly_credits = 9999 where id = ${user.id}`
      })
    ).rejects.toThrow(/monthly_credits is locked|check/i)

    const sql = getSql()
    const [profile] = await sql<{ monthly_credits: number }[]>`
      select monthly_credits from public.profiles where id = ${user.id}
    `
    expect(profile.monthly_credits).toBe(0)
  })

  it('service-role can write both bucket columns directly', async () => {
    const user = await createTestUser({})
    const sql = getSql()

    await sql`
      update public.profiles
        set monthly_credits = 5, purchased_credits = 15
      where id = ${user.id}
    `

    const [profile] = await sql<{
      monthly_credits: number
      purchased_credits: number
      credits_balance: number
    }[]>`
      select monthly_credits, purchased_credits, credits_balance
      from public.profiles where id = ${user.id}
    `
    expect(profile.monthly_credits).toBe(5)
    expect(profile.purchased_credits).toBe(15)
    expect(profile.credits_balance).toBe(20)
  })
})

describe('Phase 0: generation_tier enum', () => {
  it("enum includes 'monthly' value", async () => {
    const sql = getSql()
    const rows = await sql<{ enumlabel: string }[]>`
      select enumlabel
      from pg_enum
      join pg_type on pg_enum.enumtypid = pg_type.oid
      where pg_type.typname = 'generation_tier'
        and enumlabel = 'monthly'
    `
    expect(rows).toHaveLength(1)
    expect(rows[0].enumlabel).toBe('monthly')
  })

  it("enum includes 'kimp' value", async () => {
    const sql = getSql()
    const rows = await sql<{ enumlabel: string }[]>`
      select enumlabel
      from pg_enum
      join pg_type on pg_enum.enumtypid = pg_type.oid
      where pg_type.typname = 'generation_tier'
        and enumlabel = 'kimp'
    `
    expect(rows).toHaveLength(1)
    expect(rows[0].enumlabel).toBe('kimp')
  })

  it('enum contains the full expected set of values', async () => {
    const sql = getSql()
    const rows = await sql<{ enumlabel: string }[]>`
      select enumlabel
      from pg_enum
      join pg_type on pg_enum.enumtypid = pg_type.oid
      where pg_type.typname = 'generation_tier'
      order by enumlabel
    `
    const labels = rows.map((r) => r.enumlabel)
    expect(labels).toContain('monthly')
    expect(labels).toContain('kimp')
    expect(labels).toContain('credit')
    expect(labels).toContain('free')
    expect(labels).toContain('vip')
  })
})
