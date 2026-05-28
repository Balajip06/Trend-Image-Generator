import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'

const SubscriptionSchema = z.object({
  endpoint: z.string().url(),
  expirationTime: z.number().nullable().optional(),
  keys: z.object({
    p256dh: z.string().min(1),
    auth: z.string().min(1),
  }),
})

const BodySchema = z.object({
  subscription: SubscriptionSchema.nullable(),
})

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

  // Cast required until `pnpm supabase:types` regenerates strict Database types.
  const update = { push_subscription: body.subscription } as never
  const { error } = await supabase.from('profiles').update(update).eq('id', user.id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}
