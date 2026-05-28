/**
 * Server-side analytics façade. Wraps posthog-node behind a lazy singleton so
 * call sites don't import the SDK directly, and so dev/preview without
 * NEXT_PUBLIC_POSTHOG_KEY silently no-op rather than throwing.
 *
 * Serverless gotcha: each invocation may be cold. flushAt:1 + flushInterval:0
 * means a capture() is sent immediately, but the underlying HTTP request is
 * still async — callers that produce a single event from a short-lived
 * Server Action / Route Handler MUST `await flushServer()` before returning,
 * otherwise the function may die before the event leaves.
 */

import { PostHog } from 'posthog-node'

import { EVENTS, type EventName, type PayloadByEvent } from './events'

let cached: PostHog | null = null

function getClient(): PostHog | null {
  if (cached) return cached
  const key = process.env.NEXT_PUBLIC_POSTHOG_KEY
  if (!key) return null
  cached = new PostHog(key, {
    host: process.env.NEXT_PUBLIC_POSTHOG_HOST ?? 'https://us.i.posthog.com',
    flushAt: 1,
    flushInterval: 0,
  })
  return cached
}

export function trackServer<E extends EventName>(
  distinctId: string,
  event: E,
  payload: PayloadByEvent[E]
): void {
  const client = getClient()
  if (!client) return
  client.capture({
    distinctId,
    event,
    properties: payload as Record<string, unknown>,
  })
}

export function identifyServer(
  distinctId: string,
  properties?: Record<string, unknown>
): void {
  const client = getClient()
  if (!client) return
  client.identify({ distinctId, properties })
}

/**
 * Awaitable flush — call at the end of a Server Action / Route Handler /
 * Edge Function that produced events, before the response is returned,
 * to guarantee delivery in the short-lived serverless lifecycle.
 */
export async function flushServer(): Promise<void> {
  if (!cached) return
  try {
    await cached.flush()
  } catch {
    // Best-effort — analytics must not break the user flow.
  }
}

export { EVENTS }
