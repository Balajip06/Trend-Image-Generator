'use client'

// Conversion surface: replaces the silent quota-exhausted toast with an
// actionable upsell at the exact moment intent is highest.

import Link from 'next/link'
import { CREDIT_PACKS, type PackId } from '@/lib/payments/packs'
import { Button } from '@/components/ui/button'
import { GradientButton } from '@/components/brand/GradientButton'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

interface QuotaUpsellModalProps {
  open: boolean
  onOpenChange: (v: boolean) => void
  freeUsedThisWeek: number
}

const HIGHLIGHT_PACK: PackId = 'medium'

function nextSundayUtcLabel(): string {
  const now = new Date()
  const daysUntilSunday = (7 - now.getUTCDay()) % 7 || 7
  const next = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + daysUntilSunday)
  )
  return next.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  })
}

function formatPrice(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`
}

export function QuotaUpsellModal({ open, onOpenChange, freeUsedThisWeek }: QuotaUpsellModalProps) {
  const refillDate = nextSundayUtcLabel()

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-border/60 bg-card rounded-3xl border sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-xl leading-tight font-semibold">
            You&apos;ve used your <span className="text-gradient-hero">free tries</span> this week
          </DialogTitle>
          <DialogDescription>
            Don&apos;t lose your momentum — your weekly {Math.max(freeUsedThisWeek, 5)}-free refills
            on {refillDate}.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-2">
          {CREDIT_PACKS.map((pack) => {
            const highlighted = pack.id === HIGHLIGHT_PACK
            return (
              <div
                key={pack.id}
                className="border-border/60 bg-background/60 relative flex items-center justify-between gap-3 overflow-hidden rounded-2xl border p-3"
              >
                {highlighted && (
                  <span
                    aria-hidden
                    className="absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r from-[var(--brand-grad-1)] to-[var(--brand-grad-2)]"
                  />
                )}
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">{pack.label}</p>
                  <p className="text-muted-foreground text-xs">
                    {pack.credits} credits · {formatPrice(pack.priceCents)}
                  </p>
                </div>
                {highlighted ? (
                  <GradientButton size="sm" asChild>
                    <Link href={`/settings?pack=${pack.id}`}>Buy</Link>
                  </GradientButton>
                ) : (
                  <Button size="sm" variant="outline" asChild>
                    <Link href={`/settings?pack=${pack.id}`}>Buy</Link>
                  </Button>
                )}
              </div>
            )
          })}
        </div>

        <Link
          href="/pricing"
          className="text-muted-foreground text-center text-xs underline-offset-4 hover:underline"
        >
          See full pricing →
        </Link>
      </DialogContent>
    </Dialog>
  )
}
