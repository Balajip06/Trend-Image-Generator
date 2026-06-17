import {
  Archive,
  BarChart3,
  Coins,
  DollarSign,
  Eye,
  Flame,
  Gift,
  Inbox,
  LifeBuoy,
  MousePointerClick,
  ShieldX,
  Sparkles,
  TrendingUp,
} from 'lucide-react'
import Link from 'next/link'
import { AdminTile } from '@/components/admin/AdminTile'
import { BarChart, Delta, DonutChart } from '@/components/admin/Charts'
import { KpiCard } from '@/components/admin/KpiCard'
import { StatCard } from '@/components/admin/StatCard'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  getDailySeries,
  getPeriodTotals,
  getQuotaBlockedSummary,
} from '@/lib/analytics/event-store'
import { getMarginDetail } from '@/lib/analytics/margin'
import { createClient, createServiceClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

interface DashboardCounts {
  trendsTotal: number
  trendsLive: number
  pendingSuggestions: number
  trendSlugs: string[]
}

async function loadCounts(): Promise<DashboardCounts> {
  // Service-role: trend_suggestions has RLS enabled with no SELECT policy
  // (deny-all to the authed client), so the pending-suggestions count read
  // by an authed client is always 0 even when the inbox has rows. Proxy.ts
  // already gates /admin to admins; service-role is the correct read here.
  const supabase = createServiceClient()
  const [trendsRes, liveRes, suggRes] = await Promise.all([
    supabase.from('trends').select('id, slug'),
    supabase.from('trends').select('id', { count: 'exact', head: true }).eq('is_active', true),
    supabase
      .from('trend_suggestions')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'pending'),
  ])
  const trendRows = (trendsRes.data as { id: string; slug: string }[] | null) ?? []
  return {
    trendsTotal: trendRows.length,
    trendsLive: liveRes.count ?? 0,
    pendingSuggestions: suggRes.count ?? 0,
    trendSlugs: trendRows.map((r) => r.slug),
  }
}

function formatNumber(n: number): string {
  return new Intl.NumberFormat('en-US').format(n)
}

function ctrPct(impressions: number, clicks: number): string {
  if (impressions === 0) return '—'
  return `${((clicks / impressions) * 100).toFixed(1)}%`
}

function formatUsd(n: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n)
}

