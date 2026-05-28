import { NextResponse, type NextRequest } from 'next/server'
import Stripe from 'stripe'
import { z } from 'zod'
import { EVENTS, flushServer, trackServer } from '@/lib/analytics/server'
import { createClient } from '@/lib/supabase/server'
import { findPack, isPackId, requirePackPriceId } from '@/lib/payments/packs'

export const runtime = 'nodejs'

const BodySchema = z.object({
  pack_id: z.string().refine(isPackId, 'unknown pack_id'),
})

function getStripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY
  if (!key) throw new Error('STRIPE_SECRET_KEY missing')
  return new Stripe(key)
}

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  let body: z.infer<typeof BodySchema>
  try {
    body = BodySchema.parse(await request.json())
  } catch (err: unknown) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'invalid body' },
      { status: 400 }
    )
  }

  const pack = findPack(body.pack_id)
  if (!pack) return NextResponse.json({ error: 'Unknown pack' }, { status: 400 })

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'

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
    const message = err instanceof Error ? err.message : 'stripe error'
    return NextResponse.json({ error: message }, { status: 500 })
  }

  if (!session.url) {
    return NextResponse.json({ error: 'Stripe returned no checkout url' }, { status: 502 })
  }

  trackServer(user.id, EVENTS.CHECKOUT_STARTED, {
    credit_pack: pack.id === 'small' ? '50' : pack.id === 'medium' ? '200' : '600',
    price_usd: pack.priceCents / 100,
  })
  await flushServer()

  return NextResponse.json({ checkout_url: session.url, session_id: session.id })
}
