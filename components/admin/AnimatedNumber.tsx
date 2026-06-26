'use client'

import { useCountUp } from '@/lib/hooks/useCountUp'

interface AnimatedNumberProps {
  /** The target numeric value. Animates from the previous value when this changes. */
  value: number
  /** Format the tweened number for display (e.g. currency, %, comma groups). */
  format?: (n: number) => string
  className?: string
  durationMs?: number
}

/**
 * Renders a number that smoothly counts to its target whenever the value changes.
 * Tabular figures so the width doesn't jitter mid-tween.
 */
export function AnimatedNumber({ value, format, className, durationMs }: AnimatedNumberProps) {
  const display = useCountUp(value, { durationMs })
  const text = format ? format(display) : String(Math.round(display))
  return (
    <span className={className} style={{ fontVariantNumeric: 'tabular-nums' }}>
      {text}
    </span>
  )
}
