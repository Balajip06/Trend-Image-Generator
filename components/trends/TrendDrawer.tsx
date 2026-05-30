'use client'

import { useState } from 'react'
import { X } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { TrendRunner } from './TrendRunner'
import type { PublicTrend } from '@/lib/trends/repository'

interface TrendDrawerProps {
  trend: PublicTrend | null
  open: boolean
  onOpenChange: (open: boolean) => void
  freeUsedThisWeek: number
}

/**
 * Drawer that slides in from the right on md+ screens and from the bottom on
 * mobile. Uses the existing Radix Dialog primitive for focus-trap, esc-to-close,
 * scroll-lock, aria-modal, and focus restoration — all WCAG 2.2 AA compliant.
 *
 * Selection state lives in the parent (TrendGrid). This component is pure
 * display + owns nothing except the Dialog open state bridge.
 */
export function TrendDrawer({ trend, open, onOpenChange, freeUsedThisWeek }: TrendDrawerProps) {
  // Retain the last non-null trend so the Radix close animation completes
  // before content disappears. useState (not useRef) because React 19 forbids
  // ref mutation during render.
  const [lastTrend, setLastTrend] = useState<PublicTrend | null>(trend)
  if (trend && trend !== lastTrend) setLastTrend(trend)
  const displayTrend = lastTrend
  if (!displayTrend) return null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        aria-labelledby="trend-drawer-title"
        aria-describedby={displayTrend.description ? 'trend-drawer-desc' : undefined}
        className={[
          // Mobile: bottom-sheet — slide up from bottom, full width, rounded top
          'fixed inset-x-0 top-auto bottom-0 mx-0 max-w-none translate-x-0 translate-y-0 rounded-t-3xl px-4 pt-6 pb-8',
          // md+: right side-drawer — slide in from right, fixed width
          'md:inset-x-auto md:inset-y-0 md:top-0 md:right-0 md:left-auto md:h-full md:w-[480px] md:max-w-[90vw] md:rounded-none md:rounded-l-3xl md:px-8 md:pt-8 md:pb-10',
          // Animation overrides for directional slide
          'data-[state=open]:animate-in data-[state=closed]:animate-out',
          'data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom',
          'md:data-[state=closed]:slide-out-to-right md:data-[state=open]:slide-in-from-right',
          'md:data-[state=closed]:slide-out-to-bottom-0 md:data-[state=open]:slide-in-from-bottom-0',
          'overflow-y-auto duration-300 ease-out',
        ].join(' ')}
      >
        {/* Close button — 44×44 touch target on mobile (SC 2.5.8) */}
        <button
          type="button"
          onClick={() => onOpenChange(false)}
          aria-label="Close"
          className="hover:bg-accent focus-visible:ring-ring absolute top-4 right-4 flex size-11 items-center justify-center rounded-full transition-colors focus-visible:ring-2 focus-visible:outline-none"
        >
          <X className="size-5" aria-hidden="true" />
        </button>

        {/* Drag handle visible on mobile */}
        <div
          className="bg-border mx-auto mb-4 h-1 w-10 rounded-full md:hidden"
          aria-hidden="true"
        />

        <DialogHeader className="mb-4 pr-12">
          <DialogTitle id="trend-drawer-title" className="text-2xl font-extrabold tracking-tight">
            {displayTrend.title}
          </DialogTitle>
          {displayTrend.description && (
            <DialogDescription id="trend-drawer-desc">{displayTrend.description}</DialogDescription>
          )}
        </DialogHeader>

        <TrendRunner trend={displayTrend} freeUsedThisWeek={freeUsedThisWeek} />
      </DialogContent>
    </Dialog>
  )
}
