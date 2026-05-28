/**
 * Hero CTA button — wraps shadcn Button with the brand pink→orange→gold
 * gradient + soft glow + pop-in spring.
 *
 * Keeps shadcn Button untouched (its file is regenerable from the CLI).
 */
import * as React from 'react'
import { Slot } from 'radix-ui'
import { cn } from '@/lib/utils/cn'

interface GradientButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  asChild?: boolean
  size?: 'sm' | 'md' | 'lg' | 'xl'
}

const SIZE_CLASSES: Record<NonNullable<GradientButtonProps['size']>, string> = {
  sm: 'h-9 px-4 text-sm',
  md: 'h-11 px-6 text-sm',
  lg: 'h-12 px-7 text-base',
  xl: 'h-14 px-8 text-lg',
}

export function GradientButton({
  className,
  asChild = false,
  size = 'md',
  ...props
}: GradientButtonProps) {
  const Comp = asChild ? Slot.Root : 'button'
  return (
    <Comp
      data-slot="gradient-button"
      className={cn(
        'group relative inline-flex shrink-0 items-center justify-center gap-2 overflow-hidden rounded-full font-semibold text-white outline-none transition-transform',
        'brand-grad brand-glow',
        'hover:scale-[1.02] active:scale-[0.98]',
        'focus-visible:ring-[3px] focus-visible:ring-ring/60',
        'disabled:pointer-events-none disabled:opacity-50',
        SIZE_CLASSES[size],
        className,
      )}
      {...props}
    />
  )
}
