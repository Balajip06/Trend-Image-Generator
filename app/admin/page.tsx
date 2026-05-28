import { ArrowRight, Inbox, Sparkles } from 'lucide-react'
import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

interface DashboardCounts {
  trendsTotal: number
  trendsLive: number
  pendingSuggestions: number
}

async function loadCounts(): Promise<DashboardCounts> {
  const supabase = await createClient()
  const [{ count: trendsTotal }, { count: trendsLive }, { count: pendingSuggestions }] = await Promise.all([
    supabase.from('trends').select('id', { count: 'exact', head: true }),
    supabase.from('trends').select('id', { count: 'exact', head: true }).eq('is_active', true),
    supabase
      .from('trend_suggestions')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'pending'),
  ])
  return {
    trendsTotal: trendsTotal ?? 0,
    trendsLive: trendsLive ?? 0,
    pendingSuggestions: pendingSuggestions ?? 0,
  }
}

export default async function AdminHome() {
  const counts = await loadCounts()

  return (
    <section className="flex flex-col gap-8">
      <header className="flex flex-col gap-2">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
          Admin console
        </p>
        <h1 className="text-3xl font-extrabold tracking-tight">
          What needs <span className="text-gradient-hero">your attention</span>?
        </h1>
      </header>

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Trends" value={counts.trendsTotal} hint={`${counts.trendsLive} live`} />
        <StatCard label="Pending suggestions" value={counts.pendingSuggestions} hint="Inbox" />
        <StatCard
          label="Status"
          value={counts.pendingSuggestions > 0 ? 'Review' : 'Clear'}
          hint={counts.pendingSuggestions > 0 ? 'Suggestions waiting' : 'No backlog'}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <AdminTile
          href="/admin/trends"
          icon={<Sparkles className="size-5" />}
          title="Trends"
          description="Create, edit, run eval, activate or retire."
          accent="from-[var(--brand-grad-1)] to-[var(--brand-grad-2)]"
        />
        <AdminTile
          href="/admin/suggestions"
          icon={<Inbox className="size-5" />}
          title="Suggestions"
          description="Auto-detected and community-submitted candidates."
          accent="from-[var(--brand-violet)] to-[var(--brand-cyan)]"
          badge={counts.pendingSuggestions > 0 ? `${counts.pendingSuggestions} pending` : undefined}
        />
      </div>
    </section>
  )
}

function StatCard({ label, value, hint }: { label: string; value: number | string; hint?: string }) {
  return (
    <Card className="gap-3 py-5">
      <CardHeader className="px-5">
        <CardDescription className="text-xs uppercase tracking-wide">{label}</CardDescription>
        <CardTitle className="text-3xl font-extrabold tracking-tight">{value}</CardTitle>
      </CardHeader>
      {hint && (
        <CardContent className="px-5 text-xs text-muted-foreground">{hint}</CardContent>
      )}
    </Card>
  )
}

interface AdminTileProps {
  href: string
  icon: React.ReactNode
  title: string
  description: string
  accent: string
  badge?: string
}

function AdminTile({ href, icon, title, description, accent, badge }: AdminTileProps) {
  return (
    <Link
      href={href}
      className="group relative overflow-hidden rounded-2xl border border-border/60 bg-card p-6 transition-all hover:-translate-y-0.5 hover:shadow-soft"
    >
      <div className={`absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r ${accent}`} />
      <div className="flex items-start justify-between gap-3">
        <div className="grid size-10 place-items-center rounded-xl bg-muted text-foreground">
          {icon}
        </div>
        {badge && (
          <Badge className="rounded-full bg-[var(--brand-grad-1)]/15 px-2.5 py-0.5 text-[11px] font-semibold text-[var(--brand-grad-1)] border-transparent">
            {badge}
          </Badge>
        )}
      </div>
      <h2 className="mt-4 text-lg font-bold tracking-tight">{title}</h2>
      <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      <div className="mt-4 inline-flex items-center gap-1 text-xs font-semibold text-foreground/80 transition-transform group-hover:translate-x-0.5">
        Open <ArrowRight className="size-3.5" />
      </div>
    </Link>
  )
}
