import { Plus, Sparkles } from 'lucide-react'
import Link from 'next/link'
import { ActiveBadge, EvalBadge } from '@/components/admin/StatusBadges'
import { GradientButton } from '@/components/brand/GradientButton'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { getCountsBatch } from '@/lib/analytics/event-store'
import { createClient } from '@/lib/supabase/server'

function fmt(n: number): string {
  return new Intl.NumberFormat('en-US').format(n)
}

function ctrPct(impressions: number, clicks: number): string {
  if (impressions === 0) return '—'
  return `${((clicks / impressions) * 100).toFixed(1)}%`
}

export const dynamic = 'force-dynamic'

interface AdminTrendRow {
  id: string
  slug: string
  title: string
  is_active: boolean
  eval_status: 'untested' | 'passed' | 'failed'
  model: 'nano-banana' | 'nano-banana-pro'
  display_order: number
  version: number
  updated_at: string
}

export default async function AdminTrendsList() {
  const supabase = await createClient()
  const { data: rows } = await supabase
    .from('trends')
    .select('id, slug, title, is_active, eval_status, model, display_order, version, updated_at')
    .order('display_order', { ascending: true })

  const trends = (rows as unknown as AdminTrendRow[] | null) ?? []
  const metricsMap = getCountsBatch(trends.map((t) => t.slug))

  return (
    <section className="flex flex-col gap-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
            Catalogue
          </p>
          <h1 className="text-3xl font-extrabold tracking-tight">Trends</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {trends.length} total · {trends.filter((t) => t.is_active).length} live
          </p>
        </div>
        <GradientButton size="md" asChild>
          <Link href="/admin/trends/new">
            <Plus className="size-4" /> New trend
          </Link>
        </GradientButton>
      </header>

      {trends.length === 0 ? (
        <EmptyState />
      ) : (
        <Card className="gap-0 overflow-hidden py-0">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-muted/50 text-[11px] uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 font-semibold">#</th>
                  <th className="px-4 py-3 font-semibold">Trend</th>
                  <th className="px-4 py-3 font-semibold">Model</th>
                  <th className="px-4 py-3 font-semibold">Eval</th>
                  <th className="px-4 py-3 font-semibold">State</th>
                  <th className="px-4 py-3 text-right font-semibold">Views</th>
                  <th className="px-4 py-3 text-right font-semibold">Clicks</th>
                  <th className="px-4 py-3 text-right font-semibold">CTR</th>
                  <th className="px-4 py-3 font-semibold">Updated</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {trends.map((t) => {
                  const m = metricsMap.get(t.slug) ?? { impressions: 0, clicks: 0 }
                  return (
                    <tr
                      key={t.id}
                      className="border-t border-border/60 transition-colors hover:bg-muted/30"
                    >
                      <td className="px-4 py-3 text-xs font-mono text-muted-foreground">
                        {t.display_order}
                      </td>
                      <td className="px-4 py-3">
                        <Link
                          href={`/admin/trends/${t.id}/edit`}
                          className="font-semibold text-foreground hover:underline"
                        >
                          {t.title}
                        </Link>
                        <div className="text-xs text-muted-foreground">
                          /{t.slug} · v{t.version}
                        </div>
                      </td>
                      <td className="px-4 py-3 font-mono text-[11px] text-muted-foreground">
                        {t.model}
                      </td>
                      <td className="px-4 py-3">
                        <EvalBadge status={t.eval_status} />
                      </td>
                      <td className="px-4 py-3">
                        <ActiveBadge active={t.is_active} />
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-xs tabular-nums">
                        {fmt(m.impressions)}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-xs tabular-nums">
                        {fmt(m.clicks)}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-xs tabular-nums text-muted-foreground">
                        {ctrPct(m.impressions, m.clicks)}
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">
                        {new Date(t.updated_at).toLocaleDateString()}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Button asChild variant="ghost" size="sm">
                          <Link href={`/admin/trends/${t.id}/edit`}>Edit</Link>
                        </Button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </section>
  )
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center gap-4 rounded-3xl border border-dashed border-border/60 bg-card/40 p-16 text-center">
      <div className="grid size-14 place-items-center rounded-full bg-muted text-foreground">
        <Sparkles className="size-6" />
      </div>
      <div>
        <p className="text-lg font-bold">No trends yet</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Create one to get started. Drafts stay inactive until eval passes.
        </p>
      </div>
      <GradientButton asChild size="md">
        <Link href="/admin/trends/new">
          <Plus className="size-4" /> Create draft
        </Link>
      </GradientButton>
    </div>
  )
}
