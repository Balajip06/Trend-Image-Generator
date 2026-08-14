/**
 * Readers for `webhook_events.payload`.
 *
 * `app/api/stripe/webhook/route.ts:28-30` stores the ENTIRE `Stripe.Event`
 * (`payload: stripeEventToJson(event)`), and the route's own dispatch reads
 * `event.data.object as Stripe.Checkout.Session` (route.ts:115-120, :151-156).
 * The money fields therefore live at `payload.data.object.*`.
 *
 * Reading `payload.amount_total` — as the analytics layer did — always yields
 * `undefined`, so revenue summed to $0 regardless of real sales. These helpers
 * exist so that path is expressed once, with the per-event-type differences
 * handled explicitly:
 *
 *   - `checkout.session.*` carries `amount_total`
 *   - `invoice.*`          carries `amount_paid` (subscription revenue)
 *   - `charge.*`           carries `amount`
 *
 * Only genuine income counts. `charge.refunded` and `charge.dispute.created`
 * are stored in the same table and handled by `handleChargeClawback`; summing
 * their `amount` as revenue would inflate income by the refunded value.
 */

/** Event types that represent money coming in. */
const REVENUE_EVENT_TYPES = new Set([
  'checkout.session.completed',
  'checkout.session.async_payment_succeeded',
  'invoice.paid',
  'invoice.payment_succeeded',
])

/** Event types that represent money going back out. */
const REFUND_EVENT_TYPES = new Set(['charge.refunded', 'charge.dispute.created'])

interface StripeEventPayload {
  type?: string
  data?: { object?: Record<string, unknown> }
}

/** Narrow an unknown jsonb payload to the event envelope we expect. */
function asEvent(payload: unknown): StripeEventPayload | null {
  if (!payload || typeof payload !== 'object') return null
  return payload as StripeEventPayload
}

function centsToUsd(cents: unknown): number {
  const n = Number(cents ?? 0)
  return Number.isFinite(n) ? n / 100 : 0
}

/**
 * USD income for one stored Stripe event. Returns 0 for refunds, disputes,
 * subscription lifecycle events, and anything unrecognized — so a new event
 * type can never silently inflate revenue.
 */
export function revenueUsdFromEvent(payload: unknown): number {
  const event = asEvent(payload)
  const type = event?.type
  if (!type || !REVENUE_EVENT_TYPES.has(type)) return 0

  const object = event?.data?.object
  if (!object) return 0

  if (type.startsWith('checkout.session.')) return centsToUsd(object.amount_total)
  if (type.startsWith('invoice.')) return centsToUsd(object.amount_paid)
  return 0
}

/**
 * USD refunded/disputed for one stored Stripe event. Returns a POSITIVE
 * magnitude; callers subtract it.
 */
export function refundUsdFromEvent(payload: unknown): number {
  const event = asEvent(payload)
  const type = event?.type
  if (!type || !REFUND_EVENT_TYPES.has(type)) return 0

  const object = event?.data?.object
  if (!object) return 0

  // `charge.refunded` reports the running refunded total; a dispute reports
  // the disputed amount.
  if (type === 'charge.refunded') {
    return centsToUsd(object.amount_refunded ?? object.amount)
  }
  return centsToUsd(object.amount)
}

/**
 * The user a payment belongs to. Mirrors the webhook's own resolution order
 * (`route.ts:156`): `metadata.user_id` first, then `client_reference_id`.
 * Reading only `metadata.user_id` silently drops every purchase attributed
 * the other way.
 */
export function userIdFromEvent(payload: unknown): string | null {
  const object = asEvent(payload)?.data?.object
  if (!object) return null
  const metadata = object.metadata as Record<string, unknown> | undefined
  const fromMetadata = metadata?.user_id
  if (typeof fromMetadata === 'string' && fromMetadata) return fromMetadata
  const fromRef = object.client_reference_id
  return typeof fromRef === 'string' && fromRef ? fromRef : null
}

/** Billing email for distinct-customer counts, when Stripe supplies one. */
export function customerEmailFromEvent(payload: unknown): string | null {
  const object = asEvent(payload)?.data?.object
  if (!object) return null
  const email = object.customer_email
  return typeof email === 'string' && email ? email : null
}
