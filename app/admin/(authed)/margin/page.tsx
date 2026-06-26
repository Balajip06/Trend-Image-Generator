import {
  Activity,
  Coins,
  DollarSign,
  Flame,
  LineChart,
  Sparkles,
  Target,
  Timer,
  Trophy,
  Users,
} from 'lucide-react'
import Link from 'next/link'
import { BarChart, Delta, DonutChart } from '@/components/admin/Charts'
import { KpiCard } from '@/components/admin/KpiCard'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  getMarginDetail,
  getRevenueCohorts,
  getTrendLeaderboard,
  getUnitEconomics,
} from '@/lib/analytics/margin'
import type {
  RevenueCohortRow,
  TrendLeaderboardRow,
  UnitEconomicsResult,
} from '@/lib/analytics/margin'
import { MOCKS_ALLOWED } from '@/lib/dev/mock-data'
import { createServiceClient } from '@/lib/supabase/server'
import { cn } from '@/lib/utils/cn'

export const dynamic = 'force-dynamic'

const VALID_RANGES = [7, 30, 90] as const
type Range = (typeof VALID_RANGES)[number]

const VALID_REVENUE_RANGES = [12, 26, 52] as const
type RevenueRange = (typeof VALID_REVENUE_RANGES)[number]

interface MarginPageProps {
  searchParams: Promise<{
    range?: string
    mockOverride?: string
    revenueRange?: string
    tab?: string
  }>
}

function parseRange(raw: string | undefined): Range {
  const n = raw ? Number(raw) : 30
  return (VALID_RANGES as readonly number[]).includes(n) ? (n as Range) : 30
}

function parseRevenueRange(raw: string | undefined): RevenueRange {
  const n = raw ? Number(raw) : 12
  return (VALID_REVENUE_RANGES as readonly number[]).includes(n) ? (n as RevenueRange) : 12
}

const VALID_TABS = ['overview', 'leaderboard', 'cohorts', 'unit-economics'] as const
type TabValue = (typeof VALID_TABS)[number]

function parseTab(raw: string | undefined): TabValue {
  return (VALID_TABS as readonly string[]).includes(raw ?? '') ? (raw as TabValue) : 'overview'
}

function formatUsd(n: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n)
}

function formatNumber(n: number): string {
  return new Intl.NumberFormat('en-US').format(n)
}

