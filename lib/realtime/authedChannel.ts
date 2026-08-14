'use client'

/**
 * Authenticated Realtime channel setup.
 *
 * THE BUG THIS EXISTS TO PREVENT: the `@supabase/ssr` browser client keeps the
 * session in cookies and does NOT push the access token onto the Realtime
 * websocket the way the plain client (localStorage + onAuthStateChange) does.
 * Without `realtime.setAuth(token)`, `postgres_changes` evaluates its per-row
 * RLS check as the `anon` role, every event is denied, and the channel receives
 * NOTHING — while still reporting `SUBSCRIBED`. It fails silently, which is why
 * the admin Live monitor looked wired up but never updated.
 *
 * `ResultView.tsx` discovered and documented this for the consumer result page;
 * `useRealtimeTable` never did it, so every admin subscription was dead. This
 * module is the single implementation both paths now share.
 */

import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/client'

/** Connection state for a live indicator. */
export type RealtimeStatus = 'connecting' | 'live' | 'reconnecting'

export interface AuthedChannelOptions {
  /** Unique channel name. Two channels sharing a name collide. */
  channelName: string
  /** Wire up `.on(...)` handlers. Called before `.subscribe()`. */
  configure: (channel: RealtimeChannel) => RealtimeChannel
  /** Fired on every subscribe transition, including reconnects. */
  onStatus?: (status: RealtimeStatus, isResubscribe: boolean) => void
}

/**
 * Opens an RLS-authenticated Realtime channel and returns a teardown function.
 *
 * Push the session token onto the socket BEFORE subscribing so the channel is
 * opened with it already applied — setting it afterwards leaves the initial
 * subscription evaluating as `anon`.
 */
export function openAuthedChannel({
  channelName,
  configure,
  onStatus,
}: AuthedChannelOptions): () => void {
  const supabase: SupabaseClient = createClient()
  let channel: RealtimeChannel | null = null
  let cancelled = false
  let hasSubscribed = false

  void (async () => {
    const {
      data: { session },
    } = await supabase.auth.getSession()
    if (cancelled) return

    // MUST happen before .subscribe().
    if (session?.access_token) {
      supabase.realtime.setAuth(session.access_token)
    }

    channel = configure(supabase.channel(channelName)).subscribe((channelStatus) => {
      if (cancelled) return
      if (channelStatus === 'SUBSCRIBED') {
        const isResubscribe = hasSubscribed
        hasSubscribed = true
        onStatus?.('live', isResubscribe)
      } else if (
        channelStatus === 'CHANNEL_ERROR' ||
        channelStatus === 'TIMED_OUT' ||
        channelStatus === 'CLOSED'
      ) {
        onStatus?.(hasSubscribed ? 'reconnecting' : 'connecting', false)
      }
    })
  })()

  return () => {
    cancelled = true
    if (channel) void supabase.removeChannel(channel)
  }
}
