'use client'

import Link from 'next/link'
import { AlertTriangle, Sparkles } from 'lucide-react'
import { cn } from '@/lib/utils/cn'

interface QuotaChipProps {
  freeUsedThisWeek: number
  creditsBalance: number
  className?: string
}

const FREE_WEEKLY_LIMIT = 5

export function QuotaChip({ freeUsedThisWeek, creditsBalance, className }: QuotaChipProps) {
  const freeLeft = Math.max(0, FREE_WEEKLY_LIMIT - freeUsedThisWeek)
  const hasCredits = creditsBalance > 0
  const exhausted = !hasCredits && freeLeft === 0

  return (
    <div
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium',
        hasCredits && 'bg-primary/10 text-primary',
        !hasCredits && !exhausted && 'bg-muted text-muted-foreground',
        exhausted && 'bg-destructive/10 text-destructive',
        className
      )}
    >
      <span className="sr-only">Free generations:</span>
      {hasCredits ? (
        <>
          <Sparkles className="size-3" aria-hidden="true" />
          <span>{creditsBalance} credits</span>
        </>
      ) : exhausted ? (
        <Link
          href="/me/settings#packs"
          className="inline-flex items-center gap-1.5 underline-offset-2 hover:underline"
        >
          <AlertTriangle className="size-3" aria-hidden="true" />
          <span>Out of free · Upgrade</span>
        </Link>
      ) : (
        <span>{freeLeft} free left this week</span>
      )}
    </div>
  )
}
