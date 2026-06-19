# Phase 4 — Realtime Admin

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the admin panel show live operational data — a live generations monitor (authed + anonymous), realtime `trend_suggestions` inbox, and auto-refresh for all other admin surfaces — without streaming PII/Stripe data to browsers.

**Architecture:** Hybrid approach: true Realtime (Supabase postgres_changes) only for `admin_generations_feed` (new trigger-populated table, PII excluded) + `trend_suggestions` + `anonymous_attempts`, all gated by an `is_admin()` RLS function. All other admin pages get a lightweight `AutoRefresh` client component (`useRouter().refresh()` + `visibilitychange`). The base `generations` table stays published (ResultView depends on it) but is NOT set to `replica identity full` — a separate `admin_generations_feed` table carries the monitor feed. `AutoRefresh` is placed only on pure-RSC pages (no realtime hook) to avoid the RSC-vs-useState sync issue (H-RT3).

**Tech Stack:** Next.js 16 App Router, React 19, Supabase Realtime (postgres_changes), TypeScript strict, Vitest.

## Global Constraints

- Migration files: `20260605NNNNNN_<slug>.sql`.
- All PL/pgSQL functions: `security definer set search_path = public`.
- `is_admin()` function: arg-free, uses `auth.uid()` internally, `revoke from public`, `grant to authenticated` (H-S13).
- `admin_generations_feed` DOES get `replica identity full` (needed for UPDATE payloads in monitor).
- Base `generations` table stays in publication, NOT set to `replica identity full` (H-R1/H-RT1: ResultView depends on it; no PII broadcast since `replica identity default = PK only` for updates).
- `AutoRefresh` is placed per-page, NOT in AdminShell (H-RT3: would conflict with realtime hook state).
- `useRealtimeTable` hook reconciles the RSC/subscribe gap: after `SUBSCRIBED`, refetch with a `created_at >` high-water cursor via a Route Handler (H-R2).
- Reconnect backfill: on `wasSubscribedRef.current === true` + new `SUBSCRIBED`, run the same cursor refetch (H-R3).
- Merge monitor rows by `{source, id}` (not just `id`) to avoid UUID collision between `admin_generations_feed` and `anonymous_attempts` (H-RT2).
- `service-role key never reaches the browser` — all browser subscriptions use the publishable key with `is_admin()` RLS (H-R1).
- `pnpm typecheck` → `npx tsc --noEmit`; `npx vitest run` 570/572; `npx next build` passing.

---

## File Map

**Create (migrations):**

- `supabase/migrations/20260605000001_admin_realtime.sql` — `is_admin()` function, `admin_generations_feed` table + trigger + RLS + publication, `trend_suggestions` + `anonymous_attempts` admin SELECT RLS

**Create (lib + components):**

- `lib/realtime/useRealtimeTable.ts` — reusable hook with SUBSCRIBED refetch + reconnect backfill + two-tier eviction
- `lib/realtime/AutoRefresh.tsx` — `useRouter().refresh()` on interval + visibilitychange
- `app/admin/(authed)/generations/page.tsx` — RSC + initial 100 rows
- `app/admin/(authed)/generations/GenerationsMonitor.tsx` — client component subscribing to both channels
- `app/api/admin/generations-sync/route.ts` — Route Handler for cursor refetch (service-role, admin-gated)

**Modify:**

- `app/admin/(authed)/suggestions/page.tsx` — add realtime via `useRealtimeTable`
- `app/admin/(authed)/page.tsx` — add `AutoRefresh`
- `app/admin/(authed)/margin/page.tsx` — add `AutoRefresh`
- `app/admin/(authed)/quota-blocks/page.tsx` — add `AutoRefresh` (now emitting live events)
- `components/admin/AdminShell.tsx` — add Generations nav item
- `app/(app)/result/[id]/ResultView.tsx` — fix missed-events window (SUBSCRIBED refetch)

