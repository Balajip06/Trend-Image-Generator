/**
 * Stripe webhook payload fixtures shaped exactly as `webhook_events.payload`
 * stores them.
 *
 * WHY THIS FILE EXISTS: `app/api/stripe/webhook/route.ts:28-30` stores the
 * WHOLE `Stripe.Event` (`payload: stripeEventToJson(event)`), and the route's
 * own dispatch reads `event.data.object as Stripe.Checkout.Session`
 * (route.ts:115-120, :151-156). So the money field lives at
 * `payload.data.object.*`, never at `payload.*`.
 *
 * `margin.ts` read `payload.amount_total` — always `undefined` → revenue was
 * structurally $0 no matter how many real purchases existed. The old
 * `margin.test.ts` could not catch it: every test there used an empty client,
 * which forces the mock branch, so the real data path had zero coverage.
 *
 * These fixtures are trimmed to the fields the analytics layer reads. Field
 * names and nesting mirror the Stripe API; do not "simplify" the nesting —
 * the nesting IS the regression under test.
 */

/** Amounts are in the smallest currency unit (cents), as Stripe sends them. */
export const CHECKOUT_SESSION_COMPLETED = {
  id: 'evt_checkout_1',
  type: 'checkout.session.completed',
  data: {
    object: {
      id: 'cs_test_1',
      object: 'checkout.session',
      mode: 'payment',
      amount_total: 1499, // $14.99 — the medium credit pack
      currency: 'usd',
      customer_email: 'buyer-one@example.com',
      client_reference_id: null,
      metadata: { user_id: 'user-1' },
    },
  },
} as const

/** Attribution fallback: no metadata.user_id, only client_reference_id. */
export const CHECKOUT_SESSION_VIA_CLIENT_REF = {
  id: 'evt_checkout_2',
  type: 'checkout.session.completed',
  data: {
    object: {
      id: 'cs_test_2',
      object: 'checkout.session',
      mode: 'payment',
      amount_total: 499, // $4.99 — the small credit pack
      currency: 'usd',
      customer_email: 'buyer-two@example.com',
      client_reference_id: 'user-2',
      metadata: {},
    },
  },
} as const

/**
 * Subscription revenue arrives here, NOT on checkout.session. Invoices carry
 * `amount_paid`; they have no `amount_total`. A reader that only knows
 * `amount_total` scores every subscription dollar as $0.
 */
export const INVOICE_PAID = {
  id: 'evt_invoice_1',
  type: 'invoice.paid',
  data: {
    object: {
      id: 'in_test_1',
      object: 'invoice',
      amount_paid: 999, // $9.99/mo
      amount_due: 999,
      currency: 'usd',
      customer_email: 'subscriber@example.com',
      subscription: 'sub_test_1',
      metadata: { user_id: 'user-3' },
    },
  },
} as const

/**
 * Charges carry `amount`. A refund is NEGATIVE revenue — summing this as
 * income (which a naive `amount`-reader does) inflates revenue by 2x the
 * refunded value: once for the original charge, once for the refund.
 */
export const CHARGE_REFUNDED = {
  id: 'evt_charge_refund_1',
  type: 'charge.refunded',
  data: {
    object: {
      id: 'ch_test_1',
      object: 'charge',
      amount: 1499,
      amount_refunded: 1499,
      currency: 'usd',
      refunded: true,
      metadata: { user_id: 'user-1' },
    },
  },
} as const

export const CHARGE_DISPUTE_CREATED = {
  id: 'evt_dispute_1',
  type: 'charge.dispute.created',
  data: {
    object: {
      id: 'dp_test_1',
      object: 'dispute',
      amount: 499,
      currency: 'usd',
      charge: 'ch_test_2',
    },
  },
} as const

/** Handled by the route but carries no revenue of its own. */
export const SUBSCRIPTION_UPDATED = {
  id: 'evt_sub_1',
  type: 'customer.subscription.updated',
  data: {
    object: {
      id: 'sub_test_1',
      object: 'subscription',
      status: 'active',
      metadata: { user_id: 'user-3' },
    },
  },
} as const

/**
 * `credit_clawback` is what `claw_back_credits()` writes
 * (migration 20260604000003:42-46) — this is the REAL refund signal.
 * `margin.ts` was reading `credit_grant` (a GRANT — i.e. a purchase or a
 * comp) and looking for a `credits` key that is never written; the actual
 * key is `amount` (migration 20260528000001:33-39).
 */
export const AUDIT_CREDIT_CLAWBACK = {
  action: 'credit_clawback',
  after: { amount: 50, bucket: 'purchased', reason: 'charge.refunded' },
} as const

/** A purchase grant. Must NEVER be counted as a refund. */
export const AUDIT_CREDIT_GRANT_STRIPE = {
  action: 'credit_grant',
  after: { amount: 200, source: 'stripe', source_ref: 'evt_checkout_1' },
} as const
