'use client'

import { useState, type PointerEvent } from 'react'
import { cn } from '@/lib/utils/cn'
import { formatStat, type NumberFormat } from '@/lib/format'
import { ChartTooltip } from './ChartTooltip'

/**
 * Inline-SVG chart primitives for the admin dashboards. Client components so
 * they can be inspected (hover/focus tooltips, sparkline crosshair) and play a
 * one-shot draw-in on mount. No chart-lib dependency. Each chart normalizes the
 * supplied series 0–1 so callers pass raw counts/usd.
 *
 * Motion: draw-ins run once on mount (CSS `both` fill) and do NOT replay on a
 * router.refresh (the SVG node persists). Reduced-motion is neutralized globally.
 */

export interface ChartPoint {
  label: string
  value: number
}

function maxValue(...series: readonly (readonly ChartPoint[])[]): number {
  let max = 0
  for (const s of series) for (const p of s) if (p.value > max) max = p.value
  return max
}

function pointsToPath(
  data: readonly ChartPoint[],
  width: number,
  height: number,
  max: number
): string {
  if (data.length === 0) return ''
  if (max <= 0) {
    const y = height - 1
    return `M 0,${y} L ${width},${y}`
  }
  const step = data.length === 1 ? 0 : width / (data.length - 1)
  return data
    .map((p, i) => {
      const x = data.length === 1 ? width / 2 : i * step
      const y = height - (Math.max(0, p.value) / max) * (height - 4) - 2
      return `${i === 0 ? 'M' : 'L'} ${x.toFixed(2)},${y.toFixed(2)}`
    })
    .join(' ')
}

// ---------------------------------------------------------------------------
// Sparkline
// ---------------------------------------------------------------------------

interface SparklineProps {
  data: readonly ChartPoint[]
  className?: string
  compare?: readonly ChartPoint[]
  ariaLabel: string
  height?: number
}

export function Sparkline({ data, className, compare, ariaLabel, height = 64 }: SparklineProps) {
  const width = 320
  const max = maxValue(data, compare ?? [])
  const path = pointsToPath(data, width, height, max)
  const comparePath = compare ? pointsToPath(compare, width, height, max) : null
  const [tip, setTip] = useState<{ i: number; x: number; y: number } | null>(null)

  const pointX = (i: number) => (data.length <= 1 ? width / 2 : (i / (data.length - 1)) * width)
  const pointY = (v: number) =>
    max === 0 ? height - 1 : height - (Math.max(0, v) / max) * (height - 4) - 2
  const lastY = data.length === 0 ? height - 1 : pointY(data[data.length - 1].value)

  function onMove(e: PointerEvent<HTMLDivElement>) {
    if (data.length === 0) return
    const rect = e.currentTarget.getBoundingClientRect()
    const frac =
      rect.width === 0 ? 0 : Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width))
    const i = Math.round(frac * (data.length - 1))
    setTip({
      i,
      x: (pointX(i) / width) * rect.width,
      y: (pointY(data[i].value) / height) * rect.height,
    })
  }

  const hover = tip?.i ?? null
  const hv = tip ? data[tip.i] : null

  return (
    <div className="relative" onPointerMove={onMove} onPointerLeave={() => setTip(null)}>
      {tip && hv && (
        <ChartTooltip x={tip.x} y={tip.y} visible>
          <span className="text-muted-foreground">{hv.label} · </span>
          <span className="font-semibold">{Math.round(hv.value).toLocaleString('en-US')}</span>
        </ChartTooltip>
      )}
      <svg
        role="img"
        aria-label={ariaLabel}
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        className={cn('h-16 w-full', className)}
      >
        <defs>
          <linearGradient id="sparkline-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="currentColor" stopOpacity={0.25} />
            <stop offset="100%" stopColor="currentColor" stopOpacity={0} />
          </linearGradient>
        </defs>
        {path && (
          <>
            <path d={`${path} L ${width},${height} L 0,${height} Z`} fill="url(#sparkline-fill)" />
            <path
              d={path}
              pathLength={1}
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              className="animate-draw-line"
              style={{ strokeDasharray: 1 }}
            />
            {hover != null && (
              <line
                x1={pointX(hover)}
                x2={pointX(hover)}
                y1={0}
                y2={height}
                stroke="currentColor"
                strokeOpacity={0.3}
                strokeWidth={1}
              />
            )}
            <circle
              cx={hover != null ? pointX(hover) : width}
              cy={hover != null && hv ? pointY(hv.value) : lastY}
              r={3}
              fill="currentColor"
            />
          </>
        )}
        {comparePath && (
          <path
            d={comparePath}
            fill="none"
            stroke="currentColor"
            strokeOpacity={0.4}
            strokeDasharray="4 4"
            strokeWidth={1.5}
          />
        )}
      </svg>
    </div>
  )
}

// ---------------------------------------------------------------------------
// BarChart
// ---------------------------------------------------------------------------

