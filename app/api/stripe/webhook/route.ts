import { NextResponse, type NextRequest } from 'next/server'
import Stripe from 'stripe'
import { EVENTS, flushServer, trackServer } from '@/lib/analytics/server'
import { createServiceClient } from '@/lib/supabase/server'
import { grantCredits } from '@/lib/payments/credits'
import { findPack, isPackId } from '@/lib/payments/packs'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function getStripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY
  if (!key) throw new Error('STRIPE_SECRET_KEY missing')
  return new Stripe(key)
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
  // Cast required until `pnpm supabase:types` regenerates strict Database types.
  const webhookRow = {
    source: 'stripe',
    event_id: event.id,
    payload: event as unknown as Record<string, unknown>,
  } as never

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
    return NextResponse.json({ error: message }, { status: 500 })
  }

  // Mark processed
  const processedUpdate = { processed_at: new Date().toISOString() } as never
  await supabase
    .from('webhook_events')
    .update(processedUpdate)
    .eq('source', 'stripe')
    .eq('event_id', event.id)

  return NextResponse.json({ received: true })
}

async function handleEvent(
  event: Stripe.Event,
  supabase: ReturnType<typeof createServiceClient>
): Promise<void> {
  switch (event.type) {
    case 'checkout.session.completed':
      await handleCheckoutCompleted(event.data.object as Stripe.Checkout.Session, event.id, supabase)
      return
    // Other event types (charge.refunded, etc.) wired post-MVP.
    default:
      // No-op for unhandled types; row still recorded in webhook_events for auditing.
      return
  }
}

async function handleCheckoutCompleted(
  session: Stripe.Checkout.Session,
  eventId: string,
  supabase: ReturnType<typeof createServiceClient>
): Promise<void> {
  const userId = session.metadata?.user_id ?? session.client_reference_id ?? null
  const packId = session.metadata?.pack_id ?? null

  if (!userId || !packId || !isPackId(packId)) {
    throw new Error(
      `checkout.session.completed missing user_id or pack_id (event ${eventId}, session ${session.id})`
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
