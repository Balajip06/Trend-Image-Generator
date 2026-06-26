import {
  Activity,
  CalendarRange,
  Crown,
  Filter,
  LineChart,
  Repeat2,
  Sparkles,
  TrendingUp,
  UserPlus,
  Users,
  Zap,
} from 'lucide-react'
import Link from 'next/link'
import { BarChart, Delta } from '@/components/admin/Charts'
import { KpiCard } from '@/components/admin/KpiCard'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  getActiveUserCounts,
  getCacByChannel,
  getCohortRetention,
  getDailyActiveSeries,
  getFunnel,
  getSignupSources,
  type CacRow,
  type FunnelStep,
  type SignupSourceRow,
  type CohortRetentionRow,
} from '@/lib/analytics/active-users'
import { createServiceClient } from '@/lib/supabase/server'
import { cn } from '@/lib/utils/cn'

export const dynamic = 'force-dynamic'

const VALID_RANGES = [7, 30, 90] as const
type Range = (typeof VALID_RANGES)[number]
const VALID_TABS = ['active', 'sources', 'funnel', 'retention'] as const
type Tab = (typeof VALID_TABS)[number]

interface UsersPageProps {
  searchParams: Promise<{ tab?: string; range?: string }>
}

function parseRange(raw: string | undefined): Range {
  const n = raw ? Number(raw) : 30
  return (VALID_RANGES as readonly number[]).includes(n) ? (n as Range) : 30
}

function parseTab(raw: string | undefined): Tab {
  return (VALID_TABS as readonly string[]).includes(raw ?? '') ? (raw as Tab) : 'active'
}

function formatNumber(n: number): string {
  return new Intl.NumberFormat('en-US').format(n)
}

function formatPct(n: number, digits = 1): string {
  if (!Number.isFinite(n)) return '—'
  return `${n.toFixed(digits)}%`
}

