import { Download } from 'lucide-react'
import Link from 'next/link'
import { LoadErrorBanner } from '@/components/admin/LoadErrorBanner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { adminRead } from '@/lib/admin/read'
import { createServiceClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

interface ExportAuditRow {
  id: string
  admin_id: string | null
  target_table: string | null
  after: { row_count?: number; dataset?: string } | null
  created_at: string
}

interface ExportCard {
  dataset: 'customers' | 'generations' | 'revenue'
  title: string
  columns: string[]
  helper: string
}

const CARDS: readonly ExportCard[] = [
  {
    dataset: 'customers',
    title: 'Customers CSV',
    columns: [
      'user_id',
      'email_hash',
      'signup_date',
      'credits_balance',
      'total_credits_purchased',
      'referred_by_id',
      'vip_status',
      'deleted_at',
      'utm_source',
    ],
    helper: 'Anonymized: emails hashed via SHA-256.',
  },
  {
    dataset: 'generations',
    title: 'Generations CSV',
    columns: [
      'id',
      'user_id_hash',
      'trend_slug',
      'status',
      'cost_usd',
      'created_at',
      'completed_at',
      'model_used',
    ],
    helper: 'Detailed log; 30-day-purge respected.',
  },
  {
    dataset: 'revenue',
    title: 'Revenue CSV',
    columns: [
      'webhook_event_id',
      'source',
      'amount_usd',
      'currency',
      'customer_email_hash',
      'created_at',
      'payload_json',
    ],
    helper: 'Stripe webhook events; raw for buyer reconciliation.',
  },
] as const

const RECENT_LIMIT = 20

export default async function AdminExportPage() {
  // Auth + admin-role gating happens in proxy.ts (/admin/* route matcher).
  // The /admin/export/download route handler also re-checks admin_users for
  // defense in depth.
  const service = createServiceClient()

  const recentRead = await adminRead(
    'export.audit',
    service
      .from('admin_audit_log')
      .select('id, admin_id, target_table, after, created_at')
      .eq('action', 'customer_export')
      .order('created_at', { ascending: false })
      .limit(RECENT_LIMIT)
  )
  const recent = recentRead.rows as unknown as ExportAuditRow[]
  const loadError = recentRead.error

  const adminIds = Array.from(new Set(recent.map((r) => r.admin_id).filter(Boolean) as string[]))
  const emailById = new Map<string, string>()
  if (adminIds.length > 0) {
    const { rows: profileRows } = await adminRead<{ id: string; email: string }>(
      'export.profiles',
      service.from('profiles').select('id, email').in('id', adminIds)
    )
    for (const p of profileRows) {
      emailById.set(p.id, p.email)
    }
  }

  return (
    <section className="flex flex-col gap-8">
      <LoadErrorBanner error={loadError} label="recent exports" />
      <header className="flex flex-col gap-2">
        <p className="text-muted-foreground text-xs font-semibold tracking-[0.2em] uppercase">
          Diligence
        </p>
        <h1 className="text-3xl font-extrabold tracking-tight">
          Customer + revenue <span className="text-gradient-hero">export</span>
        </h1>
        <p className="text-muted-foreground text-sm">
          Streams a CSV of everything a buyer asks for in diligence. Audit-logged.
        </p>
      </header>

      <div className="grid gap-4 lg:grid-cols-3">
        {CARDS.map((card) => (
          <Card key={card.dataset} className="flex flex-col gap-4 py-6">
            <CardHeader className="px-6 pb-0">
              <CardTitle className="flex items-center gap-2 text-lg font-bold">
                <Download className="text-muted-foreground size-4" />
                {card.title}
              </CardTitle>
              <CardDescription className="text-xs">{card.helper}</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-1 flex-col gap-4 px-6">
              <ul className="flex flex-wrap gap-1.5">
                {card.columns.map((col) => (
                  <li key={col}>
                    <Badge variant="outline" className="rounded-full font-mono text-[10px]">
                      {col}
                    </Badge>
                  </li>
                ))}
              </ul>
              <Button asChild size="sm" className="mt-auto w-fit">
                <a href={`/admin/export/download?dataset=${card.dataset}`} rel="nofollow">
                  Download {card.dataset}.csv
                </a>
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="gap-4 py-6">
        <CardHeader className="px-6 pb-0">
          <CardTitle className="text-lg font-bold">Recent exports</CardTitle>
          <CardDescription className="text-xs">
            Audit-logged from <code className="font-mono">admin_audit_log</code> ·{' '}
            <code className="font-mono">action=customer_export</code>.
          </CardDescription>
        </CardHeader>
        <CardContent className="px-6">
          {recent.length === 0 ? (
            <p className="text-muted-foreground text-sm">No exports yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
                  <tr>
                    <th className="py-2 pr-3">When</th>
                    <th className="py-2 pr-3">Dataset</th>
                    <th className="py-2 pr-3">Rows</th>
                    <th className="py-2 pr-3">Admin</th>
                  </tr>
                </thead>
                <tbody>
                  {recent.map((row) => {
                    const adminEmail = row.admin_id ? (emailById.get(row.admin_id) ?? null) : null
                    return (
                      <tr key={row.id} className="border-border/40 border-t">
                        <td className="text-muted-foreground py-2 pr-3 text-xs">
                          {new Date(row.created_at).toLocaleString()}
                        </td>
                        <td className="py-2 pr-3 font-mono text-xs">
                          {row.target_table ?? row.after?.dataset ?? '—'}
                        </td>
                        <td className="py-2 pr-3 font-mono text-xs tabular-nums">
                          {row.after?.row_count ?? '—'}
                        </td>
                        <td className="py-2 pr-3 text-xs">
                          {adminEmail ?? (
                            <span className="text-muted-foreground font-mono">
                              {row.admin_id?.slice(0, 8) ?? 'system'}
                            </span>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <p className="text-muted-foreground text-xs">
        Exports are audit-logged; only admins listed in{' '}
        <code className="font-mono">admin_users</code> can access this route. See{' '}
        <Link href="/admin/audit" className="text-foreground font-semibold hover:underline">
          Audit log →
        </Link>
      </p>
    </section>
  )
}
