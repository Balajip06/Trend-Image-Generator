import { NextResponse, type NextRequest } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import Stripe from 'stripe'
import { EVENTS, flushServer, trackServer } from '@/lib/analytics/server'
import { createServiceClient } from '@/lib/supabase/server'
import type { Json } from '@/lib/supabase/database.types'
import { grantCredits } from '@/lib/payments/credits'
import { findPack, isPackId } from '@/lib/payments/packs'
import { findPlanByPriceId } from '@/lib/payments/plans'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function getStripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY
  if (!key) throw new Error('STRIPE_SECRET_KEY missing')
  return new Stripe(key)
}

/**
 * Narrow a Stripe.Event to the generated `Json` type for storage in the
 * `webhook_events.payload` JSONB column. Stripe events are wire-format JSON
 * coming off the SDK's `constructEvent` parser — every field is already a
 * primitive, plain object, or array. The cast is required only because the
 * SDK's recursive TypeScript type doesn't structurally match our `Json`
 * helper; the runtime payload is provably Json-compatible.
 */
function stripeEventToJson(event: Stripe.Event): Json {
  return event as unknown as Json
}

export async function POST(request: NextRequest) {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET
  if (!webhookSecret) {
    return NextResponse.json({ error: 'webhook not configured' }, { status: 503 })
  }

  const signature = request.headers.get('stripe-signature')
  if (!signature) {
    return NextResponse.json({ error: 'missing signature' }, { status: 400 })
  }

  const rawBody = await request.text()
  const stripe = getStripe()

  let event: Stripe.Event
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret)
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'invalid signature'
    return NextResponse.json({ error: message }, { status: 400 })
  }

  const supabase = createServiceClient()

  // Idempotency gate: insert into webhook_events; UNIQUE (source, event_id) blocks duplicates.
  const webhookRow = {
    source: 'stripe',
    event_id: event.id,
    payload: stripeEventToJson(event),
  }

  const { error: insertError } = await supabase.from('webhook_events').insert(webhookRow)

  if (insertError) {
    // 23505 = duplicate key = already processed; return 200 idempotently.
    if (insertError.message.includes('duplicate key')) {
      return NextResponse.json({ received: true, duplicate: true })
    }
    return NextResponse.json({ error: insertError.message }, { status: 500 })
  }

  // Dispatch
  try {
    await handleEvent(event, supabase)
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'handler error'
    // Mark processed_at NULL stays so a retry can re-run; but unique constraint
    // means Stripe must resend with a new event_id. Log + 500 so Stripe retries.
    Sentry.captureException(
      err instanceof Error ? err : new Error(String(err)),
      { extra: { event_id: event.id, event_type: event.type } }
    )
    return NextResponse.json({ error: message }, { status: 500 })
  }

  // Mark processed. Red-team H6: a silent failure here leaves the row
  // looking unprocessed even though credits were granted, which corrupts
  // the `webhook_events_unprocessed_idx` monitoring partial index and
  // makes oncall reconciliation queries wrong. Surface to Sentry instead
  // of swallowing — but still return 200 so Stripe does not retry (the
  // grant already happened; a retry would no-op via the duplicate-key
  // path on insert anyway).
  const processedUpdate = { processed_at: new Date().toISOString() }
  const { error: processedError } = await supabase
    .from('webhook_events')
    .update(processedUpdate)
    .eq('source', 'stripe')
    .eq('event_id', event.id)

  if (processedError) {
    Sentry.captureException(
      new Error(`webhook_events processed_at stamp failed: ${processedError.message}`),
      { extra: { event_id: event.id, event_type: event.type } }
    )
  }

  return NextResponse.json({ received: true })
}

async function handleEvent(
  event: Stripe.Event,
  supabase: ReturnType<typeof createServiceClient>
): Promise<void> {
  switch (event.type) {
    case 'checkout.session.completed':
      await handleCheckoutCompleted(
        event.data.object as Stripe.Checkout.Session,
        event.id,
        supabase
      )
      return
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
      await handleSubscriptionUpsert(event.data.object as Stripe.Subscription, supabase)
      return
    case 'customer.subscription.deleted':
      await handleSubscriptionDeleted(event.data.object as Stripe.Subscription, supabase)
      return
    case 'invoice.paid':
      await handleInvoicePaid(event.data.object as Stripe.Invoice, supabase)
      return
    case 'invoice.payment_failed':
      await handleInvoicePaymentFailed(event.data.object as Stripe.Invoice, supabase)
      return
    case 'charge.refunded':
    case 'charge.dispute.created':
      await handleChargeClawback(
        event.data.object as Stripe.Charge,
        event.type,
        event.id,
        supabase
      )
      return
    default:
      // Breadcrumb unhandled events instead of silent no-op (H-O3)
      Sentry.addBreadcrumb({
        category: 'stripe.webhook',
        level: 'info',
        message: `unhandled event type: ${event.type}`,
        data: { event_id: event.id },
      })
      return
  }
}