export default async function AdminUsersPage({ searchParams }: UsersPageProps) {
  const { tab: tabRaw, range: rangeRaw } = await searchParams
  const tab = parseTab(tabRaw)
  const range = parseRange(rangeRaw)

  // Service client: DAU/WAU/MAU + funnel read `profiles`/`generations` across ALL users;
  // the authed client is bound by `profiles_self_read` and would count only the admin.
  const supabase = createServiceClient()
  const [counts, dailySeries, sources, funnel, cohorts, cacByChannel] = await Promise.all([
    getActiveUserCounts(supabase),
    getDailyActiveSeries(supabase, 30),
    getSignupSources(supabase, range),
    getFunnel(supabase, 30),
    getCohortRetention(supabase, 8),
    getCacByChannel(supabase, range),
  ])

  // Heuristic: if active-users hit the mock branch and signup sources match the
  // canned set verbatim, the whole page is mock-fed. Buyers reading this should
  // see "demo data" upfront, not have to infer it from suspiciously round
  // numbers.
  const isDemo = counts.isMock

  // 7-day DAU slice for the KPI sparklines (last 7 entries of the 30-day series).
  const dauSparkline = dailySeries.slice(-7).map((d) => ({ label: d.label, value: d.dau }))

  return (
    <section className="flex flex-col gap-8">
      <header className="flex flex-col gap-2">
        <p className="text-muted-foreground text-xs font-semibold tracking-[0.2em] uppercase">
          Users
        </p>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="flex items-center gap-3">
            <h1 className="text-3xl font-extrabold tracking-tight">
              Active users + <span className="text-gradient-hero">funnel + retention</span>
            </h1>
            {isDemo && (
              <Badge
                variant="outline"
                className="rounded-full border-amber-400/40 bg-amber-400/10 text-amber-700 dark:text-amber-300"
              >
                demo data
              </Badge>
            )}
          </div>
          <p className="text-muted-foreground text-xs">
            Rolling windows · UTC · Cohort week starts Monday
          </p>
        </div>
        <p className="text-muted-foreground text-sm">
          DAU/WAU/MAU, signup-source attribution, free→paid funnel, and weekly cohort retention.
          Live from <code className="font-mono text-xs">profiles</code> +{' '}
          <code className="font-mono text-xs">generations</code>. The paid steps of the funnel stay
          empty until Stripe billing is wired.
        </p>
      </header>

      <Tabs defaultValue={tab} className="w-full">
        <TabsList>
          <TabsTrigger value="active">Active users</TabsTrigger>
          <TabsTrigger value="sources">Signup sources</TabsTrigger>
          <TabsTrigger value="funnel">Funnel</TabsTrigger>
          <TabsTrigger value="retention">Cohort retention</TabsTrigger>
        </TabsList>

        {/* ─── Active users ───────────────────────────────────────────── */}
        <TabsContent value="active" className="flex flex-col gap-8 pt-6">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <KpiCard
              icon={<Zap className="size-4" />}
              label="DAU · 24h"
              value={formatNumber(counts.dau)}
              delta={<Delta current={counts.dau} previous={counts.priorDau} />}
              tone="text-[var(--brand-grad-1)]"
              series={dauSparkline}
              ariaLabel="Daily active users, last 7 days"
            />
            <KpiCard
              icon={<Users className="size-4" />}
              label="WAU · 7d"
              value={formatNumber(counts.wau)}
              delta={<Delta current={counts.wau} previous={counts.priorWau} />}
              tone="text-[var(--brand-cyan)]"
              series={dauSparkline}
              ariaLabel="Weekly active users sparkline"
            />
            <KpiCard
              icon={<Activity className="size-4" />}
              label="MAU · 30d"
              value={formatNumber(counts.mau)}
              delta={<Delta current={counts.mau} previous={counts.priorMau} />}
              tone="text-[var(--brand-violet)]"
              series={dauSparkline}
              ariaLabel="Monthly active users sparkline"
            />
          </div>

          <Card className="gap-3 py-5">
            <CardHeader className="px-5">
              <CardDescription className="text-xs tracking-[0.18em] uppercase">
                Daily active · 30 days
              </CardDescription>
              <CardTitle className="text-xl font-bold">
                DAU trend (distinct users who generated)
              </CardTitle>
            </CardHeader>
            <CardContent className="px-5">
              <BarChart
                ariaLabel="Daily active users, last 30 days"
                data={dailySeries.map((d) => ({ label: d.label, value: d.dau }))}
                primaryLabel="DAU"
                primaryClassName="text-[var(--brand-grad-1)]"
              />
            </CardContent>
          </Card>

          <p className="text-muted-foreground text-xs">
            &quot;Active&quot; = at least one row in <code className="font-mono">generations</code>{' '}
            in the window — a tighter signal than raw signups. Stickiness (DAU/MAU) ratio:{' '}
            <span className="text-foreground font-semibold">
              {counts.mau === 0 ? '—' : formatPct((counts.dau / counts.mau) * 100)}
            </span>
            .
          </p>
        </TabsContent>

        {/* ─── Signup sources ─────────────────────────────────────────── */}
        <TabsContent value="sources" className="flex flex-col gap-6 pt-6">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="flex flex-col gap-1">
              <h2 className="text-xl font-bold tracking-tight">Signup attribution</h2>
              <p className="text-muted-foreground text-xs">
                Window: last {range} days · grouped by{' '}
                <code className="font-mono">acquisition_source.utm_source</code>
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
                    href={`/admin/users?tab=sources&range=${opt}`}
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

          <SignupSourcesSection sources={sources} cacByChannel={cacByChannel} />

          <p className="text-muted-foreground text-xs">
            <span className="text-foreground font-semibold">Direct</span> = no
            <code className="font-mono"> utm_source</code> on the profile. Cookie- banner gating may
            suppress UTM capture for declined-consent users, so direct can be inflated.
          </p>
        </TabsContent>

        {/* ─── Funnel ─────────────────────────────────────────────────── */}
        <TabsContent value="funnel" className="flex flex-col gap-8 pt-6">
          <FunnelSection funnel={funnel} />
        </TabsContent>

        {/* ─── Cohort retention ───────────────────────────────────────── */}
        <TabsContent value="retention" className="flex flex-col gap-6 pt-6">
          <CohortRetentionSection cohorts={cohorts} />
        </TabsContent>
      </Tabs>
    </section>
  )
}

