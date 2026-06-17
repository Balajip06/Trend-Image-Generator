import { Archive, TriangleAlert, User } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { createServiceClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

interface AuditRow {
  id: string
  admin_id: string | null
  action: string
  target_table: string
  target_id: string | null
  before: unknown
  after: unknown
  created_at: string
}

interface EnrichedRow extends AuditRow {
  admin_email: string | null
}

const PAGE_LIMIT = 100

// Color-code by action verb so the eye can group similar entries fast.
const ACTION_TONE: Record<string, string> = {
  credit_grant: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
  credit_refund: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
  trend_create: 'bg-[var(--brand-cyan)]/15 text-[var(--brand-cyan)]',
  trend_update: 'bg-[var(--brand-cyan)]/15 text-[var(--brand-cyan)]',
  trend_activate: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  trend_deactivate: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  trend_delete: 'bg-destructive/15 text-destructive',
}

export default async function AuditPage() {
  // Auth + admin-role gating happens in proxy.ts (/admin/* route matcher) —
  // reaching this RSC means the caller is already a verified admin. Read via
  // service-role: the authed-client SELECT depends on auth.uid() resolving in
  // the RSC, which is unreliable across SSR session refresh and silently
  // returned 0 rows even for admins (RLS sees a null uid → no admin_users
  // match). Service-role bypasses that fragility; proxy is the real gate.
  const service = createServiceClient()
  const { data: rows, error } = await service
    .from('admin_audit_log')
    .select('id, admin_id, action, target_table, target_id, before, after, created_at')
    .order('created_at', { ascending: false })
    .limit(PAGE_LIMIT)

  if (error) {
    console.error('[admin/audit] failed to load audit_log:', error.message)
    return <LoadError message={error.message} />
  }

  const audit = (rows as AuditRow[] | null) ?? []

  // Resolve admin emails via service-role (auth.users isn't queryable from
  // an authed client). One round-trip, in-memory join.
  //
  // Intentional design (code-review MEDIUM-4, 2026-05-29 sign-off): admins
  // see each other's emails in the audit log. This is the price of having
  // an attributable compliance trail — anonymizing the actor would defeat
  // the purpose of the log. If a future admin role is added (e.g. support
  // agents), restrict by role here.
  const adminIds = Array.from(new Set(audit.map((r) => r.admin_id).filter(Boolean) as string[]))
  const emailById = new Map<string, string>()
  if (adminIds.length > 0) {
    const { data: profileRows } = await service
      .from('profiles')
      .select('id, email')
      .in('id', adminIds)
    for (const p of (profileRows as { id: string; email: string }[] | null) ?? []) {
      emailById.set(p.id, p.email)
    }
  }

  const enriched: EnrichedRow[] = audit.map((r) => ({
    ...r,
    admin_email: r.admin_id ? (emailById.get(r.admin_id) ?? null) : null,
  }))

  return (
    <section className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <p className="text-muted-foreground text-xs font-semibold tracking-[0.2em] uppercase">
          Compliance
        </p>
        <h1 className="text-3xl font-extrabold tracking-tight">Audit log</h1>
        <p className="text-muted-foreground text-sm">
          {audit.length === PAGE_LIMIT ? `Latest ${PAGE_LIMIT}` : audit.length} entries · admin
          actions + system credit grants are appended here automatically.
        </p>
      </header>

      {audit.length === 0 ? (
        <EmptyLog />
      ) : (
        <ul className="flex flex-col gap-3">
          {enriched.map((row) => (
            <AuditCard key={row.id} row={row} />
          ))}
        </ul>
      )}
    </section>
  )
}

function LoadError({ message }: { message: string }) {
  return (
    <div className="border-destructive/40 bg-destructive/5 flex flex-col items-center gap-4 rounded-3xl border border-dashed p-16 text-center">
      <div className="bg-destructive/10 text-destructive grid size-14 place-items-center rounded-full">
        <TriangleAlert className="size-6" />
      </div>
      <div>
        <p className="text-lg font-bold">Could not load audit log</p>
        <p className="text-muted-foreground mt-1 font-mono text-xs">{message}</p>
      </div>
    </div>
  )
}

function EmptyLog() {
  return (
    <div className="border-border/60 bg-card/40 flex flex-col items-center gap-4 rounded-3xl border border-dashed p-16 text-center">
      <div className="bg-muted text-foreground grid size-14 place-items-center rounded-full">
        <Archive className="size-6" />
      </div>
      <div>
        <p className="text-lg font-bold">No audit entries</p>
        <p className="text-muted-foreground mt-1 text-sm">
          Will populate as admins edit trends + Stripe webhooks grant credits.
        </p>
      </div>
    </div>
  )
}

function AuditCard({ row }: { row: EnrichedRow }) {
  const tone = ACTION_TONE[row.action] ?? 'bg-muted text-foreground/70'
  const hasDiff = row.before !== null || row.after !== null
  return (
    <Card className="gap-3 py-4">
      <CardHeader className="flex flex-row items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <Badge className={`rounded-full px-2.5 py-0.5 text-[10px] font-semibold ${tone}`}>
              {row.action}
            </Badge>
            <Badge variant="outline" className="rounded-full font-mono text-[10px]">
              {row.target_table}
              {row.target_id ? ` · ${row.target_id.slice(0, 8)}` : ''}
            </Badge>
            <time className="text-muted-foreground text-xs" dateTime={row.created_at}>
              {new Date(row.created_at).toLocaleString()}
            </time>
          </div>
          <CardTitle className="text-sm font-semibold">
            <span className="text-muted-foreground inline-flex items-center gap-1.5">
              <User className="size-3.5" />
              {row.admin_email ?? (row.admin_id ? row.admin_id.slice(0, 8) : 'system')}
            </span>
          </CardTitle>
        </div>
      </CardHeader>
      {hasDiff && (
        <CardContent>
          <details className="group">
            <summary className="text-muted-foreground hover:text-foreground cursor-pointer text-xs font-medium">
              View payload
            </summary>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {row.before !== null && row.before !== undefined && (
                <DiffBlock label="Before" value={row.before} />
              )}
              {row.after !== null && row.after !== undefined && (
                <DiffBlock label="After" value={row.after} />
              )}
            </div>
          </details>
        </CardContent>
      )}
      {!hasDiff && (
        <CardContent>
          <CardDescription className="text-xs">No payload recorded.</CardDescription>
        </CardContent>
      )}
    </Card>
  )
}

function DiffBlock({ label, value }: { label: string; value: unknown }) {
  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-muted-foreground text-[10px] font-semibold tracking-wider uppercase">
        {label}
      </p>
      <pre className="border-border/60 bg-muted/60 overflow-x-auto rounded-lg border p-3 font-mono text-[11px] leading-snug">
        {JSON.stringify(value, null, 2)}
      </pre>
    </div>
  )
}
