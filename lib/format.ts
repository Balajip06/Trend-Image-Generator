/**
 * Shared stat formatters. Plain module (no 'use client') so both server pages
 * and client components can import it — and so chart/card props can be a
 * serializable `NumberFormat` descriptor instead of a function (functions can't
 * cross the server→client component boundary).
 */
export type NumberFormat = 'number' | 'usd' | 'usd0' | 'percent' | 'compact'

const USD = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })
const COMPACT = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 })

export function formatStat(n: number, fmt: NumberFormat = 'number'): string {
  if (!Number.isFinite(n)) return '—'
  switch (fmt) {
    case 'usd':
      return USD.format(n)
    case 'usd0':
      return `$${Math.round(n).toLocaleString('en-US')}`
    case 'percent':
      return `${n.toFixed(1)}%`
    case 'compact':
      return COMPACT.format(n)
    case 'number':
    default:
      return Math.round(n).toLocaleString('en-US')
  }
}
