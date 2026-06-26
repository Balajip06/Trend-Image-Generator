'use client'

import { useEffect, useRef, useState } from 'react'
import { useReducedMotion } from './useReducedMotion'

/**
 * Change-driven count tween. First render shows `target` verbatim (no SSR flash,
 * no layout shift). When `target` CHANGES (e.g. a 15s refresh or a live update),
 * it eases from the previous value to the new one — the premium "tick" that draws
 * the eye to genuinely-changed numbers. Snaps instantly under reduced-motion or
 * when the value is unchanged/non-finite.
 */
export function useCountUp(target: number, opts?: { durationMs?: number }): number {
  const reduced = useReducedMotion()
  const duration = opts?.durationMs ?? 700
  const [value, setValue] = useState(target)
  const prevRef = useRef(target)
  const rafRef = useRef<number | null>(null)

  useEffect(() => {
    const from = prevRef.current
    prevRef.current = target
    if (reduced || from === target || !Number.isFinite(target) || !Number.isFinite(from)) {
      setValue(target)
      return
    }
    let start: number | null = null
    const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3)
    const tick = (ts: number) => {
      if (start === null) start = ts
      const p = Math.min(1, (ts - start) / duration)
      setValue(from + (target - from) * easeOutCubic(p))
      if (p < 1) {
        rafRef.current = requestAnimationFrame(tick)
      } else {
        setValue(target)
      }
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
    }
  }, [target, reduced, duration])

  return value
}
