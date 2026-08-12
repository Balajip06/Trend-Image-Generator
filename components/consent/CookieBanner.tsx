'use client'

// GDPR clickwrap: gates PostHog init on explicit user choice and exposes
// a shared subscription so providers can react when consent flips at runtime.
//
// Prompt is currently disabled — the banner never renders, and consent
// silently defaults to granted (see useConsentState below) so
// PostHogProvider still initialises. Storage key + events stay wired for
// a future re-enable.

import { useSyncExternalStore } from 'react'

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
  const stored = useSyncExternalStore(
    subscribe,
    () => readConsent(),
    () => 'unknown' as const
  )
  return stored === 'unknown' ? 'granted' : stored
}

export function CookieBanner() {
  return null
}
