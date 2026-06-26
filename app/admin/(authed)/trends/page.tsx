import { ArrowDown, ArrowUp, Copy, Plus, Sparkles, Star } from 'lucide-react'
import Link from 'next/link'
import { FlashToasts } from '@/components/admin/FlashToasts'
import { ActiveBadge, EvalBadge } from '@/components/admin/StatusBadges'
import { GradientButton } from '@/components/brand/GradientButton'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { getCountsBatch } from '@/lib/analytics/event-store'
import { createServiceClient } from '@/lib/supabase/server'
import { bumpOrder, cloneTrend, toggleFeatured } from './actions'

function fmt(n: number): string {
  return new Intl.NumberFormat('en-US').format(n)
}

function ctrPct(impressions: number, clicks: number): string {
  if (impressions === 0) return '—'
  return `${((clicks / impressions) * 100).toFixed(1)}%`
}

export const dynamic = 'force-dynamic'

interface AdminTrendsListProps {
  searchParams?: Promise<Record<string, string | string[] | undefined>>
}

function formatSchedule(goesLiveAt: string | null): string {
  if (!goesLiveAt) return 'Live now'
  const d = new Date(goesLiveAt)
  if (Number.isNaN(d.getTime())) return '—'
  if (d.getTime() <= Date.now()) return 'Live now'
  // Render in UTC so multi-admin timezones don't disagree.
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`
}

export default async function AdminTrendsList({ searchParams }: AdminTrendsListProps) {
  await searchParams // consumed client-side by FlashToasts
  // Service client: admins must see ALL trends (drafts/inactive included). The authed
  // client is bound by the `trends_public_read` RLS policy (active-only), which would
  // hide drafts from the admin list. Admin gate is enforced upstream in proxy.ts.
  const supabase = createServiceClient()
  // Featured first (DESC NULLS LAST), then explicit display_order ASC.
  const { data: rows } = await supabase
    .from('trends')
    .select(
      'id, slug, title, is_active, eval_status, model, display_order, version, updated_at, is_featured, goes_live_at, auto_deactivate_disabled'
    )
    .order('is_featured', { ascending: false, nullsFirst: false })
    .order('display_order', { ascending: true })

  const trends = rows ?? []
  const metricsMap = await getCountsBatch(trends.map((t) => t.slug))

  return (
    <section className="flex flex-col gap-6">
      <FlashToasts
        flashes={[
          { key: 'error', level: 'error' },
          {
            key: 'cloned',
            level: 'success',
            message: 'Trend cloned. Re-run eval before activating.',
          },
          { key: 'featured', level: 'success', message: 'Featured.' },
          { key: 'unfeatured', level: 'info', message: 'Unfeatured.' },
        ]}
      />

      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-muted-foreground text-xs font-semibold tracking-[0.2em] uppercase">
            Catalogue
          </p>
          <h1 className="text-3xl font-extrabold tracking-tight">Trends</h1>
          <p className="text-muted-foreground mt-1 text-sm">
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
              <thead className="bg-muted/50 text-muted-foreground text-[11px] tracking-wide uppercase">
                <tr>
                  <th className="px-4 py-3 font-semibold">#</th>
                  <th className="px-4 py-3 font-semibold">Trend</th>
                  <th className="px-2 py-3 text-center font-semibold" aria-label="Featured">
                    ★
                  </th>
                  <th className="px-4 py-3 font-semibold">Schedule</th>
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
                {trends.map((t, idx) => {
                  const m = metricsMap.get(t.slug) ?? { impressions: 0, clicks: 0 }
                  const subjectToAutoDeactivate = !t.is_featured && !t.auto_deactivate_disabled
                  return (
                    <tr
                      key={t.id}
                      className="border-border/60 hover:bg-muted/30 border-t transition-colors"
                    >
                      <td className="text-muted-foreground px-4 py-3 font-mono text-xs">
                        {t.display_order}
                      </td>
                      <td className="px-4 py-3">
                        <Link
                          href={`/admin/trends/${t.id}/edit`}
                          className="text-foreground font-semibold hover:underline"
                        >
                          {t.title}
                        </Link>
                        <div className="text-muted-foreground mt-0.5 flex flex-wrap items-center gap-1.5 text-xs">
                          <span>
                            /{t.slug} · v{t.version}
                          </span>
                          {subjectToAutoDeactivate && (
                            <Badge
                              variant="outline"
                              className="rounded-full px-1.5 py-0 text-[10px] font-normal"
                              title="Subject to cold-trend auto-deactivate cron"
                            >
                              auto-cull
                            </Badge>
                          )}
                        </div>
                      </td>
                      <td className="px-2 py-3 text-center">
                        <form action={toggleFeatured} className="inline-flex">
                          <input type="hidden" name="id" value={t.id} />
                          <input type="hidden" name="featured" value={t.is_featured ? '0' : '1'} />
                          <Button
                            type="submit"
                            variant="ghost"
                            size="icon"
                            aria-label={t.is_featured ? 'Unfeature trend' : 'Feature trend'}
                            title={
                              t.is_featured
                                ? 'Unfeature'
                                : 'Feature (floats to top, exempt from auto-cull)'
                            }
                            className="size-7"
                          >
                            <Star
                              className={
                                t.is_featured
                                  ? 'size-4 fill-[var(--brand-grad-1,#ec4899)] text-[var(--brand-grad-1,#ec4899)]'
                                  : 'text-muted-foreground size-4'
                              }
                            />
                          </Button>
                        </form>
                      </td>
                      <td className="text-muted-foreground px-4 py-3 text-xs">
                        {formatSchedule(t.goes_live_at)}
                      </td>
                      <td className="text-muted-foreground px-4 py-3 font-mono text-[11px]">
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
                      <td className="text-muted-foreground px-4 py-3 text-right font-mono text-xs tabular-nums">
                        {ctrPct(m.impressions, m.clicks)}
                      </td>
                      <td className="text-muted-foreground px-4 py-3 text-xs">
                        {new Date(t.updated_at).toLocaleDateString()}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1">
                          <form action={bumpOrder} className="inline-flex">
                            <input type="hidden" name="id" value={t.id} />
                            <input type="hidden" name="direction" value="up" />
                            <Button
                              type="submit"
                              variant="ghost"
                              size="icon"
                              className="size-7"
                              aria-label="Move up"
                              title="Move up"
                              disabled={idx === 0}
                            >
                              <ArrowUp className="size-4" />
                            </Button>
                          </form>
                          <form action={bumpOrder} className="inline-flex">
                            <input type="hidden" name="id" value={t.id} />
                            <input type="hidden" name="direction" value="down" />
                            <Button
                              type="submit"
                              variant="ghost"
                              size="icon"
                              className="size-7"
                              aria-label="Move down"
                              title="Move down"
                              disabled={idx === trends.length - 1}
                            >
                              <ArrowDown className="size-4" />
                            </Button>
                          </form>
                          <form action={cloneTrend} className="inline-flex">
                            <input type="hidden" name="id" value={t.id} />
                            <Button
                              type="submit"
                              variant="ghost"
                              size="icon"
                              className="size-7"
                              aria-label="Clone trend"
                              title="Clone (resets eval + activation)"
                            >
                              <Copy className="size-4" />
                            </Button>
                          </form>
                          <Button asChild variant="ghost" size="sm">
                            <Link href={`/admin/trends/${t.id}/edit`}>Edit</Link>
                          </Button>
                        </div>
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
    <div className="border-border/60 bg-card/40 flex flex-col items-center gap-4 rounded-3xl border border-dashed p-16 text-center">
      <div className="bg-muted text-foreground grid size-14 place-items-center rounded-full">
        <Sparkles className="size-6" />
      </div>
      <div>
        <p className="text-lg font-bold">No trends yet</p>
        <p className="text-muted-foreground mt-1 text-sm">
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