---

## Task 1 — Realtime migration: is_admin(), feed table, RLS policies

**Files:**

- Create: `supabase/migrations/20260605000001_admin_realtime.sql`

- [ ] **Step 1: Write the migration**

```sql
-- 20260605000001_admin_realtime.sql
-- Phase 4: realtime foundation for admin panel.
-- is_admin(): arg-free RLS helper for admin-gated Realtime channels.
-- admin_generations_feed: trigger-populated summary table for the live monitor.
--   PII excluded (no input_payload, no user email). replica identity full so
--   UPDATE payloads carry full row (needed for status transitions in monitor).
-- generations stays in supabase_realtime publication unchanged (ResultView depends on it).
-- trend_suggestions + anonymous_attempts get admin SELECT RLS for realtime.

-- 1. is_admin() helper (H-S13: arg-free, revoke from public)
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admin_users where user_id = auth.uid())
$$;

revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated;

-- 2. admin_generations_feed: PII-free summary of generations for the live monitor.
--    Populated by AFTER INSERT/UPDATE trigger on generations.
--    Includes model, status, cost, attempts, error — NOT input_payload or output_image_url.
create table public.admin_generations_feed (
  id              uuid primary key,  -- same id as generations.id
  generation_id   uuid unique not null references public.generations(id) on delete cascade,
  user_id         uuid not null,
  trend_id        uuid,
  trend_slug      text,
  status          public.generation_status not null,
  tier            public.generation_tier,
  model_used      text,
  cost_usd        numeric(10,5) not null default 0,
  attempts        int not null default 0,
  error_reason    text,  -- generic error category, not raw error_message
  kimp_client_id  text,
  created_at      timestamptz not null,
  completed_at    timestamptz,
  updated_at      timestamptz not null default now()
);

-- replica identity full: UPDATE payloads carry full old+new row for the monitor
alter table public.admin_generations_feed replica identity full;

alter table public.admin_generations_feed enable row level security;

-- Admin-only SELECT (browser Realtime uses this)
create policy "admin_generations_feed_admin_read" on public.admin_generations_feed
  for select using (public.is_admin());

-- Add to supabase_realtime publication
alter publication supabase_realtime add table public.admin_generations_feed;

-- 3. Trigger to populate admin_generations_feed on generations INSERT/UPDATE
create or replace function public.sync_admin_generations_feed()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_slug        text;
  v_error_cat   text;
begin
  -- Resolve trend slug (cached on the feed row to avoid join in monitor)
  select slug into v_slug from public.trends where id = new.trend_id;

  -- Categorize error without leaking full message
  v_error_cat := case
    when new.error_message ilike 'safety:%' then 'safety'
    when new.error_message ilike '%timeout%' or new.error_message ilike '%timed out%' then 'timeout'
    when new.error_message ilike 'terminal after%' then 'transient'
    when new.error_message is not null then 'error'
    else null
  end;

  insert into public.admin_generations_feed (
    id, generation_id, user_id, trend_id, trend_slug,
    status, tier, model_used, cost_usd, attempts, error_reason,
    kimp_client_id, created_at, completed_at, updated_at
  ) values (
    new.id, new.id, new.user_id, new.trend_id, v_slug,
    new.status, new.tier_at_generation, new.model_used, new.cost_usd,
    new.attempts, v_error_cat, new.kimp_client_id, new.created_at, new.completed_at, now()
  )
  on conflict (generation_id) do update set
    status       = excluded.status,
    tier         = excluded.tier,
    model_used   = coalesce(excluded.model_used, admin_generations_feed.model_used),
    cost_usd     = excluded.cost_usd,
    attempts     = excluded.attempts,
    error_reason = excluded.error_reason,
    completed_at = excluded.completed_at,
    updated_at   = now();

  return new;
end;
$$;

drop trigger if exists generations_sync_admin_feed on public.generations;
create trigger generations_sync_admin_feed
  after insert or update on public.generations
  for each row execute function public.sync_admin_generations_feed();

-- 4. trend_suggestions admin SELECT (enables Realtime for admin inbox)
create policy "trend_suggestions_admin_read" on public.trend_suggestions
  for select using (public.is_admin());

-- Add to publication (PK-only replica identity — payload is jsonb, don't broadcast full row H-R9)
alter publication supabase_realtime add table public.trend_suggestions;

-- 5. anonymous_attempts admin SELECT (enables monitor visibility into anon funnel H-R5)
create policy "anonymous_attempts_admin_read" on public.anonymous_attempts
  for select using (public.is_admin());

alter publication supabase_realtime add table public.anonymous_attempts;

-- Indexes for the monitor's initial query
create index admin_feed_created_idx on public.admin_generations_feed(created_at desc);
create index admin_feed_status_idx  on public.admin_generations_feed(status) where status in ('pending','processing','failed_retryable');
```

