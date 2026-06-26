import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { applyWatermark } from '@/lib/watermark/compose'

export const runtime = 'nodejs'

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const { data: genRow } = await supabase
    .from('generations')
    .select('id, user_id, output_image_url, status, tier_at_generation')
    .eq('id', id)
    .maybeSingle()
  const gen = genRow

  if (!gen) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (gen.user_id !== user.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  if (gen.status !== 'completed' || !gen.output_image_url) {
    return NextResponse.json({ error: 'Generation not ready' }, { status: 409 })
  }

  // Tier is snapshotted on the generation row at INSERT time by the quota
  // trigger. We never re-derive Pro-ness from live `profile.credits_balance`
  // — that read is non-transactional and would re-watermark paid downloads
  // once the user spent the credit (red-team C2).
  const isPro =
    gen.tier_at_generation === 'credit' ||
    gen.tier_at_generation === 'vip' ||
    gen.tier_at_generation === 'monthly' ||
    gen.tier_at_generation === 'kimp'

  // SSRF guard (red-team H3): `output_image_url` is read from the DB and
  // proxied via fetch(). Restrict the upstream host to the project's
  // Supabase storage origin so a future write-amplification bug in the
  // Edge Function cannot turn this route into an attacker-controlled
  // server-side fetcher.
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!supabaseUrl) {
    return NextResponse.json({ error: 'misconfigured' }, { status: 500 })
  }
  let upstreamUrl: URL
  try {
    upstreamUrl = new URL(gen.output_image_url)
  } catch {
    return NextResponse.json({ error: 'invalid upstream' }, { status: 502 })
  }
  if (upstreamUrl.host !== new URL(supabaseUrl).host) {
    return NextResponse.json({ error: 'forbidden upstream' }, { status: 403 })
  }

  const upstream = await fetch(upstreamUrl)
  if (!upstream.ok) {
    return NextResponse.json({ error: 'Image fetch failed' }, { status: 502 })
  }
  const raw = Buffer.from(await upstream.arrayBuffer())

  const out = isPro ? raw : await applyWatermark(raw)

  return new NextResponse(new Uint8Array(out), {
    status: 200,
    headers: {
      'content-type': 'image/png',
      'content-disposition': `attachment; filename="trend-${id}.png"`,
      'cache-control': 'private, max-age=0, no-store',
    },
  })
}
