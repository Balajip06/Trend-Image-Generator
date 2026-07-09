import { NextResponse, type NextRequest } from 'next/server'
import { isEmailAllowedToLogin } from '@/lib/auth/login-allowlist'
import { safeNextPath } from '@/lib/auth/safe-next-path'
import { runPostAuthOnboarding } from '@/lib/auth/post-auth-onboarding'
import { REFERRAL_COOKIE_NAME } from '@/lib/referrals/links'
import { createClient } from '@/lib/supabase/server'

/**
 * OAuth code-exchange callback. Used by Google OAuth + any PKCE-based magic
 * link clicked in the same browser that submitted /login.
 *
 * For cross-device magic-link clicks (which arrive via the Supabase email
 * template pointing at `/auth/confirm?token_hash=...`), see that route.
 */
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

  if (user?.email && !isEmailAllowedToLogin(user.email)) {
    await supabase.auth.signOut()
    return NextResponse.redirect(new URL('/login?error=invalid_credentials', request.url))
  }

  let consumedReferralCookie = false
  if (user) {
    const onboardingResult = await runPostAuthOnboarding({
      supabase,
      request,
      user,
      sentryCategory: 'auth.callback',
    })
    consumedReferralCookie = onboardingResult.consumedReferralCookie
  }

  const response = NextResponse.redirect(new URL(next, request.url))
  if (consumedReferralCookie) {
    response.cookies.delete(REFERRAL_COOKIE_NAME)
  }
  return response
}
