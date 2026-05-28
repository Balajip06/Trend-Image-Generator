import { cookies } from 'next/headers'
import { NextResponse, type NextRequest } from 'next/server'
import { EVENTS, flushServer, identifyServer, trackServer } from '@/lib/analytics/server'
import {
  parseReferralFromCookie,
  REFERRAL_COOKIE_NAME,
} from '@/lib/referrals/links'
import { createClient } from '@/lib/supabase/server'

const NEW_USER_WINDOW_MS = 60_000

interface ProfileBrief {
  created_at: string
  referred_by: string | null
}

interface ReferrerLookup {
  id: string
}

/**
 * Restricts `next` to a same-origin path. Attacker-controlled `next` values
 * like `//evil.com/path` or `https://evil.com/path` would otherwise resolve
 * to an off-site URL via `new URL(next, request.url)` and turn the callback
 * into an open redirect — a phishing pivot (steal a freshly-issued session).
 */
function safeNextPath(raw: string | null): string {
  if (!raw) return '/'
  // Must start with a single slash and not contain a protocol-relative prefix.
  if (!raw.startsWith('/') || raw.startsWith('//')) return '/'
  // Reject backslashes (some browsers treat as `/`) and `@` (userinfo escape).
  if (raw.includes('\\') || raw.includes('@')) return '/'
  return raw
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url)
  const code = url.searchParams.get('code')
  const next = safeNextPath(url.searchParams.get('next'))

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

  let referredBy: string | null = null
  let consumedReferralCookie = false

  if (user) {
    identifyServer(user.id, { email: user.email ?? undefined })

    const { data: profileRow } = await supabase
      .from('profiles')
      .select('created_at, referred_by')
      .eq('id', user.id)
      .maybeSingle()
    const profile = (profileRow as unknown as ProfileBrief | null) ?? null
    referredBy = profile?.referred_by ?? null

    const isNewUser =
      profile !== null &&
      Date.now() - new Date(profile.created_at).getTime() < NEW_USER_WINDOW_MS

    // Consume the tig_ref cookie set by middleware. Only attribute on first
    // signup (isNewUser) and when no referrer is recorded yet — avoids the
    // rare case where a user re-clicks a ref link mid-session and rewrites
    // their own attribution.
    if (isNewUser && !referredBy) {
      const cookieStore = await cookies()
      const refCode = parseReferralFromCookie(cookieStore.get(REFERRAL_COOKIE_NAME)?.value)
      if (refCode) {
        const { data: referrerRow } = await supabase
          .from('profiles')
          .select('id')
          .eq('referral_code', refCode)
          .maybeSingle()
        const referrer = (referrerRow as unknown as ReferrerLookup | null) ?? null

        if (referrer && referrer.id !== user.id) {
          // Cast required until `pnpm supabase:types` regenerates strict Database types.
          const update = { referred_by: referrer.id } as never
          const { error: updateErr } = await supabase
            .from('profiles')
            .update(update)
            .eq('id', user.id)
          if (!updateErr) {
            const insertRow = {
              referrer_id: referrer.id,
              referred_id: user.id,
              status: 'pending',
            } as never
            await supabase.from('referrals').insert(insertRow)
            referredBy = referrer.id
          }
        }
        consumedReferralCookie = true
      }
    }

    if (isNewUser) {
      const provider = (user.app_metadata?.provider as string | undefined) ?? 'magic_link'
      const method: 'google' | 'magic_link' = provider === 'google' ? 'google' : 'magic_link'
      trackServer(user.id, EVENTS.SIGNUP_COMPLETED, {
        method,
        referred: referredBy !== null,
      })
    }

    await flushServer()
  }

  const response = NextResponse.redirect(new URL(next, request.url))
  if (consumedReferralCookie) {
    response.cookies.delete(REFERRAL_COOKIE_NAME)
  }
  return response
}