async function handleCheckoutCompleted(
  session: Stripe.Checkout.Session,
  eventId: string,
  supabase: ReturnType<typeof createServiceClient>
): Promise<void> {
  const userId = session.metadata?.user_id ?? session.client_reference_id ?? null

  if (!userId) {
    throw new Error(
      `checkout.session.completed missing user_id (event ${eventId}, session ${session.id})`
    )
  }

  // Subscription checkout: upsert subscriptions row and bind stripe_customer_id.
  // Credit grant happens via invoice.paid — do NOT grant here (H-C4).
  if (session.mode === 'subscription') {
    const customerId =
      typeof session.customer === 'string' ? session.customer : session.customer?.id ?? null
    const subscriptionId =
      typeof session.subscription === 'string'
        ? session.subscription
        : session.subscription?.id ?? null

    if (subscriptionId && customerId) {
      // subscriptions table not yet in generated types; cast to any until pnpm supabase:types runs.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (supabase as any).from('subscriptions').upsert(
        {
          user_id: userId,
          stripe_subscription_id: subscriptionId,
          stripe_customer_id: customerId,
          status: session.payment_status ?? 'unpaid',
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'stripe_subscription_id' }
      )

      // Bind stripe_customer_id to profile if not already set (H-C4)
      await supabase
        .from('profiles')
        .update({ stripe_customer_id: customerId })
        .eq('id', userId)
        .is('stripe_customer_id', null)
    }
    return
  }

  // One-time payment checkout: grant credits from pack
  const packId = session.metadata?.pack_id ?? null

  if (!packId || !isPackId(packId)) {
    throw new Error(
      `checkout.session.completed missing pack_id (event ${eventId}, session ${session.id})`
    )
  }

  const pack = findPack(packId)
  if (!pack) {
    throw new Error(`checkout.session.completed unknown pack ${packId} (event ${eventId})`)
  }

  const result = await grantCredits(supabase, {
    userId,
    amount: pack.credits,
    source: 'stripe',
    sourceRef: eventId,
  })

  if (!result.ok) {
    throw new Error(`grant_credits failed: ${result.error}`)
  }

  trackServer(userId, EVENTS.CHECKOUT_COMPLETED, {
    credit_pack: pack.id === 'small' ? '50' : pack.id === 'medium' ? '200' : '600',
    price_usd: pack.priceCents / 100,
  })
  await flushServer()
}

async function handleSubscriptionUpsert(
  sub: Stripe.Subscription,
  supabase: ReturnType<typeof createServiceClient>
): Promise<void> {
  // subscriptions table not yet in generated types; cast to any until pnpm supabase:types runs.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any

  // Resolve user_id from existing subscriptions row or metadata
  const { data: existing } = await db
    .from('subscriptions')
    .select('user_id')
    .eq('stripe_subscription_id', sub.id)
    .maybeSingle()

  const userId = (existing as { user_id: string } | null)?.user_id ?? sub.metadata?.user_id ?? null
  if (!userId) return // Can't attribute — skip

  // Resolve plan from price_id (authoritative)
  const priceId = sub.items.data[0]?.price?.id
  const plan = priceId ? findPlanByPriceId(priceId) : null
  if (!plan) return // Unknown price — skip

  const customerId =
    typeof sub.customer === 'string' ? sub.customer : (sub.customer as Stripe.Customer | null)?.id

  // Stripe SDK v22: current_period_start/end removed from Subscription type.
  // Use billing_cycle_anchor as a proxy for period tracking; invoice.paid events
  // will provide accurate period timestamps via handleInvoicePaid.
  await db.from('subscriptions').upsert(
    {
      user_id: userId,
      plan: plan.id,
      status: sub.status as string,
      stripe_subscription_id: sub.id,
      stripe_customer_id: customerId,
      monthly_credit_allotment: plan.monthlyCredits,
      current_period_start: new Date(sub.billing_cycle_anchor * 1000).toISOString(),
      cancel_at_period_end: sub.cancel_at_period_end,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'stripe_subscription_id' }
  )
}