export default async function AdminMarginPage({ searchParams }: MarginPageProps) {
  const {
    range: rangeRaw,
    mockOverride,
    revenueRange: revenueRangeRaw,
    tab: tabRaw,
  } = await searchParams
  const range = parseRange(rangeRaw)
  const revenueRange = parseRevenueRange(revenueRangeRaw)
  const tab = parseTab(tabRaw)
  // Demo-data toggle is a dev/preview affordance only — never in production,
  // where empty tables must read as real zeros, not seed figures.
  const forceMock = MOCKS_ALLOWED && mockOverride === '1'
  // Service client: margin sums `generations` across ALL users; the authed client is
  // bound by `generations_own_read` and would count only the admin's own rows.
  const supabase = createServiceClient()
  const [margin, leaderboard, revenueCohorts, unitEconomics] = await Promise.all([
    getMarginDetail(supabase, 7, { forceMock }),
    getTrendLeaderboard(supabase, { days: range, limit: 20 }),
    getRevenueCohorts(supabase, revenueRange),
    getUnitEconomics(supabase, 8),
  ])

  const netUsd = margin.weekRevenueUsd - margin.weekSpendUsd
  const priorNet = margin.priorWeek.revenueUsd - margin.priorWeek.spendUsd
  const priorMarginPct =
    margin.priorWeek.revenueUsd > 0
      ? ((margin.priorWeek.revenueUsd - margin.priorWeek.spendUsd) / margin.priorWeek.revenueUsd) *
        100
      : 0

  const topSpend = margin.trendBreakdown[0]?.spendUsd ?? 0

  return (
    <section className="flex flex-col gap-8">
      <header className="flex flex-col gap-2">
        <p className="text-muted-foreground text-xs font-semibold tracking-[0.2em] uppercase">
          Revenue
        </p>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="flex items-center gap-3">
            <h1 className="text-3xl font-extrabold tracking-tight">
              <span className="text-gradient-hero">Margin</span>
            </h1>
            {margin.isMock && !forceMock && (
              <Badge
                variant="outline"
                className="rounded-full border-amber-400/40 bg-amber-400/10 text-amber-700 dark:text-amber-300"
              >
                demo data
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-3">
            {MOCKS_ALLOWED && <DataSourceToggle forceMock={forceMock} range={range} />}
            <p className="text-muted-foreground text-xs">UTC · refreshed on load</p>
          </div>
        </div>
        <p className="text-muted-foreground text-sm">
          Gemini Nano Banana spend is live from <code className="font-mono text-xs">generations</code>.
          Revenue stays at $0 until Stripe billing is wired (revenue is read from the Stripe webhook),
          so net margin reflects spend only for now.
        </p>
      </header>

      {forceMock && (
        <div
          role="status"
          className="rounded-2xl border border-amber-400/40 bg-amber-400/10 px-4 py-3 text-sm text-amber-800 dark:text-amber-300"
        >
          Viewing demo data — flip back to live before showing diligence.
        </div>
      )}

      <Tabs defaultValue={tab} className="w-full">
        <TabsList>
          <TabsTrigger value="overview">Margin overview</TabsTrigger>
          <TabsTrigger value="leaderboard">Trend leaderboard</TabsTrigger>
          <TabsTrigger value="cohorts">Revenue cohorts</TabsTrigger>
          <TabsTrigger value="unit-economics">Unit economics</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="flex flex-col gap-8 pt-6">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <KpiCard
              icon={<DollarSign className="size-4" />}
              label="Revenue"
              value={formatUsd(margin.weekRevenueUsd)}
              delta={
                <Delta current={margin.weekRevenueUsd} previous={margin.priorWeek.revenueUsd} />
              }
              tone="text-emerald-500"
              series={margin.daily.map((d) => ({ label: d.label, value: d.revenueUsd }))}
              ariaLabel="Daily revenue, last 7 days"
            />
            <KpiCard
              icon={<Flame className="size-4" />}
              label="Spend"
              value={formatUsd(margin.weekSpendUsd)}
              delta={
                <Delta current={margin.weekSpendUsd} previous={margin.priorWeek.spendUsd} invert />
              }
              tone="text-rose-500"
              series={margin.daily.map((d) => ({ label: d.label, value: d.spendUsd }))}
              ariaLabel="Daily Gemini spend, last 7 days"
            />
            <KpiCard
              icon={<Coins className="size-4" />}
              label="Net margin"
              value={formatUsd(netUsd)}
              delta={<Delta current={netUsd} previous={priorNet} />}
              tone="text-[var(--brand-grad-1)]"
              series={margin.daily.map((d) => ({
                label: d.label,
                value: Number((d.revenueUsd - d.spendUsd).toFixed(2)),
              }))}
              ariaLabel="Daily net margin, last 7 days"
            />
            <KpiCard
              icon={<Activity className="size-4" />}
              label="Generations"
              value={formatNumber(margin.weekGenerations)}
              delta={
                <Delta current={margin.weekGenerations} previous={margin.priorWeek.generations} />
              }
              tone="text-[var(--brand-cyan)]"
              series={margin.daily.map((d) => ({ label: d.label, value: d.generations }))}
              ariaLabel="Daily completed generations, last 7 days"
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <Card className="gap-3 py-5 lg:col-span-2">
              <CardHeader className="px-5">
                <CardDescription className="text-xs tracking-[0.18em] uppercase">
                  Daily flow · 7 days
                </CardDescription>
                <CardTitle className="text-xl font-bold">Revenue vs spend</CardTitle>
              </CardHeader>
              <CardContent className="px-5">
                <BarChart
                  ariaLabel="Daily revenue and spend bar chart"
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
                  valueFormat="usd0"
                />
              </CardContent>
            </Card>

            <Card className="gap-3 py-5">
              <CardHeader className="px-5">
                <CardDescription className="text-xs tracking-[0.18em] uppercase">
                  Margin split
                </CardDescription>
                <CardTitle className="text-xl font-bold">
                  {margin.marginPct.toFixed(1)}% net
                </CardTitle>
                <p className="text-muted-foreground text-xs">
                  Prior week {priorMarginPct.toFixed(1)}% · avg cost {formatUsd(margin.avgCostUsd)}{' '}
                  / gen
                </p>
              </CardHeader>
              <CardContent className="px-5">
                <DonutChart
                  ariaLabel="Donut chart of revenue and spend share"
                  centerValue={`${margin.marginPct.toFixed(0)}%`}
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

          <Card className="gap-0 overflow-hidden py-0">
            <CardHeader className="px-5 py-4">
              <CardTitle className="text-lg font-bold">Spend by trend</CardTitle>
              <CardDescription className="text-xs">
                Top spend drivers this week · click to open the trend
              </CardDescription>
            </CardHeader>
            {margin.trendBreakdown.length === 0 ? (
              <div className="text-muted-foreground flex flex-col items-center gap-2 px-5 py-10 text-center text-sm">
                <Sparkles className="size-6" />
                <p>No completed generations in the window yet.</p>
              </div>
            ) : (
              <ul className="divide-border/60 divide-y">
                {margin.trendBreakdown.map((row, idx) => {
                  const pct = topSpend === 0 ? 0 : (row.spendUsd / topSpend) * 100
                  const inner = (
                    <div className="flex flex-col gap-2 px-5 py-4">
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex min-w-0 items-center gap-3">
                          <span className="bg-muted text-muted-foreground grid size-7 shrink-0 place-items-center rounded-lg font-mono text-xs">
                            {idx + 1}
                          </span>
                          <p className="text-foreground truncate font-semibold">{row.title}</p>
                        </div>
                        <div className="flex shrink-0 items-baseline gap-3 font-mono text-xs tabular-nums">
                          <span className="text-muted-foreground">{row.generations} gens</span>
                          <span className="text-foreground font-semibold">
                            {formatUsd(row.spendUsd)}
                          </span>
                        </div>
                      </div>
                      <div className="bg-muted h-1.5 overflow-hidden rounded-full">
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-rose-500 to-orange-400"
                          style={{ width: `${Math.max(2, pct)}%` }}
                          aria-hidden="true"
                        />
                      </div>
                    </div>
                  )
                  return (
                    <li key={row.trendId}>
                      {row.trendId.startsWith('mock-') ? (
                        <div>{inner}</div>
                      ) : (
                        <Link
                          href={`/admin/trends/${row.trendId}/edit`}
                          className="hover:bg-muted/30 block transition-colors"
                        >
                          {inner}
                        </Link>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}
          </Card>

          <p className="text-muted-foreground text-xs">
            Need to issue a credit refund?{' '}
            <Link href="/admin/refunds" className="text-foreground font-semibold hover:underline">
              Open refunds →
            </Link>
          </p>
        </TabsContent>

        <TabsContent value="leaderboard" className="flex flex-col gap-6 pt-6">
          <LeaderboardSection rows={leaderboard} range={range} />
        </TabsContent>

        <TabsContent value="cohorts" className="flex flex-col gap-6 pt-6">
          <RevenueCohortsSection rows={revenueCohorts} range={revenueRange} />
        </TabsContent>

        <TabsContent value="unit-economics" className="flex flex-col gap-6 pt-6">
          <UnitEconomicsSection data={unitEconomics} />
        </TabsContent>
      </Tabs>
    </section>
  )
}

interface LeaderboardSectionProps {
  rows: TrendLeaderboardRow[]
  range: Range
}

function LeaderboardSection({ rows, range }: LeaderboardSectionProps) {
  const topGen = rows[0]?.genCount ?? 0

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="text-xl font-bold tracking-tight">Top trends by generation volume</h2>
          <p className="text-muted-foreground text-xs">
            Window: last {range} days · top 20 · ordered by completed generations
          </p>
        </div>
        <div
          className="border-border/60 bg-muted/40 inline-flex items-center gap-1 rounded-lg border p-1"
          aria-label="Range selector"
        >
          {VALID_RANGES.map((opt) => {
            const active = opt === range
            return (
              <Link
                key={opt}
                href={`/admin/margin?range=${opt}#trend-leaderboard`}
                className={cn(
                  'rounded-md px-2.5 py-1 text-xs font-semibold transition-colors',
                  active
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                )}
                aria-current={active ? 'page' : undefined}
              >
                {opt}d
              </Link>
            )
          })}
        </div>
      </div>

      {rows.length === 0 ? (
        <EmptyLeaderboard />
      ) : (
        <>
          <Card className="gap-3 py-5">
            <CardHeader className="px-5">
              <CardDescription className="text-xs tracking-[0.18em] uppercase">
                Top 10 · gen volume
              </CardDescription>
              <CardTitle className="text-lg font-bold">Distribution</CardTitle>
            </CardHeader>
            <CardContent className="px-5">
              <BarChart
                ariaLabel="Top 10 trends by generation count"
                data={rows.slice(0, 10).map((r) => ({
                  label: r.title.length > 10 ? `${r.title.slice(0, 10)}…` : r.title,
                  value: r.genCount,
                }))}
                primaryLabel="Generations"
                primaryClassName="text-[var(--brand-grad-1)]"
              />
            </CardContent>
          </Card>

          <Card className="gap-0 overflow-hidden py-0" id="trend-leaderboard">
            <CardHeader className="px-5 py-4">
              <CardTitle className="flex items-center gap-2 text-lg font-bold">
                <Trophy className="size-4 text-[var(--brand-grad-1)]" />
                Leaderboard
              </CardTitle>
              <CardDescription className="text-xs">
                {rows.length} trends · click row to open trend editor
              </CardDescription>
            </CardHeader>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-border/60 bg-muted/30 text-muted-foreground border-b text-left text-[10px] tracking-wider uppercase">
                    <th className="px-5 py-2.5 font-semibold">Rank</th>
                    <th className="px-3 py-2.5 font-semibold">Trend</th>
                    <th className="px-3 py-2.5 text-right font-semibold">Gens</th>
                    <th className="px-3 py-2.5 text-right font-semibold">Shares</th>
                    <th className="px-3 py-2.5 text-right font-semibold">Paid users</th>
                    <th className="px-5 py-2.5 text-right font-semibold">Revenue</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, idx) => (
                    <LeaderboardRow key={row.trendId} row={row} rank={idx + 1} topGen={topGen} />
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <p className="text-muted-foreground text-xs">
            Refreshes per page load; no materialized view yet. For &gt;10k gens/day, consider
            matview (Phase 11). Per-trend revenue attribution lands in W14+.
          </p>
        </>
      )}
    </>
  )
}

interface LeaderboardRowProps {
  row: TrendLeaderboardRow
  rank: number
  topGen: number
}

const RANK_BADGE_TONE: Record<number, string> = {
  1: 'bg-gradient-to-r from-amber-400 to-orange-400 text-white',
  2: 'bg-gradient-to-r from-[var(--brand-grad-1)] to-[var(--brand-grad-2)] text-white',
  3: 'bg-gradient-to-r from-[var(--brand-violet)] to-[var(--brand-cyan)] text-white',
}

function LeaderboardRow({ row, rank, topGen }: LeaderboardRowProps) {
  const pct = topGen === 0 ? 0 : (row.genCount / topGen) * 100
  const isMock = row.trendId.startsWith('mock-')
  const trendCell = (
    <div className="flex min-w-0 flex-col gap-0.5">
      <p className="text-foreground truncate font-semibold">{row.title}</p>
      <p className="text-muted-foreground truncate font-mono text-[11px]">{row.slug}</p>
    </div>
  )
  return (
    <tr className="border-border/40 hover:bg-muted/30 border-b transition-colors">
      <td className="px-5 py-3 align-middle">
        {rank <= 3 ? (
          <span
            className={cn(
              'inline-flex h-6 min-w-[2rem] items-center justify-center rounded-md px-2 font-mono text-[11px] font-bold tracking-wide shadow-sm',
              RANK_BADGE_TONE[rank]
            )}
            aria-label={`Rank ${rank}`}
          >
            #{rank}
          </span>
        ) : (
          <span className="text-muted-foreground font-mono text-xs">#{rank}</span>
        )}
      </td>
      <td className="min-w-[12rem] px-3 py-3 align-middle">
        {isMock ? (
          trendCell
        ) : (
          <Link
            href={`/admin/trends/${row.trendId}/edit`}
            className="block hover:text-[var(--brand-grad-1)]"
          >
            {trendCell}
          </Link>
        )}
        <div className="bg-muted mt-1.5 h-1 overflow-hidden rounded-full">
          <div
            className="h-full rounded-full bg-gradient-to-r from-[var(--brand-grad-1)] to-[var(--brand-grad-2)]"
            style={{ width: `${Math.max(2, pct)}%` }}
            aria-hidden="true"
          />
        </div>
      </td>
      <td className="px-3 py-3 text-right align-middle font-mono text-xs tabular-nums">
        {formatNumber(row.genCount)}
      </td>
      <td className="text-muted-foreground px-3 py-3 text-right align-middle font-mono text-xs tabular-nums">
        {formatNumber(row.shareTotal)}
      </td>
      <td className="text-muted-foreground px-3 py-3 text-right align-middle font-mono text-xs tabular-nums">
        {formatNumber(row.paidUsersCount)}
      </td>
      <td className="text-muted-foreground px-5 py-3 text-right align-middle font-mono text-xs tabular-nums">
        {row.revenueUsd > 0 ? formatUsd(row.revenueUsd) : '—'}
      </td>
    </tr>
  )
}

interface DataSourceToggleProps {
  forceMock: boolean
  range: Range
}

// Pill toggle between live data and the mock-shaped fallback. Preserves the
// current ?range= so the leaderboard window doesn't jump when toggled.
function DataSourceToggle({ forceMock, range }: DataSourceToggleProps) {
  const realHref = `/admin/margin?range=${range}`
  const mockHref = `/admin/margin?range=${range}&mockOverride=1`
  return (
    <div
      className="border-border/60 bg-muted/40 inline-flex items-center gap-1 rounded-full border p-1"
      aria-label="Data source"
    >
      <Link
        href={realHref}
        aria-current={!forceMock ? 'page' : undefined}
        className={cn(
          'rounded-full px-2.5 py-1 text-[11px] font-semibold transition-colors',
          !forceMock
            ? 'bg-background text-foreground shadow-sm'
            : 'text-muted-foreground hover:text-foreground'
        )}
      >
        Real data
      </Link>
      <Link
        href={mockHref}
        aria-current={forceMock ? 'page' : undefined}
        className={cn(
          'rounded-full px-2.5 py-1 text-[11px] font-semibold transition-colors',
          forceMock
            ? 'bg-amber-400/20 text-amber-800 shadow-sm dark:text-amber-300'
            : 'text-muted-foreground hover:text-foreground'
        )}
      >
        Demo data
      </Link>
    </div>
  )
}

function EmptyLeaderboard() {
  return (
    <div className="border-border/60 bg-card/40 text-muted-foreground flex flex-col items-center gap-2 rounded-3xl border border-dashed p-12 text-center text-sm">
      <Sparkles className="size-6" />
      <p>No completed generations in the window yet.</p>
    </div>
  )
}

/* -------------------------------------------------------------------------- *
 * Revenue cohorts (Dashboard A)
 * -------------------------------------------------------------------------- */

interface RevenueCohortsSectionProps {
  rows: RevenueCohortRow[]
  range: RevenueRange
}

function formatWeekLabel(weekStart: string): string {
  // weekStart is the Monday of the week; show the date in short form.
  const d = new Date(`${weekStart}T00:00:00Z`)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
}

function RevenueCohortsSection({ rows, range }: RevenueCohortsSectionProps) {
  const totals = rows.reduce(
    (acc, r) => ({
      revenueUsd: acc.revenueUsd + r.revenueUsd,
      refundsUsd: acc.refundsUsd + r.refundsUsd,
      netUsd: acc.netUsd + r.netUsd,
      txCount: acc.txCount + r.txCount,
      uniqueCustomers: acc.uniqueCustomers + r.uniqueCustomers,
    }),
    { revenueUsd: 0, refundsUsd: 0, netUsd: 0, txCount: 0, uniqueCustomers: 0 }
  )
  const blendedRefundRate = totals.revenueUsd > 0 ? totals.refundsUsd / totals.revenueUsd : 0

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="text-xl font-bold tracking-tight">Weekly revenue cohorts</h2>
          <p className="text-muted-foreground text-xs">
            Stripe checkout revenue grouped by UTC-Monday cohort · refunds proxied from credit-grant
            audit entries (real Stripe refund events coming).
          </p>
        </div>
        <div
          className="border-border/60 bg-muted/40 inline-flex items-center gap-1 rounded-lg border p-1"
          aria-label="Cohort window"
        >
          {VALID_REVENUE_RANGES.map((opt) => {
            const active = opt === range
            return (
              <Link
                key={opt}
                href={`/admin/margin?tab=cohorts&revenueRange=${opt}`}
                className={cn(
                  'rounded-md px-2.5 py-1 text-xs font-semibold transition-colors',
                  active
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                )}
                aria-current={active ? 'page' : undefined}
              >
                {opt}w
              </Link>
            )
          })}
        </div>
      </div>

      <Card className="gap-3 py-5">
        <CardHeader className="px-5">
          <CardDescription className="text-xs tracking-[0.18em] uppercase">
            Weekly net revenue · {range} weeks
          </CardDescription>
          <CardTitle className="text-lg font-bold">
            {formatUsd(totals.netUsd)} net · {formatUsd(totals.refundsUsd)} refunds
            <span className="text-muted-foreground ml-2 text-xs font-normal">
              {(blendedRefundRate * 100).toFixed(1)}% blended refund rate
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="px-5">
          <BarChart
            ariaLabel="Weekly net revenue"
            data={rows.map((r) => ({
              label: formatWeekLabel(r.weekStart),
              value: Number(r.netUsd.toFixed(2)),
            }))}
            primaryLabel="Net revenue"
            primaryClassName="text-emerald-500"
            valueFormat="usd0"
          />
        </CardContent>
      </Card>

      <Card className="gap-0 overflow-hidden py-0">
        <CardHeader className="px-5 py-4">
          <CardTitle className="text-lg font-bold">Cohort detail</CardTitle>
          <CardDescription className="text-xs">
            One row per UTC-Monday cohort · ordered oldest → newest
          </CardDescription>
        </CardHeader>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-border/60 bg-muted/30 text-muted-foreground border-b text-left text-[10px] tracking-wider uppercase">
                <th className="px-5 py-2.5 font-semibold">Week (UTC)</th>
                <th className="px-3 py-2.5 text-right font-semibold">Revenue</th>
                <th className="px-3 py-2.5 text-right font-semibold">Refunds</th>
                <th className="px-3 py-2.5 text-right font-semibold">Net</th>
                <th className="px-3 py-2.5 text-right font-semibold">Tx</th>
                <th className="px-3 py-2.5 text-right font-semibold">Customers</th>
                <th className="px-5 py-2.5 text-right font-semibold">Refund rate</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.weekStart} className="border-border/40 border-b">
                  <td className="px-5 py-3 align-middle font-mono text-xs tabular-nums">
                    {formatWeekLabel(r.weekStart)}
                  </td>
                  <td className="px-3 py-3 text-right align-middle font-mono text-xs tabular-nums">
                    {formatUsd(r.revenueUsd)}
                  </td>
                  <td className="px-3 py-3 text-right align-middle font-mono text-xs text-rose-500 tabular-nums">
                    {r.refundsUsd > 0 ? `−${formatUsd(r.refundsUsd)}` : '—'}
                  </td>
                  <td className="px-3 py-3 text-right align-middle font-mono text-xs font-semibold tabular-nums">
                    {formatUsd(r.netUsd)}
                  </td>
                  <td className="text-muted-foreground px-3 py-3 text-right align-middle font-mono text-xs tabular-nums">
                    {formatNumber(r.txCount)}
                  </td>
                  <td className="text-muted-foreground px-3 py-3 text-right align-middle font-mono text-xs tabular-nums">
                    {formatNumber(r.uniqueCustomers)}
                  </td>
                  <td className="text-muted-foreground px-5 py-3 text-right align-middle font-mono text-xs tabular-nums">
                    {(r.refundRate * 100).toFixed(1)}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <p className="text-muted-foreground text-xs">
        Refunds today are a proxy from <code className="font-mono">admin_audit_log</code>{' '}
        credit-grant entries ($0.10/credit). Wire real{' '}
        <code className="font-mono">charge.refunded</code> Stripe webhooks here for accurate
        figures.
      </p>
    </>
  )
}

/* -------------------------------------------------------------------------- *
 * Unit economics (Dashboard D — CAC + LTV + payback)
 * -------------------------------------------------------------------------- */

interface UnitEconomicsSectionProps {
  data: UnitEconomicsResult
}

function formatCac(n: number): string {
  if (!Number.isFinite(n)) return '—'
  return formatUsd(n)
}

function formatPayback(n: number): string {
  if (!Number.isFinite(n)) return '—'
  return `${n.toFixed(1)} d`
}

function UnitEconomicsSection({ data }: UnitEconomicsSectionProps) {
  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="text-xl font-bold tracking-tight">Unit economics</h2>
          <p className="text-muted-foreground text-xs">
            CAC from manual <code className="font-mono">admin_marketing_spend</code> entries ÷
            attributed signups · LTV from per-cohort Stripe revenue at days 7 / 30 / 60.
          </p>
        </div>
        {data.isMock && (
          <Badge
            variant="outline"
            className="rounded-full border-amber-400/40 bg-amber-400/10 text-amber-700 dark:text-amber-300"
          >
            demo data
          </Badge>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <KpiCard
          icon={<Target className="size-4" />}
          label="Blended CAC · 30d"
          value={formatCac(data.blendedCac)}
          delta={<span className="text-muted-foreground text-xs">last 30d</span>}
          tone="text-rose-500"
          series={data.ltvByCohort.map((c) => ({
            label: formatWeekLabel(c.cohortWeek),
            value: c.cohortSize,
          }))}
          ariaLabel="Cohort size by week"
        />
        <KpiCard
          icon={<Users className="size-4" />}
          label="Blended LTV · day 30"
          value={formatUsd(data.blendedLtv30)}
          delta={<span className="text-muted-foreground text-xs">avg last 4 cohorts</span>}
          tone="text-emerald-500"
          series={data.ltvByCohort.map((c) => ({
            label: formatWeekLabel(c.cohortWeek),
            value: c.ltvDay30,
          }))}
          ariaLabel="LTV day-30 trend"
        />
        <KpiCard
          icon={<Timer className="size-4" />}
          label="Payback"
          value={formatPayback(data.paybackDays)}
          delta={<span className="text-muted-foreground text-xs">CAC / (LTV30 / 30)</span>}
          tone="text-[var(--brand-grad-1)]"
          series={data.ltvByCohort.map((c) => ({
            label: formatWeekLabel(c.cohortWeek),
            value: c.ltvDay7,
          }))}
          ariaLabel="LTV day-7 trend"
        />
      </div>

      <Card className="gap-0 overflow-hidden py-0">
        <CardHeader className="px-5 py-4">
          <CardTitle className="flex items-center gap-2 text-lg font-bold">
            <LineChart className="size-4 text-[var(--brand-grad-1)]" />
            CAC by channel
          </CardTitle>
          <CardDescription className="text-xs">
            Ordered by spend desc · Infinity CAC (organic / no spend) renders as —
          </CardDescription>
        </CardHeader>
        {data.cacByChannel.length === 0 ? (
          <div className="text-muted-foreground flex flex-col items-center gap-2 px-5 py-10 text-center text-sm">
            <Sparkles className="size-6" />
            <p>No marketing spend or signups in the window yet.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-border/60 bg-muted/30 text-muted-foreground border-b text-left text-[10px] tracking-wider uppercase">
                  <th className="px-5 py-2.5 font-semibold">Channel</th>
                  <th className="px-3 py-2.5 text-right font-semibold">Signups</th>
                  <th className="px-3 py-2.5 text-right font-semibold">Spend</th>
                  <th className="px-5 py-2.5 text-right font-semibold">CAC</th>
                </tr>
              </thead>
              <tbody>
                {data.cacByChannel.map((r) => (
                  <tr key={r.channel} className="border-border/40 border-b">
                    <td className="px-5 py-3 align-middle font-mono text-xs tabular-nums">
                      {r.channel}
                    </td>
                    <td className="text-muted-foreground px-3 py-3 text-right align-middle font-mono text-xs tabular-nums">
                      {formatNumber(r.signupsAttributed)}
                    </td>
                    <td className="px-3 py-3 text-right align-middle font-mono text-xs tabular-nums">
                      {formatUsd(r.spendUsd)}
                    </td>
                    <td className="px-5 py-3 text-right align-middle font-mono text-xs font-semibold tabular-nums">
                      {formatCac(r.cac)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card className="gap-0 overflow-hidden py-0">
        <CardHeader className="px-5 py-4">
          <CardTitle className="text-lg font-bold">LTV by cohort</CardTitle>
          <CardDescription className="text-xs">
            One row per signup-cohort-week · revenue summed from Stripe checkout events · margin
            nets out Gemini cost
          </CardDescription>
        </CardHeader>
        {data.ltvByCohort.length === 0 ? (
          <div className="text-muted-foreground flex flex-col items-center gap-2 px-5 py-10 text-center text-sm">
            <Sparkles className="size-6" />
            <p>No signups in the cohort window yet.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-border/60 bg-muted/30 text-muted-foreground border-b text-left text-[10px] tracking-wider uppercase">
                  <th className="px-5 py-2.5 font-semibold">Week</th>
                  <th className="px-3 py-2.5 text-right font-semibold">Size</th>
                  <th className="px-3 py-2.5 text-right font-semibold">LTV d7</th>
                  <th className="px-3 py-2.5 text-right font-semibold">LTV d30</th>
                  <th className="px-3 py-2.5 text-right font-semibold">LTV d60</th>
                  <th className="px-5 py-2.5 text-right font-semibold">Gross margin</th>
                </tr>
              </thead>
              <tbody>
                {data.ltvByCohort.map((c) => (
                  <tr key={c.cohortWeek} className="border-border/40 border-b">
                    <td className="px-5 py-3 align-middle font-mono text-xs tabular-nums">
                      {formatWeekLabel(c.cohortWeek)}
                    </td>
                    <td className="text-muted-foreground px-3 py-3 text-right align-middle font-mono text-xs tabular-nums">
                      {formatNumber(c.cohortSize)}
                    </td>
                    <td className="px-3 py-3 text-right align-middle font-mono text-xs tabular-nums">
                      {formatUsd(c.ltvDay7)}
                    </td>
                    <td className="px-3 py-3 text-right align-middle font-mono text-xs tabular-nums">
                      {formatUsd(c.ltvDay30)}
                    </td>
                    <td className="px-3 py-3 text-right align-middle font-mono text-xs tabular-nums">
                      {formatUsd(c.ltvDay60)}
                    </td>
                    <td className="px-5 py-3 text-right align-middle font-mono text-xs tabular-nums">
                      {c.grossMarginPct.toFixed(1)}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <p className="text-muted-foreground text-xs">
        CAC requires <code className="font-mono">admin_marketing_spend</code> entries. Use{' '}
        <Link
          href="/admin/marketing-spend"
          className="text-foreground font-semibold hover:underline"
        >
          /admin/marketing-spend
        </Link>{' '}
        to record weekly spend (W6 follow-up — currently SQL-only).
      </p>
    </>
  )
}