- [ ] **Step 2: Apply and verify**

```bash
./node_modules/.bin/supabase db reset
./node_modules/.bin/supabase db query "SELECT table_name FROM information_schema.tables WHERE table_name = 'admin_generations_feed';" 2>&1
./node_modules/.bin/supabase db query "SELECT proname FROM pg_proc WHERE proname = 'is_admin';" 2>&1
```

Expected: table + function found.

- [ ] **Step 3: Run tests**

```bash
npx vitest run
```

Expected: 570/572.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260605000001_admin_realtime.sql
git commit -m "feat(db): is_admin() helper, admin_generations_feed with trigger, realtime RLS for admin"
```

---

## Task 2 — useRealtimeTable hook + AutoRefresh component

**Files:**

- Create: `lib/realtime/useRealtimeTable.ts`
- Create: `lib/realtime/AutoRefresh.tsx`
- Create: `app/api/admin/generations-sync/route.ts`

- [ ] **Step 1: Write `lib/realtime/useRealtimeTable.ts`**

```typescript
'use client'

/**
 * Generic Supabase Realtime hook for table-level postgres_changes subscriptions.
 * Handles:
 * - SUBSCRIBED gap: refetches rows newer than the initial snapshot's high-water mark (H-R2)
 * - Reconnect backfill: same refetch on re-SUBSCRIBED after a network drop (H-R3)
 * - Two-tier eviction: never evicts in-flight rows; caps terminal history by time (H-R7)
 * - No status filter on subscription: subscribe broad, window client-side (H-R6)
 *
 * The refetch goes through an admin Route Handler (service-role) for admin tables,
 * or directly via the RLS-scoped browser client for consumer tables.
 */

import { useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

export type RealtimeEvent = 'INSERT' | 'UPDATE' | 'DELETE' | '*'

interface UseRealtimeTableOptions<Row extends { id: string; created_at?: string }> {
  table: string
  schema?: string
  event?: RealtimeEvent
  filter?: string
  initial: Row[]
  /** Route Handler URL for post-SUBSCRIBED cursor refetch. Must return { rows: Row[] }. */
  syncUrl?: string
  /** Column to key eviction tiers on (defaults to 'status') */
  statusKey?: keyof Row
  /** Values of statusKey considered "in-flight" — never evicted */
  inFlightValues?: string[]
  /** Max age (ms) for terminal rows in history tier (default: 5 minutes) */
  terminalMaxAgeMs?: number
}

export function useRealtimeTable<
  Row extends { id: string; created_at?: string; [key: string]: unknown },
>({
  table,
  schema = 'public',
  event = '*',
  filter,
  initial,
  syncUrl,
  statusKey = 'status' as keyof Row,
  inFlightValues = ['pending', 'processing', 'failed_retryable'],
  terminalMaxAgeMs = 5 * 60 * 1000,
}: UseRealtimeTableOptions<Row>): Row[] {
  const [rows, setRows] = useState<Map<string, Row>>(() => new Map(initial.map((r) => [r.id, r])))
  const wasSubscribedRef = useRef(false)
  const highWaterRef = useRef<string | null>(
    initial.length > 0
      ? initial.reduce((max, r) => (r.created_at && r.created_at > max ? r.created_at : max), '')
      : null
  )

  const upsert = (newRow: Row) =>
    setRows((prev) => {
      const next = new Map(prev)
      next.set(newRow.id, { ...(prev.get(newRow.id) ?? {}), ...newRow })
      return evict(next, statusKey, inFlightValues, terminalMaxAgeMs)
    })

  const remove = (id: string) =>
    setRows((prev) => {
      const next = new Map(prev)
      next.delete(id)
      return next
    })

  const reconcile = async () => {
    if (!syncUrl) return
    try {
      const cursor = highWaterRef.current
      const url = cursor ? `${syncUrl}?since=${encodeURIComponent(cursor)}` : syncUrl
      const res = await fetch(url)
      if (!res.ok) return
      const { rows: fresh } = (await res.json()) as { rows: Row[] }
      setRows((prev) => {
        const next = new Map(prev)
        for (const r of fresh) {
          next.set(r.id, { ...(prev.get(r.id) ?? {}), ...r })
          if (r.created_at && (!highWaterRef.current || r.created_at > highWaterRef.current)) {
            highWaterRef.current = r.created_at
          }
        }
        return evict(next, statusKey, inFlightValues, terminalMaxAgeMs)
      })
    } catch {
      /* silent — best-effort reconcile */
    }
  }

  useEffect(() => {
    const supabase = createClient()
    const channelName = filter ? `rt-${table}-${filter}` : `rt-${table}`

    const channel = supabase
      .channel(channelName)
      .on(
        'postgres_changes',
        { event, schema, table, ...(filter ? { filter } : {}) },
        (payload) => {
          if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
            const r = payload.new as Row
            upsert(r)
            if (r.created_at && (!highWaterRef.current || r.created_at > highWaterRef.current)) {
              highWaterRef.current = r.created_at
            }
          } else if (payload.eventType === 'DELETE') {
            remove((payload.old as { id: string }).id)
          }
        }
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          if (wasSubscribedRef.current) {
            // Reconnect — backfill missed events (H-R3)
            void reconcile()
          } else {
            // First subscribe — cover the RSC→SUBSCRIBED gap (H-R2)
            wasSubscribedRef.current = true
            void reconcile()
          }
        }
      })

    return () => {
      void supabase.removeChannel(channel)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [table, schema, event, filter, syncUrl])

  return Array.from(rows.values())
}

function evict<Row extends { id: string; created_at?: string; [key: string]: unknown }>(
  rows: Map<string, Row>,
  statusKey: keyof Row,
  inFlightValues: string[],
  terminalMaxAgeMs: number
): Map<string, Row> {
  const cutoff = Date.now() - terminalMaxAgeMs
  const next = new Map<string, Row>()
  for (const [id, row] of rows) {
    const status = row[statusKey] as string | undefined
    const isInFlight = !status || inFlightValues.includes(status)
    if (isInFlight) {
      next.set(id, row) // never evict in-flight
    } else {
      const age = row.created_at ? Date.now() - new Date(row.created_at).getTime() : 0
      if (age <= terminalMaxAgeMs + 60_000) {
        // 1-min buffer over the cutoff
        next.set(id, row)
      }
    }
  }
  return next
}
```

- [ ] **Step 2: Write `lib/realtime/AutoRefresh.tsx`**

```typescript
'use client'

/**
 * AutoRefresh: calls router.refresh() on a timer and on tab visibility restore.
 * Only for PURE RSC pages (no realtime hook). Do NOT put in AdminShell (H-RT3).
 *
 * Usage: <AutoRefresh intervalMs={30_000} />
 */

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

