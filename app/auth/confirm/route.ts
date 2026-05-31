/**
 * Email token-hash verification endpoint (signup confirmation + recovery).
 *
 * Handles two traffic sources:
 *  - signUp confirmation: Supabase sends type=signup after email+password signup.
 *  - Recovery: type=recovery for password reset emails.
 *
 * Cross-device safe — no `code_verifier` cookie required because the token
 * hash is consumed by `verifyOtp()` server-side.
 *
 * On success, runs new-user onboarding (TOS stamp, acquisition_source,
 * referral cookie consumption, SIGNUP_COMPLETED tracking) via `runPostAuthOnboarding`.
 */

import { NextResponse, type NextRequest } from 'next/server'
import { runPostAuthOnboarding } from '@/lib/auth/post-auth-onboarding'
import { safeNextPath } from '@/lib/auth/safe-next-path'
import { REFERRAL_COOKIE_NAME } from '@/lib/referrals/links'
import { createClient } from '@/lib/supabase/server'

type EmailOtpType = 'signup' | 'magiclink' | 'recovery' | 'invite' | 'email_change' | 'email'

const VALID_TYPES = new Set<EmailOtpType>([
  'signup',
  'magiclink',
  'recovery',
  'invite',
  'email_change',
  'email',
])

export async function GET(request: NextRequest) {
  const url = new URL(request.url)
  const tokenHash = url.searchParams.get('token_hash')
  const typeRaw = url.searchParams.get('type')
  const next = safeNextPath(url.searchParams.get('next'))

  if (!tokenHash || !typeRaw) {
    return NextResponse.redirect(new URL('/login?error=missing_code', request.url))
  }

  if (!VALID_TYPES.has(typeRaw as EmailOtpType)) {
    return NextResponse.redirect(new URL('/login?error=missing_code', request.url))
  }

  const supabase = await createClient()
  const { error } = await supabase.auth.verifyOtp({
    token_hash: tokenHash,
    type: typeRaw as EmailOtpType,
  })

  if (error) {
    return NextResponse.redirect(new URL('/login?error=exchange_failed', request.url))
  }

  const {
    data: { user },
  } = await supabase.auth.getUser()

  let consumedReferralCookie = false
  if (user) {
    const onboardingResult = await runPostAuthOnboarding({
      supabase,
      request,
      user,
      authMethod: 'magic_link',
      sentryCategory: 'auth.confirm',
    })
    consumedReferralCookie = onboardingResult.consumedReferralCookie
  }

  const response = NextResponse.redirect(new URL(next, request.url))
  if (consumedReferralCookie) {
    response.cookies.delete(REFERRAL_COOKIE_NAME)
  }
  return response
}