export default async function AdminHome() {
  const counts = await loadCounts()
  const [dailyEngagement, period, quotaBlocked] = await Promise.all([
    getDailySeries(counts.trendSlugs, 7),
    getPeriodTotals(counts.trendSlugs, 7),
    getQuotaBlockedSummary(24),
  ])
  const supabase = await createClient()
  const margin = await getMarginDetail(supabase, 7)

  const ctrCurrent =
    period.current.impressions === 0
      ? 0
      : (period.current.clicks / period.current.impressions) * 100
  const ctrPrevious =
    period.previous.impressions === 0
      ? 0
      : (period.previous.clicks / period.previous.impressions) * 100

  const netUsd = margin.weekRevenueUsd - margin.weekSpendUsd
  const priorNet = margin.priorWeek.revenueUsd - margin.priorWeek.spendUsd

  return (
    <section className="flex flex-col gap-8">
      <header className="flex flex-col gap-2">
        <p className="text-muted-foreground text-xs font-semibold tracking-[0.2em] uppercase">
          Admin console
        </p>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h1 className="text-3xl font-extrabold tracking-tight">
            What needs <span className="text-gradient-hero">your attention</span>?
          </h1>
          <p className="text-muted-foreground text-xs">
            Rolling 7-day window · UTC · refreshed on load
          </p>
        </div>
      </header>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
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
          label="CTR"
          value={ctrPct(period.current.impressions, period.current.clicks)}
          delta={
            <Delta
              current={ctrCurrent}
              previous={ctrPrevious}
              format={(n) => `${Math.abs(n).toFixed(1)}%`}
            />
          }
          tone="text-pink-500"
          series={dailyEngagement.map((d) => ({
            label: d.label,
            value: d.impressions === 0 ? 0 : (d.clicks / d.impressions) * 100,
          }))}
          ariaLabel="Daily click-through rate, last 7 days"
        />
        <KpiCard
          icon={<Coins className="size-4" />}
          label="Net margin"
          value={formatUsd(netUsd)}
          delta={
            <Delta
              current={netUsd}
              previous={priorNet}
              format={(n) => `${Math.abs(n).toFixed(1)}%`}
            />
          }
          tone="text-emerald-500"
          series={margin.daily.map((d) => ({
            label: d.label,
            value: Number((d.revenueUsd - d.spendUsd).toFixed(2)),
          }))}
          ariaLabel="Daily net margin, last 7 days"
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="flex flex-col gap-2 lg:col-span-2">
          <KpiCard
            icon={<ShieldX className="size-4" />}
            label="Quota blocks · 24h"
            value={formatNumber(quotaBlocked.totalBlocks)}
            delta={
              <span className="text-muted-foreground font-mono text-xs tabular-nums">
                {quotaBlocked.distinctSlugs} trends · ~{quotaBlocked.distinctUsersEstimated} users
              </span>
            }
            tone="text-amber-500"
            series={quotaBlocked.dailySeries.map((d) => ({ label: d.label, value: d.count }))}
            ariaLabel="Daily quota-blocked events, last 7 days"
          />
          <Link
            href="/admin/quota-blocks"
            className="text-muted-foreground hover:text-foreground self-end text-xs font-semibold"
          >
            Drilldown →
          </Link>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="gap-3 py-5 lg:col-span-2">
          <CardHeader className="px-5">
            <div className="flex items-baseline justify-between">
              <div>
                <CardDescription className="text-xs tracking-[0.18em] uppercase">
                  Engagement · 7 days
                </CardDescription>
                <CardTitle className="text-xl font-bold">Impressions vs generate clicks</CardTitle>
              </div>
              <Link
                href="/admin/engagement"
                className="text-muted-foreground hover:text-foreground text-xs font-semibold"
              >
                Engagement details →
              </Link>
            </div>
          </CardHeader>
          <CardContent className="px-5">
            <BarChart
              ariaLabel="Engagement bar chart — impressions and clicks per day"
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

        <Card className="gap-3 py-5">
          <CardHeader className="px-5">
            <CardDescription className="text-xs tracking-[0.18em] uppercase">
              Margin split · 7 days
            </CardDescription>
            <CardTitle className="text-xl font-bold">Revenue vs spend</CardTitle>
          </CardHeader>
          <CardContent className="px-5">
            <DonutChart
              ariaLabel="Donut chart of revenue and spend share for the past 7 days"
              centerValue={`${margin.marginPct.toFixed(1)}%`}
              centerLabel="margin"
              data={[
                {
                  label: `Revenue · ${formatUsd(margin.weekRevenueUsd)}`,
                  value: margin.weekRevenueUsd,
                  className: 'text-emerald-500',
                },
                {
                  label: `Spend · ${formatUsd(margin.weekSpendUsd)}`,
                  value: margin.weekSpendUsd,
                  className: 'text-rose-500',
                },
              ]}
            />
          </CardContent>
        </Card>
      </div>

      <Card className="gap-3 py-5">
        <CardHeader className="px-5">
          <div className="flex items-baseline justify-between">
            <div>
              <CardDescription className="text-xs tracking-[0.18em] uppercase">
                Revenue · 7 days
              </CardDescription>
              <CardTitle className="text-xl font-bold">Stripe revenue trend</CardTitle>
            </div>
            <Link
              href="/admin/margin"
              className="text-muted-foreground hover:text-foreground text-xs font-semibold"
            >
              Margin details →
            </Link>
          </div>
        </CardHeader>
        <CardContent className="px-5">
          <BarChart
            ariaLabel="Daily Stripe revenue and Gemini spend bar chart"
            data={margin.daily.map((d) => ({
              label: d.label,
              value: Number(d.revenueUsd.toFixed(2)),
            }))}
            secondary={{
              data: margin.daily.map((d) => ({
                label: d.label,
                value: Number(d.spendUsd.toFixed(2)),
              })),
              label: 'Spend',
              className: 'text-rose-500',
            }}
            primaryLabel="Revenue"
            primaryClassName="text-emerald-500"
            formatValue={(n) => `$${n.toFixed(0)}`}
          />
        </CardContent>
      </Card>

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard
          icon={<Sparkles className="size-4" />}
          label="Trends"
          value={counts.trendsTotal}
          hint={`${counts.trendsLive} live`}
        />
        <StatCard
          icon={<Inbox className="size-4" />}
          label="Pending suggestions"
          value={counts.pendingSuggestions}
          hint={counts.pendingSuggestions > 0 ? 'Inbox needs review' : 'Inbox clear'}
        />
        <StatCard
          icon={<Flame className="size-4" />}
          label="Top spend trend"
          value={margin.topTrendTitle ?? '—'}
          hint={`${formatUsd(margin.topTrendSpendUsd)} this week`}
        />
      </div>

      {margin.isMock && (
        <p className="text-muted-foreground flex items-center gap-2 text-xs">
          <Badge
            variant="outline"
            className="rounded-full border-amber-400/40 bg-amber-400/10 text-[10px] tracking-wider text-amber-700 uppercase dark:text-amber-300"
          >
            demo data
          </Badge>
          Showing seed-stage figures while we accrue a clean 90-day revenue history. Real-mode
          dashboards activate the moment the <code className="font-mono">webhook_events</code> or{' '}
          <code className="font-mono">generations</code> tables record a single row.
        </p>
      )}

      <div>
        <h2 className="text-muted-foreground mb-3 text-sm font-semibold tracking-[0.2em] uppercase">
          Jump to
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          <AdminTile
            href="/admin/engagement"
            icon={<BarChart3 className="size-5" />}
            title="Engagement"
            description="Impressions, clicks, CTR by trend."
            accent="from-[var(--brand-grad-1)] to-[var(--brand-grad-2)]"
          />
          <AdminTile
            href="/admin/margin"
            icon={<DollarSign className="size-5" />}
            title="Margin"
            description="Revenue, spend, gens per day."
            accent="from-emerald-400 to-cyan-400"
          />
          <AdminTile
            href="/admin/trends"
            icon={<Sparkles className="size-5" />}
            title="Trends"
            description="Catalogue, eval, lifecycle."
            accent="from-[var(--brand-grad-1)] to-[var(--brand-grad-3)]"
          />
          <AdminTile
            href="/admin/suggestions"
            icon={<Inbox className="size-5" />}
            title="Suggestions"
            description="Auto + community inbox."
            accent="from-[var(--brand-violet)] to-[var(--brand-cyan)]"
            badge={
              counts.pendingSuggestions > 0 ? `${counts.pendingSuggestions} pending` : undefined
            }
          />
          <AdminTile
            href="/admin/referrals"
            icon={<Gift className="size-5" />}
            title="Referrals"
            description="Top referrers + conversion."
            accent="from-pink-400 to-amber-400"
          />
          <AdminTile
            href="/admin/refunds"
            icon={<LifeBuoy className="size-5" />}
            title="Refunds"
            description="Manual credit grants."
            accent="from-rose-400 to-orange-400"
          />
          <AdminTile
            href="/admin/audit"
            icon={<Archive className="size-5" />}
            title="Audit log"
            description="Compliance trail."
            accent="from-[var(--brand-grad-2)] to-[var(--brand-grad-3)]"
          />
        </div>
      </div>
    </section>
  )
}
