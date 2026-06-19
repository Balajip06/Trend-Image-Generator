import { NextResponse, type NextRequest } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  // Verify admin session
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'unauthenticated' }, { status: 401 })

  const service = createServiceClient()
  const { data: adminRow } = await service
    .from('admin_users')
    .select('user_id')
    .eq('user_id', user.id)
    .maybeSingle()
  if (!adminRow) return NextResponse.json({ error: 'forbidden' }, { status: 403 })

  const url = new URL(request.url)
  const since = url.searchParams.get('since')

  // Return rows newer than the cursor (covers the RSC/subscribe gap)
  let query = service
    .from('admin_generations_feed')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(50)

  if (since) {
    query = query.gt('created_at', since)
  }

  const { data } = await query
  return NextResponse.json({ rows: data ?? [] })
}
