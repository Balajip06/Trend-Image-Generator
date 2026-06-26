import { type ReactNode } from 'react'
import { cn } from '@/lib/utils/cn'

interface RevealProps {
  children: ReactNode
  /** Stagger delay in ms before the entrance plays. */
  delay?: number
  /** Entrance style. */
  variant?: 'fade-up' | 'pop-in'
  className?: string
  as?: 'div' | 'li' | 'section'
}

/**
 * One-shot entrance wrapper. Applies the fade-up / pop-in keyframe on mount
 * (CSS `both` fill → starts hidden, plays once). It does NOT replay on a
 * `router.refresh()` because React keeps the mounted node, and the global
 * reduced-motion reset neutralizes it. Server-compatible (no client JS).
 */
export function Reveal({
  children,
  delay = 0,
  variant = 'fade-up',
  className,
  as: Tag = 'div',
}: RevealProps) {
  return (
    <Tag
      className={cn(variant === 'pop-in' ? 'animate-pop-in' : 'animate-fade-up', className)}
      style={delay ? { animationDelay: `${delay}ms` } : undefined}
    >
      {children}
    </Tag>
  )
}
