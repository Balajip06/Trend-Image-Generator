import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { createServiceClient } from '@/lib/supabase/server'
import { sendPush } from '@/lib/push/send'
import { buildResultReadyEmail, sendEmail } from '@/lib/email/send'

export const runtime = 'nodejs'

const BodySchema = z.object({
  generation_id: z.string().uuid(),
})

interface GenerationRow {
  id: string
  user_id: string
  status: string
  output_image_url: string | null
  trend_id: string
}

interface ProfileRow {
  email: string | null
  push_subscription: {
    endpoint: string
    keys: { p256dh: string; auth: string }
  } | null
}

interface TrendRow {
  slug: string
  title: string
}

export async function POST(request: NextRequest) {
  const auth = request.headers.get('authorization')
  const expected = `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`
  if (!auth || auth !== expected) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
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

  const supabase = createServiceClient()

  const { data: genData } = await supabase
    .from('generations')
    .select('id, user_id, status, output_image_url, trend_id')
    .eq('id', body.generation_id)
    .maybeSingle()
  const gen = genData as unknown as GenerationRow | null
  if (!gen) return NextResponse.json({ error: 'generation not found' }, { status: 404 })
  if (gen.status !== 'completed') {
    return NextResponse.json({ skipped: true, reason: 'not completed' })
  }

  const { data: profileData } = await supabase
    .from('profiles')
    .select('email, push_subscription')
    .eq('id', gen.user_id)
    .maybeSingle()
  const profile = profileData as unknown as ProfileRow | null

  const { data: trendData } = await supabase
    .from('trends')
    .select('slug, title')
    .eq('id', gen.trend_id)
    .maybeSingle()
  const trend = (trendData as unknown as TrendRow | null) ?? { slug: 'unknown', title: 'Trend' }

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'
  const resultUrl = `${siteUrl}/result/${gen.id}`

  if (profile?.push_subscription) {
    const result = await sendPush(profile.push_subscription, {
      title: `Your ${trend.title} is ready`,
      body: 'Tap to view + download.',
      url: resultUrl,
      tag: `gen-${gen.id}`,
    })

    if (result.expired) {
      // 404/410 → clear stale subscription so future runs fall through to email.
      const clear = { push_subscription: null } as never
      await supabase.from('profiles').update(clear).eq('id', gen.user_id)
    } else if (result.ok) {
      return NextResponse.json({ delivered: 'push' })
    }
  }

  // Email fallback (push absent OR push send failed terminally).
  if (profile?.email) {
    const tpl = buildResultReadyEmail({ trendTitle: trend.title, resultUrl })
    const sent = await sendEmail({
      to: profile.email,
      subject: tpl.subject,
      html: tpl.html,
      text: tpl.text,
    })
    if (sent.ok) return NextResponse.json({ delivered: 'email' })
    return NextResponse.json({ delivered: 'none', error: sent.error })
  }

  return NextResponse.json({ delivered: 'none', reason: 'no contact channel' })
}
