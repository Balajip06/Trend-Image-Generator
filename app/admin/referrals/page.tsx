import { Coins, Gift, ShieldCheck, Users } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  MOCK_REFERRAL_EVENTS,
  MOCK_REFERRERS,
  mockReferralTotals,
  type MockReferralEvent,
  type MockReferrer,
} from '@/lib/dev/mock-referrals'
import { MOCK_TRENDS_ENABLED } from '@/lib/dev/mock-data'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

interface PageData {
  totals: {
    total: number
    pending: number
    rewarded: number
    bonusCredited: number
  }
  topReferrers: MockReferrer[]
  recentEvents: MockReferralEvent[]
  isMock: boolean
}

interface ReferralJoinRow {
  id: string
  status: 'pending' | 'rewarded'
  created_at: string
  rewarded_at: string | null
  referrer: { id: string; email: string | null; referral_code: string } | null
  referred: { id: string; email: string | null } | null
}

async function loadData(): Promise<PageData> {
  if (MOCK_TRENDS_ENABLED) {
    return {
      totals: mockReferralTotals(),
      topReferrers: [...MOCK_REFERRERS].sort((a, b) => b.referrals_total - a.referrals_total),
      recentEvents: MOCK_REFERRAL_EVENTS,
      isMock: true,
    }
  }

  const supabase = await createClient()
  const { data: rawRows } = await supabase
    .from('referrals')
    .select(
      'id, status, created_at, rewarded_at, referrer:referrer_id(id, email, referral_code), referred:referred_id(id, email)'
    )
    .order('created_at', { ascending: false })
    .limit(50)
  const rows = (rawRows as unknown as ReferralJoinRow[] | null) ?? []

  if (rows.length === 0) {
    return {
      totals: mockReferralTotals(),
      topReferrers: [...MOCK_REFERRERS].sort((a, b) => b.referrals_total - a.referrals_total),
      recentEvents: MOCK_REFERRAL_EVENTS,
      isMock: true,
    }
  }

  const totals = rows.reduce(
    (acc, r) => {
      acc.total += 1
      if (r.status === 'rewarded') acc.rewarded += 1
      else acc.pending += 1
      return acc
    },
    { total: 0, pending: 0, rewarded: 0, bonusCredited: 0 }
  )

  // Bonus credited = 10 per rewarded row (mirrors trigger constant)
  totals.bonusCredited = totals.rewarded * 10

  // Top referrers by referrals made
  const byReferrer = new Map<string, { id: string; email: string; code: string; total: number; rewarded: number }>()
  for (const r of rows) {
    if (!r.referrer) continue
    const cur = byReferrer.get(r.referrer.id) ?? {
      id: r.referrer.id,
      email: r.referrer.email ?? 'unknown@example.com',
      code: r.referrer.referral_code,
      total: 0,
      rewarded: 0,
    }
    cur.total += 1
    if (r.status === 'rewarded') cur.rewarded += 1
    byReferrer.set(r.referrer.id, cur)
  }

  const topReferrers: MockReferrer[] = Array.from(byReferrer.values())
    .sort((a, b) => b.total - a.total)
    .slice(0, 10)
    .map((r) => ({
      id: r.id,
      email: r.email,
      referral_code: r.code,
      referrals_total: r.total,
      referrals_rewarded: r.rewarded,
      bonus_credits_earned: Math.min(50, r.rewarded * 10),
      joined_at: '',
    }))

  const recentEvents: MockReferralEvent[] = rows.slice(0, 20).map((r) => ({
    id: r.id,
    referrer_email: r.referrer?.email ?? 'unknown',
    referred_email: r.referred?.email ?? 'unknown',
    status: r.status,
    created_at: r.created_at,
    rewarded_at: r.rewarded_at,
  }))

  return { totals, topReferrers, recentEvents, isMock: false }
}

function formatRelative(iso: string): string {
  if (!iso) return ''
  const then = new Date(iso).getTime()
  const diffMs = Date.now() - then
  const days = Math.floor(diffMs / 86_400_000)
  if (days <= 0) return 'today'
  if (days === 1) return 'yesterday'
  return `${days}d ago`
}

