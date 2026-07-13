import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Search } from 'lucide-react'
import { QuotaChip } from '@/components/trends/QuotaChip'
import { TrendGrid } from '@/components/trends/TrendGrid'
import { Input } from '@/components/ui/input'
import { MOCK_PROFILE, MOCK_TRENDS_ENABLED } from '@/lib/dev/mock-data'
import { createClient } from '@/lib/supabase/server'
import { getActiveTrendBySlug, listActiveTrendsPaged } from '@/lib/trends/repository'
import { toggleFavouriteTrend } from './actions'

export const dynamic = 'force-dynamic'

const PER_PAGE = 48

interface StudioPageProps {
  searchParams?: Promise<{ trend?: string | string[]; q?: string; page?: string }>
}

function pickSlug(raw: string | string[] | undefined): string | null {
  if (!raw) return null
  const slug = Array.isArray(raw) ? raw[0] : raw
  return slug?.trim().length ? slug : null
}

function buildHref(q: string, page: number): string {
  const params = new URLSearchParams()
  if (q) params.set('q', q)
  if (page > 1) params.set('page', String(page))
  const qs = params.toString()
  return qs ? `/studio?${qs}` : '/studio'
}

export default async function StudioPage({ searchParams }: StudioPageProps) {
  const params = (await searchParams) ?? {}
  const selectedSlug = pickSlug(params.trend)
  const rawQ = typeof params.q === 'string' ? params.q.slice(0, 100).trim() : ''
  const page = Math.max(1, parseInt(typeof params.page === 'string' ? params.page : '1', 10) || 1)

  let freeUsedThisWeek = 0
  let creditsBalance = 0
  let favoritedTrendIds: string[] = []

  if (MOCK_TRENDS_ENABLED) {
    freeUsedThisWeek = MOCK_PROFILE.free_used_this_week
    creditsBalance = MOCK_PROFILE.credits_balance
  } else {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) redirect('/login?next=/studio')

    const { data: profile } = await supabase
      .from('profiles')
      .select('free_used_this_week, credits_balance, favourite_trend_ids')
      .eq('id', user.id)
      .maybeSingle()

    freeUsedThisWeek = profile?.free_used_this_week ?? 0
    creditsBalance = profile?.credits_balance ?? 0
    favoritedTrendIds = profile?.favourite_trend_ids ?? []
  }

  const [{ trends, total }, selectedTrend] = await Promise.all([
    listActiveTrendsPaged(rawQ, page, PER_PAGE),
    selectedSlug ? getActiveTrendBySlug(selectedSlug) : Promise.resolve(null),
  ])

  const totalPages = Math.max(1, Math.ceil(total / PER_PAGE))
  const clampedPage = Math.min(page, totalPages)

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-4">
          <p className="text-muted-foreground text-xs font-semibold tracking-[0.2em] uppercase">
            Studio
          </p>
          <QuotaChip freeUsedThisWeek={freeUsedThisWeek} creditsBalance={creditsBalance} />
        </div>
        <h1 className="text-3xl font-extrabold tracking-tight">
          Pick a <span className="text-gradient-hero">trend</span> and go
        </h1>
        <p className="text-muted-foreground max-w-2xl text-sm">
          Every active trend is here. Tap one, drop a photo, get a result in seconds.
        </p>
      </header>

      {/* Search */}
      <form method="get" className="relative max-w-sm">
        <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
        <Input
          name="q"
          defaultValue={rawQ}
          placeholder="Search trends…"
          maxLength={100}
          className="pl-9"
          autoComplete="off"
        />
      </form>

      <TrendGrid
        trends={trends}
        freeUsedThisWeek={freeUsedThisWeek}
        initialSlug={selectedTrend?.slug ?? null}
        favoritedTrendIds={favoritedTrendIds}
        onToggleFavourite={toggleFavouriteTrend}
      />

      {/* Pagination */}
      {totalPages > 1 && (
        <nav aria-label="Trend pages" className="flex items-center justify-center gap-2 pt-2">
          <Link
            href={buildHref(rawQ, clampedPage - 1)}
            aria-disabled={clampedPage <= 1}
            className={
              clampedPage <= 1
                ? 'border-border text-muted-foreground pointer-events-none rounded-lg border px-3 py-1.5 text-sm opacity-40'
                : 'border-border hover:bg-muted rounded-lg border px-3 py-1.5 text-sm transition-colors'
            }
          >
            ← Prev
          </Link>

          <span className="text-muted-foreground text-sm tabular-nums">
            {clampedPage} / {totalPages}
          </span>

          <Link
            href={buildHref(rawQ, clampedPage + 1)}
            aria-disabled={clampedPage >= totalPages}
            className={
              clampedPage >= totalPages
                ? 'border-border text-muted-foreground pointer-events-none rounded-lg border px-3 py-1.5 text-sm opacity-40'
                : 'border-border hover:bg-muted rounded-lg border px-3 py-1.5 text-sm transition-colors'
            }
          >
            Next →
          </Link>
        </nav>
      )}
    </div>
  )
}
