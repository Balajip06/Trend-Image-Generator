import { NextResponse } from 'next/server'
import { z } from 'zod'
import { recordEvent } from '@/lib/analytics/event-store'

const BodySchema = z.object({
  trend_slug: z.string().min(1),
  type: z.enum(['impression', 'click_generate']),
})

export const dynamic = 'force-dynamic'

export async function POST(req: Request): Promise<NextResponse> {
  let parsed
  try {
    parsed = BodySchema.parse(await req.json())
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid_body' }, { status: 400 })
  }
  recordEvent(parsed.trend_slug, parsed.type)
  return NextResponse.json({ ok: true })
}