interface AutoRefreshProps {
  intervalMs?: number
}

export function AutoRefresh({ intervalMs = 30_000 }: AutoRefreshProps) {
  const router = useRouter()

  useEffect(() => {
    let id: ReturnType<typeof setInterval> | null = null

    const start = () => {
      id = setInterval(() => router.refresh(), intervalMs)
    }
    const stop = () => {
      if (id) {
        clearInterval(id)
        id = null
      }
    }

    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        router.refresh() // immediate refresh on tab focus
        start()
      } else {
        stop()
      }
    }

    start()
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      stop()
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [router, intervalMs])

  return null
}
```

- [ ] **Step 3: Write `app/api/admin/generations-sync/route.ts`**

```typescript
import { NextResponse, type NextRequest } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  // Verify admin session
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
  const since = url.searchParams.get('since')

  // Return rows newer than the cursor (covers the RSC/subscribe gap)
  let query = service
    .from('admin_generations_feed')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(50)

  if (since) {
    query = query.gt('created_at', since)
  }

  const { data } = await query
  return NextResponse.json({ rows: data ?? [] })
}
```

- [ ] **Step 4: Run typecheck + tests**

```bash
npx tsc --noEmit && npx vitest run
```

Expected: clean, 570/572.

- [ ] **Step 5: Commit**

```bash
git add lib/realtime/useRealtimeTable.ts lib/realtime/AutoRefresh.tsx \
        app/api/admin/generations-sync/route.ts
git commit -m "feat(realtime): useRealtimeTable hook with gap-fill + reconnect; AutoRefresh component"
```

---

## Task 3 — Live generations monitor page

**Files:**

- Create: `app/admin/(authed)/generations/page.tsx`
- Create: `app/admin/(authed)/generations/GenerationsMonitor.tsx`
- Modify: `components/admin/AdminShell.tsx`

- [ ] **Step 1: Write `page.tsx` (RSC)**

```typescript
import { createServiceClient } from '@/lib/supabase/server'
import { GenerationsMonitor } from './GenerationsMonitor'

export const dynamic = 'force-dynamic'

export default async function GenerationsPage() {
  const service = createServiceClient()

  // Initial 100 rows from admin_generations_feed (authed gens)
  const { data: feedRows } = await service
    .from('admin_generations_feed')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(100)

  // Initial 50 rows from anonymous_attempts
  const { data: anonRows } = await service
    .from('anonymous_attempts')
    .select('id, status, cost_usd, created_at, completed_at, trend_id')
    .order('created_at', { ascending: false })
    .limit(50)

  return (
    <div className="flex flex-col gap-6 p-6">
      <header>
        <h1 className="text-xl font-semibold">Live Generations</h1>
        <p className="text-muted-foreground text-sm mt-1">Real-time feed of all generation activity.</p>
      </header>
      <GenerationsMonitor
        initialFeed={feedRows ?? []}
        initialAnon={anonRows ?? []}
      />
    </div>
  )
}
```

- [ ] **Step 2: Write `GenerationsMonitor.tsx` (Client)**

```typescript
'use client'

import { useRealtimeTable } from '@/lib/realtime/useRealtimeTable'
import { Badge } from '@/components/ui/badge'
import type { Database } from '@/lib/supabase/database.types'

type FeedRow = Database['public']['Tables']['admin_generations_feed']['Row']
type AnonRow = Pick<Database['public']['Tables']['anonymous_attempts']['Row'],
  'id' | 'status' | 'cost_usd' | 'created_at' | 'completed_at' | 'trend_id'>

interface MonitorRow {
  id: string
  source: 'authed' | 'anon'
  status: string
  model_used: string | null
  cost_usd: number
  attempts: number
  created_at: string
  completed_at: string | null
  trend_slug: string | null
  latencyMs: number | null
}

