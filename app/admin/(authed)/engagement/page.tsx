import { BarChart3, Eye, MousePointerClick, TrendingUp } from 'lucide-react'
import Link from 'next/link'
import { BarChart, Delta, Sparkline } from '@/components/admin/Charts'
import { KpiCard } from '@/components/admin/KpiCard'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { getCountsBatch, getDailySeries, getPeriodTotals } from '@/lib/analytics/event-store'
import { createServiceClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

function formatNumber(n: number): string {
  return new Intl.NumberFormat('en-US').format(n)
}

function ctrPct(impressions: number, clicks: number): string {
  if (impressions === 0) return '—'
  return `${((clicks / impressions) * 100).toFixed(1)}%`
}

export default async function AdminEngagementPage() {
  // Service client so engagement covers every trend, not just RLS-visible active ones.
  const supabase = createServiceClient()
  const { data: rows } = await supabase
    .from('trends')
    .select('id, slug, title, is_active')
    .order('display_order', { ascending: true })

  const trends = rows ?? []
  const slugs = trends.map((t) => t.slug)
  const [dailyEngagement, period, perTrend, perTrendSeries] = await Promise.all([
    getDailySeries(slugs, 7),
    getPeriodTotals(slugs, 7),
    getCountsBatch(slugs),
    Promise.all(slugs.map((slug) => getDailySeries([slug], 7))),
  ])
  const dailyByTrend = new Map(slugs.map((slug, i) => [slug, perTrendSeries[i] ?? []]))

  const ctrCurrent =
    period.current.impressions === 0
      ? 0
      : (period.current.clicks / period.current.impressions) * 100
  const ctrPrevious =
    period.previous.impressions === 0
      ? 0
      : (period.previous.clicks / period.previous.impressions) * 100

  const ranked = trends
    .map((t) => {
      const counts = perTrend.get(t.slug) ?? { impressions: 0, clicks: 0 }
      const series = dailyByTrend.get(t.slug) ?? []
      return {
        ...t,
        impressions: counts.impressions,
        clicks: counts.clicks,
        ctr: counts.impressions === 0 ? 0 : (counts.clicks / counts.impressions) * 100,
        series,
      }
    })
    .sort((a, b) => b.impressions - a.impressions)

  return (
    <section className="flex flex-col gap-8">
      <header className="flex flex-col gap-2">
        <p className="text-muted-foreground text-xs font-semibold tracking-[0.2em] uppercase">
          Growth
        </p>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h1 className="text-3xl font-extrabold tracking-tight">
            <span className="text-gradient-hero">Engagement</span>
          </h1>
          <p className="text-muted-foreground text-xs">
            Rolling 7-day window · UTC · {trends.length} trends tracked
          </p>
        </div>
        <p className="text-muted-foreground text-sm">
          Trend-page impressions, generate-button clicks, and click-through rate, aggregated from the{' '}
          <code className="font-mono text-xs">trend_events</code> table (set{' '}
          <code className="font-mono text-xs">TREND_EVENTS_BACKEND=supabase</code> in prod so counts
          persist across deploys).
        </p>
      </header>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <KpiCard
          icon={<Eye className="size-4" />}
          label="Impressions"
          value={formatNumber(period.current.impressions)}
          delta={
            <Delta current={period.current.impressions} previous={period.previous.impressions} />
          }
          tone="text-[var(--brand-grad-1)]"
          series={dailyEngagement.map((d) => ({ label: d.label, value: d.impressions }))}
          ariaLabel="Daily impressions, last 7 days"
        />
        <KpiCard
          icon={<MousePointerClick className="size-4" />}
          label="Generate clicks"
          value={formatNumber(period.current.clicks)}
          delta={<Delta current={period.current.clicks} previous={period.previous.clicks} />}
          tone="text-[var(--brand-cyan)]"
          series={dailyEngagement.map((d) => ({ label: d.label, value: d.clicks }))}
          ariaLabel="Daily generate clicks, last 7 days"
        />
        <KpiCard
          icon={<TrendingUp className="size-4" />}
          label="Click-through"
          value={ctrPct(period.current.impressions, period.current.clicks)}
          delta={<Delta current={ctrCurrent} previous={ctrPrevious} />}
          tone="text-pink-500"
          series={dailyEngagement.map((d) => ({
            label: d.label,
            value: d.impressions === 0 ? 0 : (d.clicks / d.impressions) * 100,
          }))}
          ariaLabel="Daily click-through rate, last 7 days"
        />
      </div>

      <Card className="gap-3 py-5">
        <CardHeader className="px-5">
          <CardDescription className="text-xs tracking-[0.18em] uppercase">
            Funnel · 7 days
          </CardDescription>
          <CardTitle className="text-xl font-bold">Impressions vs clicks per day</CardTitle>
        </CardHeader>
        <CardContent className="px-5">
          <BarChart
            ariaLabel="Daily impressions and clicks bar chart"
            data={dailyEngagement.map((d) => ({ label: d.label, value: d.impressions }))}
            secondary={{
              data: dailyEngagement.map((d) => ({ label: d.label, value: d.clicks })),
              label: 'Clicks',
              className: 'text-[var(--brand-cyan)]',
            }}
            primaryLabel="Impressions"
            primaryClassName="text-[var(--brand-grad-1)]"
          />
        </CardContent>
      </Card>

      <Card className="gap-0 overflow-hidden py-0">
        <CardHeader className="px-5 py-4">
          <CardTitle className="text-lg font-bold">Per-trend breakdown</CardTitle>
          <CardDescription className="text-xs">
            Ranked by impressions · click row to open the trend editor
          </CardDescription>
        </CardHeader>
        {ranked.length === 0 ? (
          <div className="text-muted-foreground flex flex-col items-center gap-2 px-5 py-10 text-center text-sm">
            <BarChart3 className="size-6" />
            <p>No trends yet — add one to start collecting engagement data.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-muted/50 text-muted-foreground text-[11px] tracking-wide uppercase">
                <tr>
                  <th className="px-4 py-3 font-semibold">#</th>
                  <th className="px-4 py-3 font-semibold">Trend</th>
                  <th className="px-4 py-3 text-right font-semibold">Impressions</th>
                  <th className="px-4 py-3 text-right font-semibold">Clicks</th>
                  <th className="px-4 py-3 text-right font-semibold">CTR</th>
                  <th className="px-4 py-3 font-semibold">7-day trend</th>
                </tr>
              </thead>
              <tbody>
                {ranked.map((t, idx) => (
                  <tr
                    key={t.id}
                    className="border-border/60 hover:bg-muted/30 border-t transition-colors"
                  >
                    <td className="text-muted-foreground px-4 py-3 font-mono text-xs">{idx + 1}</td>
                    <td className="px-4 py-3">
                      <Link
                        href={`/admin/trends/${t.id}/edit`}
                        className="text-foreground font-semibold hover:underline"
                      >
                        {t.title}
                      </Link>
                      <div className="text-muted-foreground flex items-center gap-2 text-xs">
                        <span className="font-mono">/{t.slug}</span>
                        <span
                          className={`inline-block size-1.5 rounded-full ${
                            t.is_active ? 'bg-emerald-500' : 'bg-muted-foreground/40'
                          }`}
                          aria-label={t.is_active ? 'Live' : 'Draft'}
                        />
                        <span>{t.is_active ? 'Live' : 'Draft'}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-xs tabular-nums">
                      {formatNumber(t.impressions)}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-xs tabular-nums">
                      {formatNumber(t.clicks)}
                    </td>
                    <td className="text-muted-foreground px-4 py-3 text-right font-mono text-xs tabular-nums">
                      {ctrPct(t.impressions, t.clicks)}
                    </td>
                    <td className="w-40 px-4 py-3 text-[var(--brand-grad-1)]">
                      <Sparkline
                        ariaLabel={`${t.title} impressions trend`}
                        data={t.series.map((d) => ({ label: d.label, value: d.impressions }))}
                        height={36}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </section>
  )
}
