'use client'

import Image from 'next/image'
import { useRouter, useSearchParams } from 'next/navigation'
import { useCallback, useMemo, useState } from 'react'
import { cn } from '@/lib/utils/cn'
import type { PublicTrend } from '@/lib/trends/repository'
import { TrendDrawer } from './TrendDrawer'

interface TrendGridProps {
  trends: PublicTrend[]
  freeUsedThisWeek: number
  initialSlug: string | null
  onSelect?: (trend: PublicTrend) => void
}

const NEW_WINDOW_MS = 14 * 24 * 60 * 60 * 1000

function isNewTrend(activatedAt: string | null): boolean {
  if (!activatedAt) return false
  const ts = new Date(activatedAt).getTime()
  if (Number.isNaN(ts)) return false
  return Date.now() - ts < NEW_WINDOW_MS
}

export function TrendGrid({ trends, freeUsedThisWeek, initialSlug, onSelect }: TrendGridProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const paramSlug = searchParams.get('trend')

  // Slug in state — stable string, not stale object reference
  const [selectedSlug, setSelectedSlug] = useState<string | null>(initialSlug ?? paramSlug ?? null)
  const [drawerOpen, setDrawerOpen] = useState(() => !!(initialSlug ?? paramSlug))

  // Derive selected trend from live trends + slug — stays fresh if trends prop updates
  const selectedTrend = useMemo(
    () => (selectedSlug ? (trends.find((t) => t.slug === selectedSlug) ?? null) : null),
    [selectedSlug, trends]
  )

  const handleSelect = useCallback(
    (trend: PublicTrend) => {
      setSelectedSlug(trend.slug)
      setDrawerOpen(true)
      router.replace(`/me/studio?trend=${trend.slug}`, { scroll: false })
      onSelect?.(trend)
    },
    [router, onSelect]
  )

  const handleDrawerClose = useCallback(
    (open: boolean) => {
      setDrawerOpen(open)
      if (!open) {
        // Clear slug after close so next open starts fresh
        setSelectedSlug(null)
        router.replace('/me/studio', { scroll: false })
      }
    },
    [router]
  )

  return (
    <>
      <section aria-labelledby="studio-pick" className="flex flex-col gap-4">
        <header className="flex items-baseline justify-between gap-2">
          <h2
            id="studio-pick"
            className="text-muted-foreground text-xs font-semibold tracking-[0.2em] uppercase"
          >
            Pick a trend
          </h2>
          <p className="text-muted-foreground text-xs">
            {trends.length} trend{trends.length !== 1 ? 's' : ''} live
          </p>
        </header>

        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {trends.map((trend) => {
            const isSelected = trend.slug === selectedTrend?.slug
            const isNew = isNewTrend(trend.activated_at)
            const thumb = trend.sample_after_url ?? trend.thumbnail_url

            return (
              <li key={trend.id}>
                <button
                  type="button"
                  onClick={() => handleSelect(trend)}
                  aria-pressed={isSelected}
                  className={cn(
                    'group border-border/60 bg-card/40 relative block w-full overflow-hidden rounded-2xl border text-left transition-all',
                    'hover:border-border focus-visible:ring-ring hover:shadow-md focus-visible:ring-2 focus-visible:outline-none',
                    isSelected &&
                      'ring-primary ring-offset-background border-primary ring-2 ring-offset-2'
                  )}
                >
                  <div className="relative aspect-square">
                    {thumb ? (
                      <Image
                        src={thumb}
                        alt=""
                        fill
                        sizes="(min-width: 1280px) 18vw, (min-width: 1024px) 22vw, (min-width: 640px) 30vw, 45vw"
                        className="object-cover transition-transform duration-300 group-hover:scale-[1.02]"
                        loading="lazy"
                      />
                    ) : (
                      <div className="bg-gradient-hero absolute inset-0" aria-hidden="true" />
                    )}

                    {isNew && (
                      <span className="bg-primary text-primary-foreground absolute top-2 left-2 rounded-full px-2 py-0.5 text-[10px] font-bold tracking-wider uppercase shadow-sm">
                        New
                      </span>
                    )}
                  </div>

                  <div className="flex flex-col gap-0.5 px-3 py-2">
                    <p className="text-foreground line-clamp-1 text-sm font-semibold">
                      {trend.title}
                    </p>
                    {trend.description && (
                      <p className="text-muted-foreground line-clamp-1 text-xs">
                        {trend.description}
                      </p>
                    )}
                  </div>
                </button>
              </li>
            )
          })}
        </ul>
      </section>

      <TrendDrawer
        trend={selectedTrend}
        open={drawerOpen}
        onOpenChange={handleDrawerClose}
        freeUsedThisWeek={freeUsedThisWeek}
      />
    </>
  )
}
