'use client'

import type { ReactNode } from 'react'
import { AnimatedNumber } from '@/components/admin/AnimatedNumber'
import { Sparkline } from '@/components/admin/Charts'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { formatStat, type NumberFormat } from '@/lib/format'
import { cn } from '@/lib/utils/cn'

export interface KpiCardProps {
  /** Lucide icon node, rendered in a 24×24 chip. */
  icon: ReactNode
  /** Uppercase row label, e.g. "Impressions". */
  label: string
  /** Numeric value counts up on change; a string renders verbatim (no count-up). */
  value: number | string
  /** How to format a numeric value (serializable; defaults to comma-grouped integer). */
  valueFormat?: NumberFormat
  /** Trend delta vs prior period — typically a `<Delta />` element. */
  delta: ReactNode
  /** Tailwind text-* utility (controls Sparkline stroke/fill via currentColor). */
  tone: string
  /** 7-day or N-day series for the inline sparkline. */
  series: { label: string; value: number }[]
  /** Accessible label for the sparkline SVG. */
  ariaLabel: string
}

/**
 * Reusable KPI tile. The value counts up on change; the card lifts on hover.
 */
export function KpiCard({
  icon,
  label,
  value,
  valueFormat = 'number',
  delta,
  tone,
  series,
  ariaLabel,
}: KpiCardProps) {
  return (
    <Card className="gap-3 py-5 transition-[transform,box-shadow] duration-[var(--duration-base)] hover:-translate-y-0.5 hover:shadow-[var(--shadow-pop)]">
      <CardHeader className="px-5">
        <div className="text-muted-foreground flex items-center justify-between gap-2 text-xs tracking-wide uppercase">
          <span className="inline-flex items-center gap-2">
            <span className="bg-muted grid size-6 place-items-center rounded-md">{icon}</span>
            {label}
          </span>
          {delta}
        </div>
        <CardTitle className="text-3xl font-extrabold tracking-tight">
          {typeof value === 'number' ? (
            <AnimatedNumber value={value} format={(n) => formatStat(n, valueFormat)} />
          ) : (
            value
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className={cn('px-5', tone)}>
        <Sparkline data={series} ariaLabel={ariaLabel} />
      </CardContent>
    </Card>
  )
}
