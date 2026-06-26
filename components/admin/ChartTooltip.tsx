'use client'

import { type ReactNode } from 'react'
import { cn } from '@/lib/utils/cn'

interface ChartTooltipProps {
  /** Position in px relative to the chart's positioned container. */
  x: number
  y: number
  visible: boolean
  children: ReactNode
}

/**
 * Floating value readout for the charts. Anchored above-center of (x,y); the
 * parent chart wrapper must be `position: relative`. Pointer-events off so it
 * never eats hover; fades rather than pops.
 */
export function ChartTooltip({ x, y, visible, children }: ChartTooltipProps) {
  return (
    <div
      role="tooltip"
      aria-hidden={!visible}
      className={cn(
        'border-border/60 bg-card/95 pointer-events-none absolute z-20 -translate-x-1/2 -translate-y-[calc(100%+8px)] rounded-lg border px-2.5 py-1.5 text-xs whitespace-nowrap shadow-[var(--shadow-pop)] backdrop-blur-sm transition-opacity duration-150',
        visible ? 'opacity-100' : 'opacity-0'
      )}
      style={{ left: x, top: y }}
    >
      {children}
    </div>
  )
}