function toMonitorRow(r: FeedRow, source: 'authed'): MonitorRow
function toMonitorRow(r: AnonRow, source: 'anon'): MonitorRow
function toMonitorRow(r: FeedRow | AnonRow, source: 'authed' | 'anon'): MonitorRow {
  const latencyMs =
    r.completed_at && r.created_at
      ? new Date(r.completed_at).getTime() - new Date(r.created_at).getTime()
      : null
  if (source === 'authed') {
    const f = r as FeedRow
    return { id: f.id, source, status: f.status, model_used: f.model_used, cost_usd: Number(f.cost_usd), attempts: f.attempts, created_at: f.created_at, completed_at: f.completed_at, trend_slug: f.trend_slug, latencyMs }
  }
  return { id: r.id, source, status: r.status, model_used: null, cost_usd: Number(r.cost_usd), attempts: 0, created_at: r.created_at!, completed_at: r.completed_at, trend_slug: null, latencyMs }
}

export function GenerationsMonitor({
  initialFeed,
  initialAnon,
}: {
  initialFeed: FeedRow[]
  initialAnon: AnonRow[]
}) {
  const feedRows = useRealtimeTable<FeedRow & { id: string; created_at: string }>({
    table: 'admin_generations_feed',
    initial: initialFeed as (FeedRow & { id: string; created_at: string })[],
    syncUrl: '/api/admin/generations-sync',
    inFlightValues: ['pending', 'processing', 'failed_retryable'],
  })

  const anonRows = useRealtimeTable<AnonRow & { id: string; created_at: string }>({
    table: 'anonymous_attempts',
    initial: initialAnon as (AnonRow & { id: string; created_at: string })[],
    inFlightValues: ['pending', 'processing'],
  })

  // Merge by {source+id} — different UUID namespaces
  const all: MonitorRow[] = [
    ...feedRows.map((r) => toMonitorRow(r as unknown as FeedRow, 'authed')),
    ...anonRows.map((r) => toMonitorRow(r as unknown as AnonRow, 'anon')),
  ].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())

  const inFlight = all.filter(r => ['pending','processing','failed_retryable'].includes(r.status))
  const recentCompleted = all.filter(r => r.status === 'completed').length
  const recentFailed = all.filter(r => r.status === 'failed').length
  const totalSpend = all.reduce((s, r) => s + r.cost_usd, 0)

  return (
    <div className="flex flex-col gap-4">
      {/* Aggregate strip */}
      <div className="grid grid-cols-4 gap-3">
        <div className="bg-card border-border/60 rounded-2xl border p-4">
          <p className="text-muted-foreground text-xs uppercase tracking-wide">In-flight</p>
          <p className="text-2xl font-bold mt-1">{inFlight.length}</p>
        </div>
        <div className="bg-card border-border/60 rounded-2xl border p-4">
          <p className="text-muted-foreground text-xs uppercase tracking-wide">Completed</p>
          <p className="text-2xl font-bold mt-1 text-emerald-500">{recentCompleted}</p>
        </div>
        <div className="bg-card border-border/60 rounded-2xl border p-4">
          <p className="text-muted-foreground text-xs uppercase tracking-wide">Failed</p>
          <p className="text-2xl font-bold mt-1 text-destructive">{recentFailed}</p>
        </div>
        <div className="bg-card border-border/60 rounded-2xl border p-4">
          <p className="text-muted-foreground text-xs uppercase tracking-wide">Spend</p>
          <p className="text-2xl font-bold mt-1">${totalSpend.toFixed(3)}</p>
        </div>
      </div>

      {/* Live table */}
      <div className="border-border/60 rounded-2xl border overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border/60 text-left">
              <th className="px-4 py-2 font-medium text-muted-foreground">Source</th>
              <th className="px-4 py-2 font-medium text-muted-foreground">Status</th>
              <th className="px-4 py-2 font-medium text-muted-foreground">Trend</th>
              <th className="px-4 py-2 font-medium text-muted-foreground">Model</th>
              <th className="px-4 py-2 font-medium text-muted-foreground">Latency</th>
              <th className="px-4 py-2 font-medium text-muted-foreground">Cost</th>
            </tr>
          </thead>
          <tbody>
            {all.slice(0, 100).map((r) => (
              <tr key={`${r.source}-${r.id}`} className="border-b border-border/30 hover:bg-muted/30">
                <td className="px-4 py-2">
                  <Badge variant="outline" className="text-[10px]">{r.source}</Badge>
                </td>
                <td className="px-4 py-2">
                  <StatusDot status={r.status} />
                </td>
                <td className="px-4 py-2 text-muted-foreground">{r.trend_slug ?? '—'}</td>
                <td className="px-4 py-2 text-muted-foreground">{r.model_used ?? '—'}</td>
                <td className="px-4 py-2 text-muted-foreground">
                  {r.latencyMs !== null ? `${(r.latencyMs / 1000).toFixed(1)}s` : '—'}
                </td>
                <td className="px-4 py-2 text-muted-foreground">${r.cost_usd.toFixed(4)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {all.length === 0 && (
          <p className="text-muted-foreground text-center py-8 text-sm">No generations yet.</p>
        )}
      </div>
    </div>
  )
}

function StatusDot({ status }: { status: string }) {
  const color = status === 'completed' ? 'text-emerald-500' : status === 'failed' ? 'text-destructive' : status === 'processing' ? 'text-blue-400' : 'text-muted-foreground'
  return <span className={`text-xs font-medium ${color}`}>{status}</span>
}
```

- [ ] **Step 3: Add Generations nav item to AdminShell**

In `components/admin/AdminShell.tsx`, import `Activity` from lucide-react. Add to Operations group before Trends:

```typescript
{
  href: '/admin/generations',
  label: 'Live monitor',
  icon: <Activity className="size-4" />,
},
```

- [ ] **Step 4: Run typecheck + build**

```bash
npx tsc --noEmit && npx next build
```

Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add app/admin/\(authed\)/generations/page.tsx \
        app/admin/\(authed\)/generations/GenerationsMonitor.tsx \
        components/admin/AdminShell.tsx
git commit -m "feat(admin): live generations monitor — dual-channel (authed + anon), aggregate strip"
```

---

## Task 4 — Fix ResultView missed-events gap + add AutoRefresh to static pages

**Files:**

- Modify: `app/(app)/result/[id]/ResultView.tsx`
- Modify: `app/admin/(authed)/page.tsx`
- Modify: `app/admin/(authed)/quota-blocks/page.tsx`

- [ ] **Step 1: Fix `ResultView.tsx` SUBSCRIBED gap (H-R2/H-R3)**

In the existing `useEffect` for the Supabase subscription (around line 113), add a status callback and post-SUBSCRIBED refetch:

```typescript
useEffect(() => {
  if (row.status === 'completed' || row.status === 'failed') return

  const supabase = createClient()
  const wasSubscribed = { current: false }

  const channel = supabase
    .channel(`gen-${row.id}`)
    .on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'generations', filter: `id=eq.${row.id}` },
      (payload) => {
        const next = payload.new as Initial
        setRow((prev) => ({ ...prev, ...next }))
      }
    )
    .subscribe(async (status) => {
      if (status === 'SUBSCRIBED') {
        // Cover the RSC→SUBSCRIBED window (H-R2) and reconnect gap (H-R3)
        wasSubscribed.current = true
        try {
          const { data } = await supabase
            .from('generations')
            .select('id, status, output_image_url, error_message, attempts, cost_usd, completed_at')
            .eq('id', row.id)
            .maybeSingle()
          if (data) setRow((prev) => ({ ...prev, ...data }))
        } catch {
          /* best-effort */
        }
      }
    })

  return () => {
    void supabase.removeChannel(channel)
  }
}, [row.id, row.status])
```

- [ ] **Step 2: Add `AutoRefresh` to admin dashboard (15s)**

In `app/admin/(authed)/page.tsx`, add at the very bottom of the JSX (outside any specific section):

```typescript
import { AutoRefresh } from '@/lib/realtime/AutoRefresh'

// At the bottom of the RSC's returned JSX:
<AutoRefresh intervalMs={15_000} />
```

- [ ] **Step 3: Add `AutoRefresh` to quota-blocks page (15s)**

In `app/admin/(authed)/quota-blocks/page.tsx`, add the same pattern at the bottom.

- [ ] **Step 4: Run full suite**

```bash
npx tsc --noEmit && npx vitest run && npx next build
```

Expected: clean, 570/572.

- [ ] **Step 5: Commit**

```bash
git add app/\(app\)/result/\[id\]/ResultView.tsx \
        app/admin/\(authed\)/page.tsx \
        app/admin/\(authed\)/quota-blocks/page.tsx
git commit -m "fix(realtime): ResultView SUBSCRIBED gap-fill; AutoRefresh on dashboard + quota-blocks"
```

---

## Task 5 — Types regen + vercel.json + final gate

**Files:**

- Modify: `lib/supabase/database.types.ts`
- Modify: `vercel.json`

- [ ] **Step 1: Apply migrations + regen types**

```bash
./node_modules/.bin/supabase db reset
./node_modules/.bin/supabase gen types typescript --local > lib/supabase/database.types.ts
npx tsc --noEmit
```

- [ ] **Step 2: Add generations-sync route to vercel.json**

```json
"app/api/admin/generations-sync/route.ts": { "maxDuration": 15 }
```

- [ ] **Step 3: Final suite**

```bash
npx tsc --noEmit && npx vitest run && npx next build
```

Expected: all green.

- [ ] **Step 4: Commit**

```bash
git add lib/supabase/database.types.ts vercel.json
git commit -m "chore(phase-4): regen types with admin_generations_feed; generations-sync in vercel.json"
```

---

## Self-Review

| Spec requirement                                                                                | Task  |
| ----------------------------------------------------------------------------------------------- | ----- |
| `is_admin()` arg-free, revoke from public, grant to authenticated (H-S13)                       | T1    |
| `admin_generations_feed` table, trigger, `replica identity full`, admin RLS, publication        | T1    |
| `trend_suggestions` admin SELECT RLS + publication (PK-only identity) (H-R9)                    | T1    |
| `anonymous_attempts` admin SELECT RLS + publication (H-R5)                                      | T1    |
| `useRealtimeTable` with SUBSCRIBED gap-fill (H-R2)                                              | T2    |
| Reconnect backfill on re-SUBSCRIBED (H-R3)                                                      | T2    |
| Two-tier eviction (in-flight never evicted; terminal capped by age) (H-R7)                      | T2    |
| No status filter on subscription — window client-side (H-R6)                                    | T2    |
| `AutoRefresh` with interval + visibilitychange, per-page not in AdminShell (H-RT3/H-R4)         | T2    |
| `generations-sync` Route Handler for cursor refetch (service-role, admin-gated)                 | T2    |
| Live monitor with `admin_generations_feed` + `anonymous_attempts` merged channels (H-R5)        | T3    |
| Merge keyed by `{source, id}` (avoids UUID collision) (H-RT2)                                   | T3    |
| Aggregate strip (in-flight, completed, failed, spend)                                           | T3    |
| `generations` base table stays in publication, NOT `replica identity full` (H-RT1)              | T1    |
| Service-role key never reaches browser — all subscriptions via publishable key + is_admin() RLS | T1,T3 |
| ResultView SUBSCRIBED gap-fill + reconnect (H-R2/H-R3)                                          | T4    |
| AutoRefresh on dashboard + quota-blocks (15s) (H-R4/H-R8)                                       | T4    |
| Types regenerated                                                                               | T5    |