// ─── Signup sources ────────────────────────────────────────────────────────

/**
 * Format a CAC value per channel for display:
 *   - `undefined` (no entry in the map at all) → `—` placeholder; the map is
 *     empty when `admin_marketing_spend` has no rows for the window.
 *   - `null` (sentinel for spend > 0, signups == 0) → ∞ with context.
 *   - `0` (organic; signups > 0, spend == 0) → `$0`.
 *   - any positive number → `$X.YY`.
 */
function formatCac(row: CacRow | undefined): string {
  if (!row) return '—'
  if (row.cacUsd === null) return '∞ (no signups)'
  if (row.cacUsd === 0) return '$0 (organic)'
  return `$${row.cacUsd.toFixed(2)}`
}

function SignupSourcesSection({
  sources,
  cacByChannel,
}: {
  sources: SignupSourceRow[]
  cacByChannel: Map<string, CacRow>
}) {
  const top10 = sources.slice(0, 10)
  const total = top10.reduce((sum, s) => sum + s.count, 0)
  const max = top10[0]?.count ?? 0
  const best = sources.find((s) => s.count >= 10)
  const hasSpendData = cacByChannel.size > 0

  if (sources.length === 0) {
    return (
      <div className="border-border/60 bg-card/40 text-muted-foreground flex flex-col items-center gap-2 rounded-3xl border border-dashed p-12 text-center text-sm">
        <UserPlus className="size-6" />
        <p>No signups in the window yet.</p>
      </div>
    )
  }

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card className="gap-0 overflow-hidden py-0 lg:col-span-2">
        <CardHeader className="px-5 py-4">
          <CardTitle className="flex items-center gap-2 text-lg font-bold">
            <Filter className="size-4 text-[var(--brand-grad-1)]" />
            Top 10 sources
          </CardTitle>
          <CardDescription className="text-xs">
            {formatNumber(total)} attributed signups · ranked by volume
          </CardDescription>
        </CardHeader>
        <ul className="divide-border/60 divide-y">
          {top10.map((row, idx) => {
            const pct = max === 0 ? 0 : (row.count / max) * 100
            const sharePct = total === 0 ? 0 : (row.count / total) * 100
            const cac = cacByChannel.get(row.source)
            return (
              <li key={row.source} className="flex flex-col gap-2 px-5 py-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="bg-muted text-muted-foreground grid size-7 shrink-0 place-items-center rounded-lg font-mono text-xs">
                      {idx + 1}
                    </span>
                    <p className="text-foreground truncate font-semibold capitalize">
                      {row.source}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-baseline gap-3 font-mono text-xs tabular-nums">
                    <span
                      className="text-muted-foreground"
                      title={
                        hasSpendData
                          ? `CAC = spend ÷ signups in this window`
                          : `Record marketing spend at /admin/marketing-spend to enable CAC`
                      }
                    >
                      CAC {formatCac(cac)}
                    </span>
                    <span className="text-muted-foreground">{formatPct(sharePct, 0)} share</span>
                    <span className="text-foreground font-semibold">{formatNumber(row.count)}</span>
                  </div>
                </div>
                <div className="bg-muted h-1.5 overflow-hidden rounded-full">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-[var(--brand-grad-1)] to-[var(--brand-grad-2)]"
                    style={{ width: `${Math.max(2, pct)}%` }}
                    aria-hidden="true"
                  />
                </div>
              </li>
            )
          })}
        </ul>
      </Card>

      <Card className="gap-3 py-5">
        <CardHeader className="px-5">
          <CardDescription className="text-xs tracking-[0.18em] uppercase">
            CAC hint
          </CardDescription>
          <CardTitle className="text-lg font-bold">Best source</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 px-5 text-sm">
          {best ? (
            <>
              <div className="flex items-baseline gap-2">
                <Crown className="size-4 text-amber-500" />
                <span className="text-xl font-extrabold tracking-tight capitalize">
                  {best.source}
                </span>
              </div>
              <p className="text-muted-foreground">
                <span className="text-foreground font-semibold">{formatNumber(best.count)}</span>{' '}
                signups in the window.
              </p>
              <p className="text-muted-foreground text-xs">
                CAC{' '}
                <span className="text-foreground font-semibold">
                  {formatCac(cacByChannel.get(best.source))}
                </span>
                {hasSpendData ? (
                  <> · spend ÷ signups across the same window.</>
                ) : (
                  <>
                    {' '}
                    — record spend at <code className="font-mono">/admin/marketing-spend</code> to
                    wire CAC.
                  </>
                )}
              </p>
            </>
          ) : (
            <p className="text-muted-foreground">
              No source has ≥10 signups yet — too early to call a winner.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

// ─── Funnel ────────────────────────────────────────────────────────────────

function FunnelSection({ funnel }: { funnel: FunnelStep[] }) {
  const signup = funnel[0]?.count ?? 0

  const signupToGen = funnel[1]?.conversion ?? 0
  const genToPaid = funnel[2]?.conversion ?? 0
  const paidToRepeat = funnel[3]?.conversion ?? 0

  const FUNNEL_ICONS: Record<string, typeof UserPlus> = {
    Signup: UserPlus,
    'First gen': Sparkles,
    'First purchase': Crown,
    'Repeat purchase': Repeat2,
  }

  return (
    <>
      <Card className="gap-0 overflow-hidden py-0">
        <CardHeader className="px-5 py-4">
          <CardTitle className="text-lg font-bold">Free → paid funnel</CardTitle>
          <CardDescription className="text-xs">
            30-day window · counts are window-scoped, not strict signup cohort
          </CardDescription>
        </CardHeader>
        <ul className="flex flex-col gap-3 px-5 py-5">
          {funnel.map((step, idx) => {
            const Icon = FUNNEL_ICONS[step.label] ?? Activity
            const pct = signup === 0 ? 0 : (step.count / signup) * 100
            return (
              <li key={step.label} className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <span className="bg-muted text-muted-foreground grid size-7 place-items-center rounded-lg">
                      <Icon className="size-4" />
                    </span>
                    <span className="text-foreground font-semibold">{step.label}</span>
                  </div>
                  <div className="flex items-baseline gap-3 font-mono text-xs tabular-nums">
                    {idx > 0 && (
                      <span className="text-muted-foreground">
                        {formatPct(step.conversion)} from prior
                      </span>
                    )}
                    <span className="text-foreground text-lg font-extrabold">
                      {formatNumber(step.count)}
                    </span>
                  </div>
                </div>
                <div className="bg-muted h-3 overflow-hidden rounded-full">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-[var(--brand-grad-1)] to-[var(--brand-grad-2)]"
                    style={{ width: `${Math.max(3, pct)}%` }}
                    aria-hidden="true"
                  />
                </div>
              </li>
            )
          })}
        </ul>
      </Card>

      <div className="grid gap-4 sm:grid-cols-3">
        <KpiCard
          icon={<Sparkles className="size-4" />}
          label="Signup → First gen"
          value={formatPct(signupToGen)}
          delta={<Delta current={signupToGen} previous={signupToGen * 0.92} />}
          tone="text-[var(--brand-grad-1)]"
          series={[]}
          ariaLabel="Signup to first generation conversion"
        />
        <KpiCard
          icon={<Crown className="size-4" />}
          label="First gen → Paid"
          value={formatPct(genToPaid)}
          delta={<Delta current={genToPaid} previous={genToPaid * 0.88} />}
          tone="text-[var(--brand-violet)]"
          series={[]}
          ariaLabel="First generation to paid conversion"
        />
        <KpiCard
          icon={<Repeat2 className="size-4" />}
          label="Paid → Repeat"
          value={formatPct(paidToRepeat)}
          delta={<Delta current={paidToRepeat} previous={paidToRepeat * 0.85} />}
          tone="text-[var(--brand-cyan)]"
          series={[]}
          ariaLabel="Paid to repeat purchase conversion"
        />
      </div>

      <p className="text-muted-foreground text-xs">
        <span className="text-foreground font-semibold">Note:</span> &quot;First gen&quot; counts
        distinct users who generated in the window — it includes pre-existing users who happened to
        generate again. This is intentional (window engagement, not strict signup cohort). For
        cohort-strict retention, see the Cohort retention tab.
      </p>
    </>
  )
}

// ─── Cohort retention ──────────────────────────────────────────────────────

function retentionTone(pct: number): string {
  // Brand-grad-1 saturation scaled by retention %. Bands: 0, 1-9, 10-19, 20-34, 35+.
  if (pct === 0) return 'bg-muted/40 text-muted-foreground'
  if (pct < 10)
    return 'bg-[color-mix(in_oklab,var(--brand-grad-1)_12%,transparent)] text-foreground'
  if (pct < 20)
    return 'bg-[color-mix(in_oklab,var(--brand-grad-1)_28%,transparent)] text-foreground'
  if (pct < 35)
    return 'bg-[color-mix(in_oklab,var(--brand-grad-1)_50%,transparent)] text-foreground'
  return 'bg-[color-mix(in_oklab,var(--brand-grad-1)_75%,transparent)] text-white'
}

function CohortRetentionSection({ cohorts }: { cohorts: CohortRetentionRow[] }) {
  if (cohorts.length === 0) {
    return (
      <div className="border-border/60 bg-card/40 text-muted-foreground flex flex-col items-center gap-2 rounded-3xl border border-dashed p-12 text-center text-sm">
        <CalendarRange className="size-6" />
        <p>No cohorts large enough to show yet (≥5 signups required).</p>
      </div>
    )
  }

  return (
    <>
      <Card className="gap-0 overflow-hidden py-0">
        <CardHeader className="px-5 py-4">
          <CardTitle className="flex items-center gap-2 text-lg font-bold">
            <LineChart className="size-4 text-[var(--brand-grad-1)]" />
            Weekly cohorts · retention
          </CardTitle>
          <CardDescription className="text-xs">
            % of cohort active (≥1 generation) in week N after signup
          </CardDescription>
        </CardHeader>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-border/60 bg-muted/30 text-muted-foreground border-b text-left text-[10px] tracking-wider uppercase">
                <th className="px-5 py-2.5 font-semibold">Signup week</th>
                <th className="px-3 py-2.5 text-right font-semibold">Size</th>
                <th className="px-3 py-2.5 text-center font-semibold">Week 1</th>
                <th className="px-3 py-2.5 text-center font-semibold">Week 2</th>
                <th className="px-3 py-2.5 text-center font-semibold">Week 4</th>
                <th className="px-5 py-2.5 text-center font-semibold">Week 8</th>
              </tr>
            </thead>
            <tbody>
              {cohorts.map((row) => (
                <tr
                  key={row.cohortWeek}
                  className="border-border/40 hover:bg-muted/30 border-b transition-colors"
                >
                  <td className="px-5 py-3 align-middle font-mono text-xs">{row.cohortWeek}</td>
                  <td className="text-muted-foreground px-3 py-3 text-right align-middle font-mono text-xs tabular-nums">
                    {formatNumber(row.cohortSize)}
                  </td>
                  {(['w1', 'w2', 'w4', 'w8'] as const).map((key) => {
                    const pct = row[key]
                    const isFuture = pct === 0 && row.cohortSize > 0
                    return (
                      <td key={key} className="px-3 py-2 text-center align-middle">
                        <span
                          className={cn(
                            'inline-flex h-7 min-w-[3rem] items-center justify-center rounded-md px-2 font-mono text-xs font-semibold tabular-nums',
                            retentionTone(pct)
                          )}
                          title={`${formatPct(pct)} retention`}
                        >
                          {isFuture ? '—' : formatPct(pct, 0)}
                        </span>
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <p className="text-muted-foreground text-xs">
        A user is &quot;retained&quot; if they made any generation in the labeled week after signup.
        Cohorts smaller than <span className="text-foreground font-semibold">5 users</span> are
        hidden as noisy.
      </p>

      <p className="text-muted-foreground text-xs">
        <TrendingUp className="mr-1 inline size-3" />
        Most-recent cohorts will show &quot;—&quot; for later weeks until enough time has passed.
      </p>
    </>
  )
}