export default async function AdminReferralsPage() {
  const { totals, topReferrers, recentEvents, isMock } = await loadData()

  return (
    <section className="flex flex-col gap-8">
      <header className="flex flex-col gap-2">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
          Growth
        </p>
        <div className="flex items-center gap-3">
          <h1 className="text-3xl font-extrabold tracking-tight">
            <span className="text-gradient-hero">Referrals</span>
          </h1>
          {isMock && (
            <Badge
              variant="outline"
              className="rounded-full border-amber-400/40 bg-amber-400/10 text-amber-700 dark:text-amber-300"
            >
              demo data
            </Badge>
          )}
        </div>
        <p className="text-sm text-muted-foreground">
          +10 credits to the referrer after the referee&apos;s first completed generation. Capped at 50 bonus credits per
          account.
        </p>
      </header>

      <div className="grid gap-4 sm:grid-cols-4">
        <StatTile
          icon={<Users className="size-4" />}
          label="Total referrals"
          value={totals.total}
          hint="all-time"
        />
        <StatTile
          icon={<ShieldCheck className="size-4" />}
          label="Rewarded"
          value={totals.rewarded}
          hint={`${totals.pending} pending`}
        />
        <StatTile
          icon={<Gift className="size-4" />}
          label="Bonus credited"
          value={totals.bonusCredited}
          hint="credits issued"
        />
        <StatTile
          icon={<Coins className="size-4" />}
          label="Conversion"
          value={
            totals.total === 0
              ? '—'
              : `${Math.round((totals.rewarded / totals.total) * 100)}%`
          }
          hint="rewarded ÷ total"
        />
      </div>

      <Card className="gap-0 overflow-hidden py-0">
        <CardHeader className="px-5 py-4">
          <CardTitle className="text-lg font-bold">Top referrers</CardTitle>
          <CardDescription className="text-xs">Ranked by referrals made</CardDescription>
        </CardHeader>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-muted/50 text-[11px] uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-semibold">#</th>
                <th className="px-4 py-3 font-semibold">Referrer</th>
                <th className="px-4 py-3 text-right font-semibold">Referrals</th>
                <th className="px-4 py-3 text-right font-semibold">Rewarded</th>
                <th className="px-4 py-3 text-right font-semibold">Bonus</th>
              </tr>
            </thead>
            <tbody>
              {topReferrers.map((r, idx) => (
                <tr
                  key={r.id}
                  className="border-t border-border/60 transition-colors hover:bg-muted/30"
                >
                  <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{idx + 1}</td>
                  <td className="px-4 py-3">
                    <div className="font-semibold">{r.email}</div>
                    <div className="font-mono text-[11px] text-muted-foreground">
                      /?ref={r.referral_code}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right font-mono tabular-nums">
                    {r.referrals_total}
                  </td>
                  <td className="px-4 py-3 text-right font-mono tabular-nums">
                    {r.referrals_rewarded}
                  </td>
                  <td className="px-4 py-3 text-right font-mono tabular-nums">
                    {r.bonus_credits_earned}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card className="gap-0 overflow-hidden py-0">
        <CardHeader className="px-5 py-4">
          <CardTitle className="text-lg font-bold">Recent activity</CardTitle>
          <CardDescription className="text-xs">Latest 20 referral events</CardDescription>
        </CardHeader>
        <CardContent className="px-0 py-0">
          <ul className="divide-y divide-border/60">
            {recentEvents.map((e) => (
              <li key={e.id} className="flex items-center justify-between gap-4 px-5 py-3 text-sm">
                <div className="min-w-0">
                  <p className="font-semibold">{e.referrer_email}</p>
                  <p className="text-xs text-muted-foreground">
                    invited {e.referred_email}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <Badge
                    variant={e.status === 'rewarded' ? 'default' : 'outline'}
                    className={
                      e.status === 'rewarded'
                        ? 'rounded-full bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-transparent'
                        : 'rounded-full text-muted-foreground'
                    }
                  >
                    {e.status}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    {formatRelative(e.rewarded_at ?? e.created_at)}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </section>
  )
}

interface StatTileProps {
  icon: React.ReactNode
  label: string
  value: number | string
  hint: string
}

function StatTile({ icon, label, value, hint }: StatTileProps) {
  return (
    <Card className="gap-2 py-5">
      <CardHeader className="px-5">
        <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
          <span className="grid size-6 place-items-center rounded-md bg-muted">{icon}</span>
          {label}
        </div>
        <CardTitle className="text-3xl font-extrabold tracking-tight">{value}</CardTitle>
      </CardHeader>
      <CardContent className="px-5 text-xs text-muted-foreground">{hint}</CardContent>
    </Card>
  )
}
