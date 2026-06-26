'use client'

import type { ReactNode } from 'react'
import { AnimatedNumber } from '@/components/admin/AnimatedNumber'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { formatStat, type NumberFormat } from '@/lib/format'
import { cn } from '@/lib/utils/cn'

export interface StatCardProps {
  /** Lucide icon node, rendered in a 24×24 chip. */
  icon: ReactNode
  /** Uppercase row label, e.g. "Trends". */
  label: string
  /** Big-number value — numbers count up + format; strings render verbatim. */
  value: number | string
  /** How to format a numeric value (defaults to comma-grouped integer). */
  valueFormat?: NumberFormat
  /** Optional Tailwind text-* tone for the value (e.g. emerald for "Completed"). */
  tone?: string
  /** Optional secondary line under the value. */
  hint?: string
}

/**
 * Compact KPI tile without a sparkline. Numeric values count up on change; the
 * card lifts on hover. Sister to [`KpiCard`](./KpiCard.tsx).
 */
export function StatCard({ icon, label, value, valueFormat = 'number', tone, hint }: StatCardProps) {
  return (
    <Card className="gap-2 py-5 transition-[transform,box-shadow] duration-[var(--duration-base)] hover:-translate-y-0.5 hover:shadow-[var(--shadow-pop)]">
      <CardHeader className="px-5">
        <div className="text-muted-foreground flex items-center gap-2 text-xs tracking-wide uppercase">
          <span className="bg-muted grid size-6 place-items-center rounded-md">{icon}</span>
          {label}
        </div>
        <CardTitle className={cn('line-clamp-2 text-2xl font-bold tracking-tight', tone)}>
          {typeof value === 'number' ? (
            <AnimatedNumber value={value} format={(n) => formatStat(n, valueFormat)} />
          ) : (
            value
          )}
        </CardTitle>
      </CardHeader>
      {hint && <CardContent className="text-muted-foreground px-5 text-xs">{hint}</CardContent>}
    </Card>
  )
}
