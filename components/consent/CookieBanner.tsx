'use client'

// GDPR clickwrap: gates PostHog init on explicit user choice and exposes
// a shared subscription so providers can react when consent flips at runtime.

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState, useSyncExternalStore } from 'react'
import { GradientButton } from '@/components/brand/GradientButton'
import { Button } from '@/components/ui/button'

const STORAGE_KEY = 'trendly.consent'
const GRANTED_EVENT = 'trendly:consent-granted'
const DECLINED_EVENT = 'trendly:consent-declined'

export type ConsentState = 'granted' | 'declined' | 'unknown'

function readConsent(): ConsentState {
  if (typeof window === 'undefined') return 'unknown'
  const value = window.localStorage.getItem(STORAGE_KEY)
  if (value === 'granted' || value === 'declined') return value
  return 'unknown'
}

function subscribe(callback: () => void): () => void {
  if (typeof window === 'undefined') return () => {}
  const handler = () => callback()
  window.addEventListener(GRANTED_EVENT, handler)
  window.addEventListener(DECLINED_EVENT, handler)
  window.addEventListener('storage', handler)
  return () => {
    window.removeEventListener(GRANTED_EVENT, handler)
    window.removeEventListener(DECLINED_EVENT, handler)
    window.removeEventListener('storage', handler)
  }
}

export function useConsentState(): ConsentState {
  return useSyncExternalStore(
    subscribe,
    () => readConsent(),
    () => 'unknown' as const
  )
}

export function CookieBanner() {
  const pathname = usePathname()
  const consent = useConsentState()
  // 300ms mount delay avoids a hydration-time flash + lets above-the-fold
  // content paint first. Once the user picks (or already picked previously),
  // the render-time `consent !== 'unknown'` check hides the banner — no
  // setState-in-effect needed for the consent-change case.
  const [delayPassed, setDelayPassed] = useState(false)

  useEffect(() => {
    const timer = window.setTimeout(() => setDelayPassed(true), 300)
    return () => window.clearTimeout(timer)
  }, [])

  // Admins are internal testers, not consumers — skip the consent prompt for
  // their own product's analytics. GDPR gate still applies on every public page.
  if (pathname?.startsWith('/admin')) return null
  if (consent !== 'unknown' || !delayPassed) return null

  const accept = () => {
    window.localStorage.setItem(STORAGE_KEY, 'granted')
    window.dispatchEvent(new Event(GRANTED_EVENT))
  }

  const decline = () => {
    window.localStorage.setItem(STORAGE_KEY, 'declined')
    window.dispatchEvent(new Event(DECLINED_EVENT))
  }

  return (
    <div
      role="dialog"
      aria-label="Cookie consent"
      className="border-border/60 bg-card shadow-pop fixed right-4 bottom-4 left-4 z-40 rounded-2xl border p-4 sm:right-6 sm:bottom-6 sm:left-auto sm:max-w-md"
    >
      <p className="text-sm font-semibold">Cookies</p>
      <p className="text-muted-foreground mt-1 text-sm">
        We use cookies and PostHog to understand product use. No third-party advertising, no data
        sale.
      </p>
      <div className="mt-3 flex items-center gap-2">
        <GradientButton size="sm" onClick={accept}>
          Accept
        </GradientButton>
        <Button variant="outline" size="sm" onClick={decline}>
          Decline
        </Button>
      </div>
      <Link
        href="/privacy"
        className="text-muted-foreground mt-2 inline-block text-xs underline-offset-4 hover:underline"
      >
        Privacy policy
      </Link>
    </div>
  )
}
