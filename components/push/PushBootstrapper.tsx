'use client'

import { useEffect } from 'react'
import { registerServiceWorker } from '@/lib/push/client'

/**
 * Mounted once inside the authed (app) layout. Registers the service worker
 * on first paint so that when the user later opts in via ensurePushSubscription,
 * the registration is ready.
 *
 * Silent — never asks for notification permission here.
 */
export function PushBootstrapper(): null {
  useEffect(() => {
    void registerServiceWorker()
  }, [])
  return null
}
