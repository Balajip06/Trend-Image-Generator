'use client'

import { Moon, Sun } from 'lucide-react'
import { useTheme } from 'next-themes'
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme()
  const [mounted, setMounted] = useState(false)
  // SSR-safe mount flag — standard next-themes pattern. The synchronous
  // setState runs once on mount to flip resolvedTheme without a hydration mismatch.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setMounted(true), [])

  // Pre-mount, render a neutral placeholder so SSR + hydration agree.
  if (!mounted) {
    return (
      <Button variant="ghost" size="icon" aria-hidden className="opacity-0" tabIndex={-1}>
        <Sun />
      </Button>
    )
  }

  const isDark = resolvedTheme === 'dark'
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      onClick={() => setTheme(isDark ? 'light' : 'dark')}
    >
      {isDark ? <Sun /> : <Moon />}
    </Button>
  )
}
