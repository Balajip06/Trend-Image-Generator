import { DollarSign } from 'lucide-react'
import { FlashToasts } from '@/components/admin/FlashToasts'
import { LoadErrorBanner } from '@/components/admin/LoadErrorBanner'
import { RealtimeRefresh } from '@/components/admin/RealtimeRefresh'
import { GradientButton } from '@/components/brand/GradientButton'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { adminRead } from '@/lib/admin/read'
import { createServiceClient } from '@/lib/supabase/server'
import { recordMarketingSpend } from './actions'

export const dynamic = 'force-dynamic'

interface MarketingSpendPageProps {
  searchParams: Promise<{ ok?: string; error?: string }>
}

function formatUsd(n: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n)
}

/** Return today's Monday (UTC) as YYYY-MM-DD, used as the form default. */
function defaultWeekStart(): string {
  const now = new Date()
  const utc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  const dayOfWeek = utc.getUTCDay()
  const offset = dayOfWeek === 0 ? 6 : dayOfWeek - 1
  const monday = new Date(utc.getTime() - offset * 24 * 60 * 60 * 1000)
  return monday.toISOString().slice(0, 10)
}

export default async function AdminMarketingSpendPage({ searchParams }: MarketingSpendPageProps) {
  await searchParams

  const service = createServiceClient()
  // Unchecked, a failed read rendered "No spend recorded yet" — which could
  // prompt an admin to double-enter spend rows that already exist.
  const { rows: spend, error: loadError } = await adminRead(
    'marketing-spend.list',
    service
      .from('admin_marketing_spend')
      .select('id, week_start, channel, usd_spent, notes, created_at')
      .order('week_start', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(10)
  )

  return (
    <section className="flex flex-col gap-8">
      <FlashToasts
        flashes={[
          { key: 'ok', level: 'success', message: 'Spend recorded' },
          { key: 'error', level: 'error' },
        ]}
      />
      <LoadErrorBanner error={loadError} label="recorded spend" />
      <RealtimeRefresh tables={['admin_marketing_spend']} debounceMs={2000} />

      <header className="flex flex-col gap-2">
        <p className="text-muted-foreground text-xs font-semibold tracking-[0.2em] uppercase">
          Revenue
        </p>
        <h1 className="text-3xl font-extrabold tracking-tight">
          <span className="text-gradient-hero">Marketing</span> spend
        </h1>
        <p className="text-muted-foreground text-sm">
          Record weekly spend per channel. Feeds the CAC calculation in /admin/margin → Unit
          economics. Use lowercase channel names that match the UTM source you tag in signup links
          (e.g. <code>tiktok</code>, <code>instagram</code>,<code>reddit</code>).
        </p>
      </header>

      <Card className="gap-4 py-6">
        <CardHeader className="px-6 pb-0">
          <CardTitle className="text-lg font-bold">Record spend</CardTitle>
        </CardHeader>
        <CardContent className="px-6">
          <form action={recordMarketingSpend} className="flex flex-col gap-4">
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="flex flex-col gap-2">
                <Label htmlFor="week_start">Week start (Mon, UTC)</Label>
                <Input
                  id="week_start"
                  name="week_start"
                  type="date"
                  required
                  defaultValue={defaultWeekStart()}
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="channel">Channel</Label>
                <Input
                  id="channel"
                  name="channel"
                  type="text"
                  required
                  maxLength={40}
                  placeholder="tiktok"
                  autoComplete="off"
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="usd_spent">USD spent</Label>
                <Input
                  id="usd_spent"
                  name="usd_spent"
                  type="number"
                  min="0"
                  step="0.01"
                  required
                  placeholder="240.00"
                />
              </div>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="notes">Notes (optional)</Label>
              <Input
                id="notes"
                name="notes"
                type="text"
                maxLength={500}
                placeholder="e.g. 3× TikTok Spark Ads on @handle"
              />
            </div>
            <div>
              <GradientButton type="submit" size="md">
                <DollarSign className="mr-1.5 size-4" />
                Record
              </GradientButton>
            </div>
          </form>
        </CardContent>
      </Card>

      <section className="flex flex-col gap-3">
        <header className="flex items-baseline justify-between gap-3">
          <h2 className="text-lg font-bold">Recent entries</h2>
          <span className="text-muted-foreground text-xs">{spend.length} latest</span>
        </header>

        {spend.length === 0 ? (
          <div className="border-border/60 bg-card/40 text-muted-foreground rounded-2xl border border-dashed p-10 text-center text-sm">
            No spend recorded yet. CAC reads from this table — log a row above.
          </div>
        ) : (
          <div className="border-border/60 overflow-x-auto rounded-2xl border">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-muted-foreground text-left text-xs tracking-wider uppercase">
                <tr>
                  <th className="px-4 py-2 font-semibold">Week start</th>
                  <th className="px-4 py-2 font-semibold">Channel</th>
                  <th className="px-4 py-2 text-right font-semibold">Spend</th>
                  <th className="px-4 py-2 font-semibold">Notes</th>
                  <th className="px-4 py-2 font-semibold">Recorded</th>
                </tr>
              </thead>
              <tbody>
                {spend.map((r) => (
                  <tr key={r.id} className="border-border/60 border-t">
                    <td className="px-4 py-2 font-mono text-xs tabular-nums">{r.week_start}</td>
                    <td className="px-4 py-2 font-mono text-xs">{r.channel}</td>
                    <td className="px-4 py-2 text-right font-mono text-xs font-semibold tabular-nums">
                      {formatUsd(Number(r.usd_spent))}
                    </td>
                    <td className="text-muted-foreground px-4 py-2">{r.notes ?? '—'}</td>
                    <td className="text-muted-foreground px-4 py-2">
                      {new Date(r.created_at).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </section>
  )
}
