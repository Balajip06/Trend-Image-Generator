import { NextResponse, type NextRequest } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Cursor refetch for realtime tables.
 *
 * A `postgres_changes` subscription cannot see rows written between the RSC
 * render and the moment the socket reaches SUBSCRIBED, and it misses everything
 * during a reconnect. `useRealtimeTable` closes both gaps by calling this route
 * with the newest `created_at` it holds and merging whatever came after.
 *
 * Generalized from the former `/api/admin/generations-sync`, which hardcoded a
 * single table. That route remains as a thin delegate so existing callers are
 * unaffected.
 */

/**
 * Tables this route may read, with the column set each exposes.
 *
 * A strict allowlist, NOT a passthrough: `table` arrives from the client, and
 * interpolating it into `.from()` unchecked would let any caller with an admin
 * session read any table the service role can reach. The column lists also keep
 * PII out of feeds that do not need it.
 */
type SyncableTable =
  | 'admin_generations_feed'
  | 'anonymous_attempts'
  | 'admin_audit_log'
  | 'trends'
  | 'referrals'
  | 'kimp_client_allowlist'
  | 'admin_marketing_spend'

const SYNCABLE_TABLES: Record<SyncableTable, string> = {
  admin_generations_feed: '*',
  anonymous_attempts: 'id, status, cost_usd, created_at, completed_at, trend_id',
  admin_audit_log: 'id, admin_id, action, target_table, target_id, before, after, created_at',
  trends:
    'id, slug, title, is_active, eval_status, model, display_order, version, updated_at, is_featured',
  referrals: 'id, status, created_at, rewarded_at',
  kimp_client_allowlist: 'id, email, kimp_subject_id, is_active, note, created_at, updated_at',
  admin_marketing_spend: 'id, week_start, channel, usd_spent, notes, created_at',
}

const MAX_ROWS = 50

export async function GET(request: NextRequest) {
  // Verify an admin session. `/api/admin/*` is NOT covered by the proxy's admin
  // gate (that only matches paths starting with `/admin`), so this check is the
  // only authorization on this route.
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })

  const service = createServiceClient()
  const { data: adminRow } = await service
    .from('admin_users')
    .select('user_id')
    .eq('user_id', user.id)
    .maybeSingle()
  if (!adminRow) return NextResponse.json({ error: 'forbidden' }, { status: 403 })

  const url = new URL(request.url)
  const table = url.searchParams.get('table') ?? 'admin_generations_feed'
  const since = url.searchParams.get('since')

  // Narrowing through the allowlist is what makes `table` safe to pass to
  // `.from()` — the generated types only accept known table names, so an
  // untyped `string` here would (correctly) fail to compile.
  if (!Object.hasOwn(SYNCABLE_TABLES, table)) {
    return NextResponse.json({ error: 'table not syncable' }, { status: 400 })
  }
  const syncable = table as SyncableTable
  const columns = SYNCABLE_TABLES[syncable]

  let query = service
    .from(syncable)
    .select(columns)
    .order('created_at', { ascending: false })
    .limit(MAX_ROWS)

  if (since) query = query.gt('created_at', since)

  const { data, error } = await query
  if (error) {
    return NextResponse.json({ error: error.message, rows: [] }, { status: 500 })
  }
  return NextResponse.json({ rows: data ?? [] })
}
