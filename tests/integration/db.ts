/**
 * Shared Postgres client + fixture helpers for integration tests.
 *
 * Uses `postgres` (porsager/postgres) directly — bypassing supabase-js
 * lets each test inspect raw SQLSTATE codes from `raise exception` in
 * triggers, and gives us session-level GUC control (set local
 * app.admin_actor = ...) for the audit-trigger tests.
 *
 * Two roles in play per test:
 *   - service (default) — db owner / migration role; bypasses RLS.
 *     Used to seed fixtures and clean up.
 *   - asUser(id) — runs an inner block as `authenticated` with
 *     `request.jwt.claims` set so `auth.uid()` returns the given id.
 *     This is how RLS gets exercised end-to-end.
 */

import postgres, { type Sql } from 'postgres'
import { randomUUID } from 'node:crypto'

export function defaultDatabaseUrl(): string {
  return (
    process.env.INTEGRATION_DATABASE_URL ?? 'postgres://postgres:postgres@127.0.0.1:54322/postgres'
  )
}

let cached: Sql | null = null

export function getSql(): Sql {
  if (cached) return cached
  cached = postgres(defaultDatabaseUrl(), {
    max: 5,
    idle_timeout: 5,
    onnotice: () => {
      // pg_cron + extension notices are noisy and irrelevant to tests.
    },
  })
  return cached
}

export async function closeSql(): Promise<void> {
  if (!cached) return
  await cached.end({ timeout: 2 })
  cached = null
}

/**
 * Run `fn` with the session impersonating an authenticated user. RLS
 * policies that reference `auth.uid()` resolve to `userId` inside the
 * callback. Uses Supabase's standard GUC convention:
 *   set local role = 'authenticated';
 *   set local request.jwt.claims = '{"sub":"<userId>","role":"authenticated"}';
 * Returns whatever `fn` returns.
 */
export async function asUser<T>(userId: string, fn: (sql: Sql) => Promise<T>): Promise<T> {
  const sql = getSql()
  const result = await sql.begin(async (tx) => {
    // Some auth.uid() implementations read the singular GUC, some the
    // JSON blob. Set both so we don't have to detect the local stack
    // version per CI run.
    await tx.unsafe(`set local request.jwt.claim.sub = '${userId}'`)
    await tx.unsafe(
      `set local request.jwt.claims = '${JSON.stringify({ sub: userId, role: 'authenticated' })}'`
    )
    await tx.unsafe(`set local role = 'authenticated'`)
    return await fn(tx as unknown as Sql)
  })
  return result as T
}

/**
 * Insert a minimal auth.users + profiles pair and return its id. Tests
 * that just need a body should pass `null` for `referredBy`. The auth
 * row uses an encrypted_password placeholder; we never call gotrue so
 * the value is inert.
 */
export async function createTestUser(args: {
  email?: string
  credits?: number
  freeUsed?: number
  isVip?: boolean
  referredBy?: string | null
}): Promise<{ id: string; email: string }> {
  const sql = getSql()
  const id = randomUUID()
  const email = args.email ?? `int-${id.slice(0, 8)}@test.local`

  await sql.unsafe(
    `insert into auth.users (id, instance_id, email, encrypted_password, aud, role, raw_user_meta_data, raw_app_meta_data, created_at, updated_at)
     values ('${id}', '00000000-0000-0000-0000-000000000000', '${email}', '', 'authenticated', 'authenticated', '{}', '{}', now(), now())`
  )

  // handle_new_user trigger created the profile row; UPDATE it with the
  // test's desired starting state. Service-role bypasses RLS so we can
  // touch every column.
  await sql.unsafe(
    `update public.profiles
        set credits_balance = ${args.credits ?? 0},
            free_used_this_week = ${args.freeUsed ?? 0},
            is_vip = ${args.isVip ? 'true' : 'false'},
            referred_by = ${args.referredBy ? `'${args.referredBy}'` : 'null'}
      where id = '${id}'`
  )

  return { id, email }
}

/**
 * Insert a minimal trend row in a state safe for generations to attach
 * (active + passed eval) — for tests that exercise downstream triggers
 * without caring about the eval gate. Skip when testing the eval gate
 * itself.
 */
export async function createTestTrend(args: {
  slug?: string
  active?: boolean
  evalStatus?: 'untested' | 'passed' | 'failed'
}): Promise<{ id: string; slug: string }> {
  const sql = getSql()
  const id = randomUUID()
  const slug = args.slug ?? `int-trend-${id.slice(0, 8)}`
  const evalStatus = args.evalStatus ?? 'passed'
  const active = args.active ?? true

  // Bootstrap path: insert in untested+inactive, optionally add a pass
  // run, then transition. This works around the `trends_require_eval_proof`
  // trigger from migration 0024 which blocks passed-without-proof.
  await sql.unsafe(
    `insert into public.trends (id, slug, title, prompt_template, is_active, eval_status)
     values ('${id}', '${slug}', 'Integration Trend', 'apply trend to {{user_photo}}', false, 'untested')`
  )

  if (evalStatus === 'passed') {
    // Seed an input + a passing run for the proof trigger.
    const inputId = randomUUID()
    await sql.unsafe(
      `insert into public.trend_eval_inputs (id, trend_id, label, image_url)
       values ('${inputId}', '${id}', 'sample', 'https://example.test/sample.png')`
    )
    const runId = randomUUID()
    await sql.unsafe(
      `insert into public.trend_eval_runs (id, trend_id, prompt_version, eval_input_id, admin_rating, output_url)
       values ('${runId}', '${id}', 1, '${inputId}', 'pass', 'https://example.test/out.png')`
    )
    await sql.unsafe(`update public.trends set eval_status = 'passed' where id = '${id}'`)
  } else if (evalStatus === 'failed') {
    await sql.unsafe(`update public.trends set eval_status = 'failed' where id = '${id}'`)
  }

  if (active) {
    await sql.unsafe(`update public.trends set is_active = true where id = '${id}'`)
  }

  return { id, slug }
}

/**
 * Reset relevant tables to a known empty state before each test. Cheap
 * vs. transactional rollback because the trigger-fired audit/event rows
 * cross tables — easier to truncate.
 */
export async function resetTables(tables: string[]): Promise<void> {
  const sql = getSql()
  const list = tables.map((t) => `"public"."${t}"`).join(', ')
  await sql.unsafe(`truncate ${list} restart identity cascade`)
}
