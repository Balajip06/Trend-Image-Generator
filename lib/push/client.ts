/**
 * Client-side push subscription helpers.
 *
 * Flow:
 *   1. registerServiceWorker() on app boot (silent, no prompt)
 *   2. ensurePushSubscription() after first successful generation completes:
 *      - asks permission only if 'default' (never re-prompts after denial)
 *      - subscribes via PushManager
 *      - POSTs subscription to /api/push/subscribe (writes profiles.push_subscription)
 *
 * iOS Safari 16.4+ requires the PWA be installed (Add to Home Screen) before
 * Notification.requestPermission resolves — `isIosSafariNeedsInstall()` lets
 * callers surface a hint instead of silently failing.
 */

const VAPID_PUBLIC_KEY_ENV = 'NEXT_PUBLIC_VAPID_PUBLIC_KEY'

export type PushPermissionState = 'granted' | 'denied' | 'default' | 'unsupported'

export function isPushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  )
}

export function isIosSafariNeedsInstall(): boolean {
  if (typeof navigator === 'undefined' || typeof window === 'undefined') return false
  const ua = navigator.userAgent
  const isIos = /iPad|iPhone|iPod/.test(ua) && !('MSStream' in window)
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches
  return isIos && !isStandalone
}

export function getPermissionState(): PushPermissionState {
  if (!isPushSupported()) return 'unsupported'
  return Notification.permission
}

export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!isPushSupported()) return null
  try {
    return await navigator.serviceWorker.register('/sw.js')
  } catch {
    return null
  }
}

interface EnsureResult {
  ok: boolean
  reason?: 'unsupported' | 'denied' | 'needs_pwa_install' | 'no_vapid_key' | 'subscribe_failed' | 'post_failed'
}

export async function ensurePushSubscription(): Promise<EnsureResult> {
  if (!isPushSupported()) return { ok: false, reason: 'unsupported' }

  const vapidPublicKey = (process.env[VAPID_PUBLIC_KEY_ENV] ?? '').trim()
  if (!vapidPublicKey) return { ok: false, reason: 'no_vapid_key' }

  if (isIosSafariNeedsInstall()) return { ok: false, reason: 'needs_pwa_install' }

  if (Notification.permission === 'denied') return { ok: false, reason: 'denied' }
  if (Notification.permission === 'default') {
    const granted = await Notification.requestPermission()
    if (granted !== 'granted') return { ok: false, reason: 'denied' }
  }

  const reg = await navigator.serviceWorker.ready
  let sub = await reg.pushManager.getSubscription()
  if (!sub) {
    try {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        // PushManager expects BufferSource backed by ArrayBuffer; Uint8Array<ArrayBufferLike>
        // is a strict supertype in lib.dom types, so cast.
        applicationServerKey: urlBase64ToUint8Array(vapidPublicKey) as BufferSource,
      })
    } catch {
      return { ok: false, reason: 'subscribe_failed' }
    }
  }

  const res = await fetch('/api/push/subscribe', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ subscription: sub.toJSON() }),
  })
  if (!res.ok) return { ok: false, reason: 'post_failed' }
  return { ok: true }
}

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4)
  const safe = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(safe)
  const out = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}
