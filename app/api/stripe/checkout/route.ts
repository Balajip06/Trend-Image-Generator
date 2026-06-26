import { NextResponse, type NextRequest } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import Stripe from 'stripe'
import { z } from 'zod'
import { EVENTS, flushServer, trackServer } from '@/lib/analytics/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { findPack, isPackId, requirePackPriceId } from '@/lib/payments/packs'
import { findPlan, isPlanId, requirePlanPriceId } from '@/lib/payments/plans'

export const runtime = 'nodejs'

const BodySchema = z.union([
  z.object({ pack_id: z.string().refine(isPackId, 'unknown pack_id') }),
  z.object({ plan_id: z.string().refine(isPlanId, 'unknown plan_id') }),
])

function getStripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY
  if (!key) throw new Error('STRIPE_SECRET_KEY missing')
  return new Stripe(key)
}

/** Billing is live only once the Stripe secret is configured. */
function isBillingConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY)
}

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  // Billing not wired yet (no Stripe keys) — fail clean, never crash with a
  // leaky internal message. The UI renders a "billing coming soon" state.
  if (!isBillingConfigured()) {
    return NextResponse.json(
      { error: 'Billing is not available yet. Please check back soon.', code: 'billing_unconfigured' },
      { status: 503 }
    )
  }

  let body: z.infer<typeof BodySchema>
  try {
    body = BodySchema.parse(await request.json())
  } catch (err: unknown) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'invalid body' },
      { status: 400 }
    )
  }

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'

  // ── Subscription path ──────────────────────────────────────────────────────
  if ('plan_id' in body) {
    const plan = findPlan(body.plan_id)
    if (!plan) return NextResponse.json({ error: 'Unknown plan' }, { status: 400 })

    try {
      const stripe = getStripe()

      // Ensure the user has a Stripe customer record; create one if absent.
      // We read via the session-scoped client, but write via service-role so
      // the partial unique index on stripe_customer_id guards against races.
      const { data: profile } = await supabase
        .from('profiles')
        .select('stripe_customer_id')
        .eq('id', user.id)
        .maybeSingle()

      let customerId = profile?.stripe_customer_id ?? null

      if (!customerId) {
        const customer = await stripe.customers.create({
          email: user.email ?? undefined,
          metadata: { user_id: user.id },
        })
        customerId = customer.id

        const service = createServiceClient()
        await service
          .from('profiles')
          .update({ stripe_customer_id: customerId })
          .eq('id', user.id)
      }

      const session = await stripe.checkout.sessions.create({
        mode: 'subscription',
        customer: customerId,
        payment_method_types: ['card'],
        line_items: [{ price: requirePlanPriceId(plan), quantity: 1 }],
        subscription_data: {
          metadata: { user_id: user.id, plan_id: plan.id },
        },
        success_url: `${siteUrl}/me/settings?subscription=success`,
        cancel_url: `${siteUrl}/me/settings?subscription=cancelled`,
      })

      return NextResponse.json({ checkout_url: session.url })
    } catch (err: unknown) {
      Sentry.captureException(err)
      const message = err instanceof Error ? err.message : 'stripe error'
      return NextResponse.json({ error: message }, { status: 500 })
    }
  }

  // ── One-time pack path ─────────────────────────────────────────────────────
  const pack = findPack(body.pack_id)
  if (!pack) return NextResponse.json({ error: 'Unknown pack' }, { status: 400 })

  // First-purchase 20%-off coupon. Claim atomically via a service-role
  // UPDATE that sets `first_purchase_discount_used_at = now()` only if it
  // is currently NULL. Postgres serializes the row update, so two
  // concurrent checkout requests (browser double-click, retry) cannot
  // both claim the slot — only the first UPDATE returns a row; the second
  // sees zero rows and falls through to a full-price session.
  //
  // Rollback: if Stripe `sessions.create` later throws, we clear the
  // stamp so the user keeps eligibility. If the process crashes between
  // the claim and Stripe success, the coupon is forfeit — accepted
  // trade-off vs. the alternative of stamping in the webhook (which
  // allowed unbounded discounted sessions in flight before any webhook
  // arrived, per red-team M4).
  const firstPurchaseCouponId = process.env.STRIPE_FIRST_PURCHASE_COUPON_ID
  let applyFirstPurchaseCoupon = false
  if (firstPurchaseCouponId) {
    const service = createServiceClient()
    const claimedAt = new Date().toISOString()
    const { data: claimed } = await service
      .from('profiles')
      .update({ first_purchase_discount_used_at: claimedAt })
      .eq('id', user.id)
      .is('first_purchase_discount_used_at', null)
      .select('id')
      .maybeSingle()
    if (claimed) applyFirstPurchaseCoupon = true
  }

  let session: Stripe.Checkout.Session
  try {
    const stripe = getStripe()
    session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      line_items: [{ price: requirePackPriceId(pack), quantity: 1 }],
      success_url: `${siteUrl}/me/creations?purchase=success&pack=${pack.id}`,
      cancel_url: `${siteUrl}/me/settings?purchase=cancelled`,
      client_reference_id: user.id,
      customer_email: user.email ?? undefined,
      ...(applyFirstPurchaseCoupon && firstPurchaseCouponId
        ? { discounts: [{ coupon: firstPurchaseCouponId }] }
        : {}),
      // Webhook handler uses metadata to grant credits idempotently
      // by joining to webhook_events.event_id; pack_id stays portable
      // across test/staging/prod (price_id changes per env).
      metadata: {
        user_id: user.id,
        pack_id: pack.id,
        credits: String(pack.credits),
      },
    })
  } catch (err: unknown) {
    if (applyFirstPurchaseCoupon) {
      const service = createServiceClient()
      await service
        .from('profiles')
        .update({ first_purchase_discount_used_at: null })
        .eq('id', user.id)
    }
    Sentry.captureException(err)
    const message = err instanceof Error ? err.message : 'stripe error'
    return NextResponse.json({ error: message }, { status: 500 })
  }

  if (!session.url) {
    if (applyFirstPurchaseCoupon) {
      const service = createServiceClient()
      await service
        .from('profiles')
        .update({ first_purchase_discount_used_at: null })
        .eq('id', user.id)
    }
    return NextResponse.json({ error: 'Stripe returned no checkout url' }, { status: 502 })
  }

  trackServer(user.id, EVENTS.CHECKOUT_STARTED, {
    credit_pack: pack.id === 'small' ? '50' : pack.id === 'medium' ? '200' : '600',
    price_usd: pack.priceCents / 100,
  })
  await flushServer()

  return NextResponse.json({ checkout_url: session.url, session_id: session.id })
}