async function handleSubscriptionDeleted(
  sub: Stripe.Subscription,
  supabase: ReturnType<typeof createServiceClient>
): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any

  const { data: row } = await db
    .from('subscriptions')
    .select('user_id')
    .eq('stripe_subscription_id', sub.id)
    .maybeSingle()

  await db
    .from('subscriptions')
    .update({ status: 'canceled', updated_at: new Date().toISOString() })
    .eq('stripe_subscription_id', sub.id)

  const userId = (row as { user_id: string } | null)?.user_id
  if (userId) {
    await db.rpc('zero_monthly_credits', { p_user_id: userId })
  }
}

async function handleInvoicePaid(
  invoice: Stripe.Invoice,
  supabase: ReturnType<typeof createServiceClient>
): Promise<void> {
  // Stripe SDK v22: subscription reference moved to invoice.parent.subscription_details.subscription
  const parentSub = invoice.parent?.subscription_details?.subscription
  const subId =
    typeof parentSub === 'string' ? parentSub : (parentSub as Stripe.Subscription | undefined)?.id
  if (!subId) return

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any
  const { data: subRow } = await db
    .from('subscriptions')
    .select('user_id, plan, status, monthly_credit_allotment, current_period_start')
    .eq('stripe_subscription_id', subId)
    .maybeSingle()

  if (!subRow) return
  // H-S12: skip grant if subscription is canceled
  if (subRow.status === 'canceled') return

  // Resolve allotment from server-side plan map — NEVER from invoice.amount_paid (H-C6)
  // Stripe SDK v22: price is nested under lineItem.pricing.price_details.price
  const lineItem = invoice.lines?.data?.[0]
  const priceRef = lineItem?.pricing?.price_details?.price
  const priceId =
    typeof priceRef === 'string' ? priceRef : (priceRef as Stripe.Price | undefined)?.id
  const plan = priceId ? findPlanByPriceId(priceId) : null
  const allotment = plan?.monthlyCredits ?? (subRow.monthly_credit_allotment as number | null)

  // Period start from invoice line item (billing-cycle accurate)
  const periodStart = lineItem?.period?.start
    ? new Date(lineItem.period.start * 1000).toISOString()
    : ((subRow.current_period_start as string | null) ?? new Date().toISOString())

  await db.rpc('grant_monthly_credits', {
    p_user_id: subRow.user_id,
    p_subscription_id: subId,
    p_period_start: periodStart,
    p_allotment: allotment,
  })
}

async function handleInvoicePaymentFailed(
  invoice: Stripe.Invoice,
  supabase: ReturnType<typeof createServiceClient>
): Promise<void> {
  // Stripe SDK v22: subscription reference moved to invoice.parent.subscription_details.subscription
  const parentSub = invoice.parent?.subscription_details?.subscription
  const subId =
    typeof parentSub === 'string' ? parentSub : (parentSub as Stripe.Subscription | undefined)?.id
  if (!subId) return

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any
  await db
    .from('subscriptions')
    .update({ status: 'past_due', updated_at: new Date().toISOString() })
    .eq('stripe_subscription_id', subId)
}

async function handleChargeClawback(
  charge: Stripe.Charge,
  _eventType: string,
  eventId: string,
  supabase: ReturnType<typeof createServiceClient>
): Promise<void> {
  const customerId =
    typeof charge.customer === 'string'
      ? charge.customer
      : (charge.customer as Stripe.Customer | null | undefined)?.id
  if (!customerId) return

  const { data: profile } = await supabase
    .from('profiles')
    .select('id')
    .eq('stripe_customer_id', customerId)
    .maybeSingle()

  if (!profile) return

  // Stripe SDK v22: Charge.invoice no longer exists. Use payment_intent presence as a
  // heuristic — subscription invoices always go through PaymentIntent. In practice, if
  // the PaymentIntent metadata carries a subscription_id (set by Stripe automatically),
  // it's a subscription charge. Without expanding payment_intent we default to 'purchased'
  // for one-time pack charges and let the reconciliation process correct edge cases.
  // TODO: If granular bucket accuracy is required, expand charge.payment_intent and
  // check for invoice on the PaymentIntent.
  const bucket = 'purchased'

  // Use amount_refunded for partial refunds; fall back to full charge amount for disputes.
  const amountCents = charge.amount_refunded ?? charge.amount

  // Convert cents to credits — approximate: $0.024/credit baseline.
  // This is an approximation; exact allotment is bounded by actual sub plan.
  const creditsToClawback = Math.ceil(amountCents / 2.4)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (supabase as any).rpc('claw_back_credits', {
    p_user_id: profile.id,
    p_amount: creditsToClawback,
    p_bucket: bucket,
    p_source: 'stripe',
    p_source_ref: eventId,
  })
}
