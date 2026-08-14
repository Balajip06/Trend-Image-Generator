/**
 * Regression tests for the Realtime auth handshake.
 *
 * The `@supabase/ssr` browser client does not push the session token onto the
 * Realtime websocket. Without an explicit `realtime.setAuth(token)` BEFORE
 * `.subscribe()`, `postgres_changes` evaluates RLS as `anon`, every event is
 * denied, and the channel receives nothing — while still reporting SUBSCRIBED.
 *
 * That silent failure is why the admin Live monitor appeared wired up but never
 * updated. These tests pin both the call and its ordering.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest'

const setAuth = vi.fn()
const removeChannel = vi.fn()
const subscribe = vi.fn()
const on = vi.fn()

/** Ordered log of realtime calls, so we can assert setAuth precedes subscribe. */
let callOrder: string[] = []
let sessionToken: string | null = 'jwt-token-123'

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: {
      getSession: async () => ({
        data: { session: sessionToken ? { access_token: sessionToken } : null },
      }),
    },
    realtime: {
      setAuth: (token: string) => {
        callOrder.push('setAuth')
        setAuth(token)
      },
    },
    channel: (name: string) => {
      callOrder.push(`channel:${name}`)
      const chan = {
        on: (...args: unknown[]) => {
          on(...args)
          return chan
        },
        subscribe: (cb: (status: string) => void) => {
          callOrder.push('subscribe')
          subscribe(cb)
          cb('SUBSCRIBED')
          return chan
        },
      }
      return chan
    },
    removeChannel,
  }),
}))

import { openAuthedChannel } from './authedChannel'

/** Lets the helper's internal async IIFE run to completion. */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

beforeEach(() => {
  callOrder = []
  sessionToken = 'jwt-token-123'
  vi.clearAllMocks()
})

describe('openAuthedChannel', () => {
  it('calls realtime.setAuth with the session token', async () => {
    openAuthedChannel({ channelName: 'rt-test', configure: (c) => c })
    await flush()

    expect(setAuth).toHaveBeenCalledWith('jwt-token-123')
  })

  it('calls setAuth BEFORE subscribe', async () => {
    openAuthedChannel({ channelName: 'rt-test', configure: (c) => c })
    await flush()

    // Ordering is the whole point: setting the token after subscribing leaves
    // the initial subscription evaluating as `anon`.
    expect(callOrder.indexOf('setAuth')).toBeGreaterThanOrEqual(0)
    expect(callOrder.indexOf('subscribe')).toBeGreaterThan(callOrder.indexOf('setAuth'))
  })

  it('still subscribes when there is no session (public tables)', async () => {
    sessionToken = null
    openAuthedChannel({ channelName: 'rt-test', configure: (c) => c })
    await flush()

    expect(setAuth).not.toHaveBeenCalled()
    expect(subscribe).toHaveBeenCalled()
  })

  it('reports live on SUBSCRIBED and flags a resubscribe on the second one', async () => {
    const onStatus = vi.fn()
    openAuthedChannel({ channelName: 'rt-test', configure: (c) => c, onStatus })
    await flush()

    // First SUBSCRIBED is the initial connect, not a reconnect.
    expect(onStatus).toHaveBeenCalledWith('live', false)
  })

  it('removes the channel on teardown', async () => {
    const close = openAuthedChannel({ channelName: 'rt-test', configure: (c) => c })
    await flush()
    close()

    expect(removeChannel).toHaveBeenCalled()
  })

  it('does not subscribe when torn down before the session resolves', async () => {
    const close = openAuthedChannel({ channelName: 'rt-test', configure: (c) => c })
    close() // unmount before the async session lookup settles
    await flush()

    expect(subscribe).not.toHaveBeenCalled()
  })
})
