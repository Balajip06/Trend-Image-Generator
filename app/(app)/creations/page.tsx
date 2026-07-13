import { ImageIcon, Star } from 'lucide-react'
import Image from 'next/image'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { GradientButton } from '@/components/brand/GradientButton'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { MOCK_GENERATIONS, MOCK_TRENDS, MOCK_TRENDS_ENABLED } from '@/lib/dev/mock-data'
import { createClient } from '@/lib/supabase/server'
import { toggleFavorite } from './actions'

export const dynamic = 'force-dynamic'

interface CreationRow {
  id: string
  trend_id: string
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'failed_retryable'
  output_image_url: string | null
  created_at: string
  purge_at: string | null
  is_favorite: boolean
  favorited_at: string | null
}

interface TrendOption {
  id: string
  title: string
}

const STATUS_BADGE: Record<CreationRow['status'], { label: string; cls: string }> = {
  pending: { label: 'Queued', cls: 'bg-muted text-foreground/70' },
  processing: { label: 'Cooking', cls: 'bg-[var(--brand-cyan)]/15 text-[var(--brand-cyan)]' },
  completed: { label: 'Done', cls: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300' },
  failed_retryable: {
    label: 'Retrying',
    cls: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  },
  failed: { label: 'Failed', cls: 'bg-destructive/15 text-destructive' },
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const VALID_RANGES = ['24h', '7d', '30d', 'all'] as const
type RangeValue = (typeof VALID_RANGES)[number]

function rangeToIso(range: RangeValue): string | null {
  if (range === 'all') return null
  const now = Date.now()
  const ms = range === '24h' ? 86_400_000 : range === '7d' ? 7 * 86_400_000 : 30 * 86_400_000
  return new Date(now - ms).toISOString()
}

interface PageProps {
  searchParams?: Promise<{
    q?: string
    trend?: string
    range?: string
    view?: string
  }>
}

export default async function CreationsPage({ searchParams }: PageProps) {
  const sp = (await searchParams) ?? {}
  const rawQ = typeof sp.q === 'string' ? sp.q.slice(0, 100).trim() : ''
  const trendFilter = typeof sp.trend === 'string' && UUID_RE.test(sp.trend) ? sp.trend : ''
  const range: RangeValue =
    typeof sp.range === 'string' && (VALID_RANGES as readonly string[]).includes(sp.range)
      ? (sp.range as RangeValue)
      : 'all'
  const view: 'favorites' | 'all' = sp.view === 'favorites' ? 'favorites' : 'all'

  let creations: CreationRow[]
  let trendOptions: TrendOption[]

  if (MOCK_TRENDS_ENABLED) {
    const all: CreationRow[] = MOCK_GENERATIONS.map((g) => ({
      id: g.id,
      trend_id: g.trend_id,
      status: g.status,
      output_image_url: g.output_image_url,
      created_at: g.created_at,
      purge_at: g.purge_at,
      is_favorite: false,
      favorited_at: null,
    }))
    creations = all.filter((c) => {
      if (view === 'favorites' && !c.is_favorite) return false
      if (trendFilter && c.trend_id !== trendFilter) return false
      const cutoff = rangeToIso(range)
      if (cutoff && c.created_at < cutoff) return false
      return true
    })
    trendOptions = MOCK_TRENDS.map((t) => ({ id: t.id, title: t.title }))
  } else {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) redirect('/login?next=/creations')

    let query = supabase
      .from('generations')
      .select(
        'id, trend_id, status, output_image_url, created_at, purge_at, is_favorite, favorited_at'
      )
      .eq('user_id', user.id)

    if (view === 'favorites') {
      query = query.eq('is_favorite', true).order('favorited_at', { ascending: false })
    } else {
      query = query.order('created_at', { ascending: false })
    }

    if (trendFilter) query = query.eq('trend_id', trendFilter)

    const cutoff = rangeToIso(range)
    if (cutoff) query = query.gte('created_at', cutoff)

    // TODO: switch to .textSearch when result count grows
    if (rawQ) query = query.ilike('input_payload::text', `%${rawQ}%`)

    const { data: rows } = await query.limit(60)
    creations = (rows ?? []).filter(Boolean)

    const trendIds = Array.from(new Set(creations.map((c) => c.trend_id)))
    if (trendIds.length > 0) {
      const { data: trends } = await supabase.from('trends').select('id, title').in('id', trendIds)
      trendOptions = (trends ?? []).filter(Boolean)
    } else {
      trendOptions = []
    }
  }

  const completed = creations.filter((c) => c.status === 'completed').length
  const isFiltered = rawQ !== '' || trendFilter !== '' || range !== 'all' || view !== 'all'

  const buildViewHref = (nextView: 'all' | 'favorites'): string => {
    const params = new URLSearchParams()
    if (rawQ) params.set('q', rawQ)
    if (trendFilter) params.set('trend', trendFilter)
    if (range !== 'all') params.set('range', range)
    if (nextView !== 'all') params.set('view', nextView)
    const qs = params.toString()
    return qs ? `/creations?${qs}` : '/creations'
  }

  return (
    <section className="flex flex-col gap-8">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-4xl font-extrabold tracking-tight">
            Your <span className="text-gradient-hero">creations</span>
          </h1>
          <p className="text-muted-foreground mt-2 text-sm">
            {completed} ready · Free-tier renders purge 30 days after creation.
          </p>
        </div>
        <GradientButton size="md" asChild>
          <Link href="/studio">Pick a new trend</Link>
        </GradientButton>
      </header>

      <form
        method="get"
        className="border-border/60 bg-card/40 flex flex-col gap-3 rounded-2xl border p-4 sm:flex-row sm:items-end"
      >
        {view !== 'all' ? <input type="hidden" name="view" value={view} /> : null}
        <label className="flex-1">
          <span className="text-muted-foreground mb-1 block text-xs font-medium">Search</span>
          <Input
            name="q"
            defaultValue={rawQ}
            maxLength={100}
            placeholder="Search prompts, trends…"
          />
        </label>
        <label className="sm:w-44">
          <span className="text-muted-foreground mb-1 block text-xs font-medium">Trend</span>
          <select
            name="trend"
            defaultValue={trendFilter}
            className="border-input focus-visible:border-ring focus-visible:ring-ring/50 bg-background text-foreground h-9 w-full rounded-md border px-3 text-sm shadow-xs outline-none focus-visible:ring-[3px]"
          >
            <option value="">All trends</option>
            {trendOptions.map((t) => (
              <option key={t.id} value={t.id}>
                {t.title}
              </option>
            ))}
          </select>
        </label>
        <label className="sm:w-32">
          <span className="text-muted-foreground mb-1 block text-xs font-medium">Range</span>
          <select
            name="range"
            defaultValue={range}
            className="border-input focus-visible:border-ring focus-visible:ring-ring/50 bg-background text-foreground h-9 w-full rounded-md border px-3 text-sm shadow-xs outline-none focus-visible:ring-[3px]"
          >
            <option value="all">All time</option>
            <option value="24h">Last 24h</option>
            <option value="7d">Last 7 days</option>
            <option value="30d">Last 30 days</option>
          </select>
        </label>
        <div className="flex gap-2 sm:items-end">
          <button
            type="submit"
            className="border-border bg-foreground text-background h-9 rounded-md border px-4 text-sm font-semibold transition-opacity hover:opacity-90"
          >
            Filter
          </button>
          {isFiltered ? (
            <Link
              href="/creations"
              className="border-border text-muted-foreground hover:text-foreground grid h-9 place-items-center rounded-md border px-3 text-sm"
            >
              Reset
            </Link>
          ) : null}
        </div>
      </form>

      <nav className="border-border/60 bg-muted inline-flex w-fit items-center gap-1 rounded-lg border p-1 text-sm font-medium">
        <Link
          href={buildViewHref('all')}
          aria-current={view === 'all' ? 'page' : undefined}
          className={`rounded-md px-3 py-1.5 transition-colors ${
            view === 'all'
              ? 'bg-background text-foreground shadow-sm'
              : 'text-foreground/60 hover:text-foreground'
          }`}
        >
          All
        </Link>
        <Link
          href={buildViewHref('favorites')}
          aria-current={view === 'favorites' ? 'page' : undefined}
          className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 transition-colors ${
            view === 'favorites'
              ? 'bg-background text-foreground shadow-sm'
              : 'text-foreground/60 hover:text-foreground'
          }`}
        >
          <Star className="size-3.5" aria-hidden />
          Favorites
        </Link>
      </nav>

      {creations.length === 0 ? (
        <div className="border-border/60 bg-card/40 flex flex-col items-center gap-4 rounded-3xl border border-dashed p-16 text-center">
          <div className="bg-gradient-hero shadow-glow-pink grid size-14 place-items-center rounded-full text-white">
            {view === 'favorites' ? <Star className="size-6" /> : <ImageIcon className="size-6" />}
          </div>
          <div>
            <p className="text-lg font-bold">
              {view === 'favorites'
                ? 'No favorites yet'
                : rawQ
                  ? `No matches for "${rawQ}"`
                  : 'No creations yet'}
            </p>
            <p className="text-muted-foreground mt-1 text-sm">
              {view === 'favorites'
                ? 'Star a creation to keep your shortlist.'
                : rawQ || isFiltered
                  ? 'Try a different search or clear filters.'
                  : 'Make your first trend in seconds.'}
            </p>
          </div>
          {view === 'favorites' || isFiltered ? (
            <Link
              href="/creations"
              className="text-foreground text-sm font-medium underline-offset-4 hover:underline"
            >
              Clear filters
            </Link>
          ) : (
            <GradientButton asChild size="md">
              <Link href="/studio">Pick a trend</Link>
            </GradientButton>
          )}
        </div>
      ) : (
        <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {creations.map((c, idx) => (
            <li key={c.id} className="animate-fade-up" style={{ animationDelay: `${idx * 60}ms` }}>
              <div className="relative">
                <Link
                  href={`/result/${c.id}`}
                  className="group border-border/60 bg-card hover:shadow-pop relative block aspect-square overflow-hidden rounded-2xl border transition-transform hover:-translate-y-1"
                >
                  {c.output_image_url ? (
                    <Image
                      src={c.output_image_url}
                      alt="Creation"
                      fill
                      sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
                      className="object-cover transition-transform duration-700 group-hover:scale-105"
                    />
                  ) : (
                    <div className="bg-gradient-hero/30 text-foreground flex h-full w-full items-center justify-center text-xs">
                      {STATUS_BADGE[c.status].label}
                    </div>
                  )}
                  <div className="absolute top-2 left-2 flex flex-col gap-1">
                    <Badge
                      className={`rounded-full px-2.5 py-0.5 text-[10px] font-semibold ${STATUS_BADGE[c.status].cls}`}
                    >
                      {STATUS_BADGE[c.status].label}
                    </Badge>
                    {c.is_favorite ? (
                      <Badge className="rounded-full bg-[var(--brand-grad-1)]/15 px-2.5 py-0.5 text-[10px] font-semibold text-[var(--brand-grad-1)]">
                        Favorite
                      </Badge>
                    ) : null}
                  </div>
                </Link>
                <form action={toggleFavorite} className="absolute top-2 right-2">
                  <input type="hidden" name="generation_id" value={c.id} />
                  <button
                    type="submit"
                    aria-label={c.is_favorite ? 'Unfavorite' : 'Favorite'}
                    aria-pressed={c.is_favorite}
                    className="border-border/60 bg-card/90 hover:bg-card grid size-8 place-items-center rounded-full border backdrop-blur-sm transition-colors"
                  >
                    <Star
                      className={`size-4 ${
                        c.is_favorite
                          ? 'fill-current text-[var(--brand-grad-1)]'
                          : 'text-foreground/60'
                      }`}
                      aria-hidden
                    />
                  </button>
                </form>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
