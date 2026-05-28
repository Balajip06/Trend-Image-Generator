import { NextResponse, type NextRequest } from 'next/server'
import { EVENTS, flushServer, identifyServer, trackServer } from '@/lib/analytics/server'
import { createClient } from '@/lib/supabase/server'

const NEW_USER_WINDOW_MS = 60_000

interface ProfileBrief {
  created_at: string
  referred_by: string | null
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url)
  const code = url.searchParams.get('code')
  const next = url.searchParams.get('next') ?? '/'

  if (!code) {
    return NextResponse.redirect(new URL('/login?error=missing_code', request.url))
  }

  const supabase = await createClient()
  const { error } = await supabase.auth.exchangeCodeForSession(code)
  if (error) {
    return NextResponse.redirect(new URL('/login?error=exchange_failed', request.url))
  }

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (user) {
    identifyServer(user.id, { email: user.email ?? undefined })

    const { data: profileRow } = await supabase
      .from('profiles')
      .select('created_at, referred_by')
      .eq('id', user.id)
      .maybeSingle()
    const profile = (profileRow as unknown as ProfileBrief | null) ?? null

    if (profile && Date.now() - new Date(profile.created_at).getTime() < NEW_USER_WINDOW_MS) {
      const provider = (user.app_metadata?.provider as string | undefined) ?? 'magic_link'
      const method: 'google' | 'magic_link' = provider === 'google' ? 'google' : 'magic_link'
      trackServer(user.id, EVENTS.SIGNUP_COMPLETED, {
        method,
        referred: profile.referred_by !== null,
      })
    }

    await flushServer()
  }

  return NextResponse.redirect(new URL(next, request.url))
}
