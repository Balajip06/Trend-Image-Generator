import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { applyWatermark } from '@/lib/watermark/compose'

export const runtime = 'nodejs'

interface GenerationRow {
  id: string
  user_id: string
  output_image_url: string | null
  status: string
}

interface ProfileRow {
  credits_balance: number
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const { data: genRow } = await supabase
    .from('generations')
    .select('id, user_id, output_image_url, status')
    .eq('id', id)
    .maybeSingle()
  const gen = genRow as unknown as GenerationRow | null

  if (!gen) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (gen.user_id !== user.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  if (gen.status !== 'completed' || !gen.output_image_url) {
    return NextResponse.json({ error: 'Generation not ready' }, { status: 409 })
  }

  const { data: profileRow } = await supabase
    .from('profiles')
    .select('credits_balance')
    .eq('id', user.id)
    .maybeSingle()
  const profile = (profileRow as unknown as ProfileRow | null) ?? { credits_balance: 0 }
  const isPro = profile.credits_balance > 0

  const upstream = await fetch(gen.output_image_url)
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
