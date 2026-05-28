import { Archive, User } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { createClient, createServiceClient } from '@/lib/supabase/server'

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
  // Auth + admin-role gating happens in proxy.ts (/admin/* route matcher).
  // RLS on admin_audit_log restricts SELECT to rows the admin can see anyway.
  const supabase = await createClient()
  const { data: rows } = await supabase
    .from('admin_audit_log')
    .select('id, admin_id, action, target_table, target_id, before, after, created_at')
    .order('created_at', { ascending: false })
    .limit(PAGE_LIMIT)

  const audit = (rows as AuditRow[] | null) ?? []

  // Resolve admin emails via service-role (auth.users isn't queryable from
  // an authed client). One round-trip, in-memory join.
  const adminIds = Array.from(new Set(audit.map((r) => r.admin_id).filter(Boolean) as string[]))
  const emailById = new Map<string, string>()
  if (adminIds.length > 0) {
    const service = createServiceClient()
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
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
          Compliance
        </p>
        <h1 className="text-3xl font-extrabold tracking-tight">Audit log</h1>
        <p className="text-sm text-muted-foreground">
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

function EmptyLog() {
  return (
    <div className="flex flex-col items-center gap-4 rounded-3xl border border-dashed border-border/60 bg-card/40 p-16 text-center">
      <div className="grid size-14 place-items-center rounded-full bg-muted text-foreground">
        <Archive className="size-6" />
      </div>
      <div>
        <p className="text-lg font-bold">No audit entries</p>
        <p className="mt-1 text-sm text-muted-foreground">
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
            <Badge variant="outline" className="rounded-full text-[10px] font-mono">
              {row.target_table}
              {row.target_id ? ` · ${row.target_id.slice(0, 8)}` : ''}
            </Badge>
            <time className="text-xs text-muted-foreground" dateTime={row.created_at}>
              {new Date(row.created_at).toLocaleString()}
            </time>
          </div>
          <CardTitle className="text-sm font-semibold">
            <span className="inline-flex items-center gap-1.5 text-muted-foreground">
              <User className="size-3.5" />
              {row.admin_email ?? (row.admin_id ? row.admin_id.slice(0, 8) : 'system')}
            </span>
          </CardTitle>
        </div>
      </CardHeader>
      {hasDiff && (
        <CardContent>
          <details className="group">
            <summary className="cursor-pointer text-xs font-medium text-muted-foreground hover:text-foreground">
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
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <pre className="overflow-x-auto rounded-lg border border-border/60 bg-muted/60 p-3 text-[11px] font-mono leading-snug">
        {JSON.stringify(value, null, 2)}
      </pre>
    </div>
  )
}