interface BarChartProps {
  data: readonly ChartPoint[]
  ariaLabel: string
  secondary?: { data: readonly ChartPoint[]; label: string; className: string }
  primaryLabel: string
  primaryClassName?: string
  height?: number
  /** Serializable formatter descriptor for axis ticks + tooltip values. */
  valueFormat?: NumberFormat
}

export function BarChart({
  data,
  ariaLabel,
  secondary,
  primaryLabel,
  primaryClassName,
  height = 180,
  valueFormat,
}: BarChartProps) {
  const width = 480
  const padding = { top: 12, right: 8, bottom: 24, left: 36 }
  const innerW = width - padding.left - padding.right
  const innerH = height - padding.top - padding.bottom
  const max = maxValue(data, secondary?.data ?? [])
  const ticks = max === 0 ? [0] : [0, max / 2, max]
  const slot = data.length === 0 ? innerW : innerW / data.length
  const barW = secondary ? Math.max(4, slot * 0.32) : Math.max(6, slot * 0.55)
  const gap = secondary ? Math.max(2, slot * 0.06) : 0
  const fmt = (n: number) => formatStat(n, valueFormat ?? 'number')

  const [tip, setTip] = useState<{ i: number; x: number; y: number } | null>(null)

  function onMove(e: PointerEvent<HTMLDivElement>) {
    if (data.length === 0) return
    const rect = e.currentTarget.getBoundingClientRect()
    const frac =
      rect.width === 0 ? 0 : Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width))
    const idx = Math.floor((frac * width - padding.left) / slot)
    if (idx < 0 || idx >= data.length) {
      setTip(null)
      return
    }
    setTip({
      i: idx,
      x: ((padding.left + idx * slot + slot / 2) / width) * rect.width,
      y: 0.12 * rect.height,
    })
  }

  const hover = tip?.i ?? null
  const hp = tip ? data[tip.i] : null
  const hs = tip && secondary ? secondary.data[tip.i] : null

  return (
    <div className="flex flex-col gap-3">
      <div className="relative" onPointerMove={onMove} onPointerLeave={() => setTip(null)}>
        {tip && hp && (
          <ChartTooltip x={tip.x} y={tip.y} visible>
            <div className="font-semibold">{hp.label}</div>
            <div className={cn('flex items-center gap-1.5', primaryClassName)}>
              <span className="inline-block size-2 rounded-sm bg-current" />
              <span className="text-foreground">
                {primaryLabel}: {fmt(hp.value)}
              </span>
            </div>
            {secondary && hs && (
              <div className={cn('flex items-center gap-1.5', secondary.className)}>
                <span className="inline-block size-2 rounded-sm bg-current" />
                <span className="text-foreground">
                  {secondary.label}: {fmt(hs.value)}
                </span>
              </div>
            )}
          </ChartTooltip>
        )}
        <svg
          role="img"
          aria-label={ariaLabel}
          viewBox={`0 0 ${width} ${height}`}
          className="h-44 w-full"
        >
          {ticks.map((t, i) => {
            const y = padding.top + innerH - (max === 0 ? 0 : (t / max) * innerH)
            return (
              <g key={i}>
                <line
                  x1={padding.left}
                  x2={padding.left + innerW}
                  y1={y}
                  y2={y}
                  stroke="currentColor"
                  strokeOpacity={0.08}
                  strokeDasharray="2 4"
                />
                <text
                  x={padding.left - 6}
                  y={y + 3}
                  fontSize={9}
                  textAnchor="end"
                  fill="currentColor"
                  fillOpacity={0.5}
                >
                  {fmt(t)}
                </text>
              </g>
            )
          })}

          {data.map((p, i) => {
            const x = padding.left + i * slot
            const v = Math.max(0, p.value)
            const h = max === 0 ? 0 : (v / max) * innerH
            const cx = x + (slot - (secondary ? barW * 2 + gap : barW)) / 2
            const secValue = secondary ? Math.max(0, secondary.data[i]?.value ?? 0) : 0
            const secH = max === 0 ? 0 : (secValue / max) * innerH
            const active = hover === i
            const grow = {
              transformBox: 'fill-box' as const,
              transformOrigin: 'bottom',
              animationDelay: `${i * 40}ms`,
            }
            return (
              <g
                key={`${p.label}-${i}`}
                opacity={hover == null || active ? 1 : 0.55}
                style={{ transition: 'opacity 150ms' }}
              >
                <rect
                  x={cx}
                  y={padding.top + innerH - h}
                  width={barW}
                  height={h}
                  rx={3}
                  className={cn('animate-bar-grow fill-current', primaryClassName)}
                  style={grow}
                />
                {secondary && (
                  <rect
                    x={cx + barW + gap}
                    y={padding.top + innerH - secH}
                    width={barW}
                    height={secH}
                    rx={3}
                    className={cn('animate-bar-grow fill-current', secondary.className)}
                    style={grow}
                  />
                )}
                <text
                  x={x + slot / 2}
                  y={height - 8}
                  fontSize={9}
                  textAnchor="middle"
                  fill="currentColor"
                  fillOpacity={0.55}
                >
                  {p.label}
                </text>
              </g>
            )
          })}
        </svg>
      </div>
      <div className="text-muted-foreground flex items-center gap-4 px-1 text-[11px]">
        <span className={cn('inline-flex items-center gap-1.5', primaryClassName)}>
          <span className="inline-block size-2 rounded-sm bg-current" />
          <span className="text-muted-foreground">{primaryLabel}</span>
        </span>
        {secondary && (
          <span className={cn('inline-flex items-center gap-1.5', secondary.className)}>
            <span className="inline-block size-2 rounded-sm bg-current" />
            <span className="text-muted-foreground">{secondary.label}</span>
          </span>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// DonutChart
// ---------------------------------------------------------------------------

interface DonutDatum {
  label: string
  value: number
  className: string
}

interface DonutChartProps {
  data: readonly DonutDatum[]
  ariaLabel: string
  centerValue: string
  centerLabel: string
}

export function DonutChart({ data, ariaLabel, centerValue, centerLabel }: DonutChartProps) {
  const size = 160
  const radius = 64
  const stroke = 22
  const total = data.reduce((sum, d) => sum + Math.max(0, d.value), 0)
  const circumference = 2 * Math.PI * radius
  const [hover, setHover] = useState<number | null>(null)
  let offsetAccum = 0

  const hd = hover != null ? data[hover] : null
  const center = hd
    ? { value: Math.round(hd.value).toLocaleString('en-US'), label: hd.label }
    : { value: centerValue, label: centerLabel }

  return (
    <div className="flex items-center gap-5">
      <svg
        role="img"
        aria-label={ariaLabel}
        viewBox={`0 0 ${size} ${size}`}
        className="animate-pop-in size-40"
      >
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeOpacity={0.08}
          strokeWidth={stroke}
        />
        {total > 0 &&
          data.map((d, i) => {
            const v = Math.max(0, d.value)
            const dash = (v / total) * circumference
            const gap = circumference - dash
            const dashOffset = -offsetAccum
            offsetAccum += dash
            const active = hover === i
            return (
              <circle
                key={`${d.label}-${i}`}
                cx={size / 2}
                cy={size / 2}
                r={radius}
                fill="none"
                stroke="currentColor"
                strokeWidth={active ? stroke + 4 : stroke}
                strokeDasharray={`${dash} ${gap}`}
                strokeDashoffset={dashOffset}
                transform={`rotate(-90 ${size / 2} ${size / 2})`}
                className={cn(d.className, 'cursor-pointer')}
                strokeLinecap="butt"
                opacity={hover == null || active ? 1 : 0.5}
                style={{ transition: 'opacity 150ms, stroke-width 150ms' }}
                onPointerEnter={() => setHover(i)}
                onPointerLeave={() => setHover(null)}
              />
            )
          })}
        <text
          x={size / 2}
          y={size / 2 - 4}
          textAnchor="middle"
          fontSize={20}
          fontWeight={700}
          fill="currentColor"
        >
          {center.value}
        </text>
        <text
          x={size / 2}
          y={size / 2 + 14}
          textAnchor="middle"
          fontSize={9}
          fill="currentColor"
          fillOpacity={0.6}
        >
          {center.label}
        </text>
      </svg>
      <ul className="flex flex-col gap-1.5 text-xs">
        {data.map((d, i) => (
          <li
            key={d.label}
            className={cn(
              'flex cursor-pointer items-center gap-2 transition-opacity',
              hover != null && hover !== i && 'opacity-50'
            )}
            onPointerEnter={() => setHover(i)}
            onPointerLeave={() => setHover(null)}
          >
            <span className={cn('inline-block size-2.5 rounded-sm bg-current', d.className)} />
            <span className="text-foreground font-mono tabular-nums">
              {Math.round(d.value).toLocaleString('en-US')}
            </span>
            <span className="text-muted-foreground">{d.label}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Delta
// ---------------------------------------------------------------------------

interface DeltaProps {
  current: number
  previous: number
  /** When true, an increase is "bad" (e.g. cost). */
  invert?: boolean
}

export function Delta({ current, previous, invert = false }: DeltaProps) {
  const diff = current - previous
  const pct = previous === 0 ? (current === 0 ? 0 : 100) : (diff / previous) * 100
  const positive = invert ? diff < 0 : diff > 0
  const flat = diff === 0
  const fmt = (n: number) => `${Math.abs(n).toFixed(1)}%`
  const cls = flat
    ? 'text-muted-foreground'
    : positive
      ? 'text-emerald-600 dark:text-emerald-400'
      : 'text-rose-600 dark:text-rose-400'
  const arrow = flat ? '·' : positive ? '↑' : '↓'
  return (
    <span className={cn('inline-flex items-center gap-1 font-mono text-xs tabular-nums', cls)}>
      <span aria-hidden="true">{arrow}</span>
      <span>{fmt(pct)}</span>
    </span>
  )
}
