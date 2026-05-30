import { redirect } from 'next/navigation'
import { QuotaChip } from '@/components/trends/QuotaChip'
import { TrendGrid } from '@/components/trends/TrendGrid'
import { MOCK_PROFILE, MOCK_TRENDS_ENABLED } from '@/lib/dev/mock-data'
import { createClient } from '@/lib/supabase/server'
import { getActiveTrendBySlug, listActiveTrends } from '@/lib/trends/repository'

export const dynamic = 'force-dynamic'

interface StudioPageProps {
  searchParams?: Promise<{ trend?: string | string[] }>
}

function pickSlug(raw: string | string[] | undefined): string | null {
  if (!raw) return null
  const slug = Array.isArray(raw) ? raw[0] : raw
  return slug?.trim().length ? slug : null
}

export default async function StudioPage({ searchParams }: StudioPageProps) {
  const params = (await searchParams) ?? {}
  const selectedSlug = pickSlug(params.trend)

  let freeUsedThisWeek = 0
  let creditsBalance = 0

  if (MOCK_TRENDS_ENABLED) {
    freeUsedThisWeek = MOCK_PROFILE.free_used_this_week
    creditsBalance = MOCK_PROFILE.credits_balance
  } else {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) redirect('/login?next=/me/studio')

    const { data: profile } = await supabase
      .from('profiles')
      .select('free_used_this_week, credits_balance')
      .eq('id', user.id)
      .maybeSingle()

    freeUsedThisWeek = profile?.free_used_this_week ?? 0
    creditsBalance = profile?.credits_balance ?? 0
  }

  const [trends, selectedTrend] = await Promise.all([
    listActiveTrends(),
    selectedSlug ? getActiveTrendBySlug(selectedSlug) : Promise.resolve(null),
  ])

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

      <TrendGrid
        trends={trends}
        freeUsedThisWeek={freeUsedThisWeek}
        initialSlug={selectedTrend?.slug ?? null}
      />
    </div>
  )
}
