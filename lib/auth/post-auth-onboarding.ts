import * as Sentry from '@sentry/nextjs'
import { cookies } from 'next/headers'
import type { NextRequest } from 'next/server'
import type { User, SupabaseClient } from '@supabase/supabase-js'
import { EVENTS, flushServer, identifyServer, trackServer } from '@/lib/analytics/server'
import { parseReferralFromCookie, REFERRAL_COOKIE_NAME } from '@/lib/referrals/links'
import { createServiceClient } from '@/lib/supabase/server'
import type { Database } from '@/lib/supabase/database.types'

/**
 * Auto-grant admin or premium access based on ADMIN_EMAILS / PREMIUM_EMAILS env vars.
 * Only runs for Google-authenticated users — Google OAuth verifies email ownership,
 * preventing squatters from claiming a privileged email via email/password signup.
 * Best-effort: failures are breadcrumbed and never block the redirect.
 */
async function autoGrantPrivilegedAccess(user: User, sentryCategory: string): Promise<void> {
  const provider = (user.app_metadata?.provider as string | undefined) ?? ''
  if (provider !== 'google') return // only grant via verified Google OAuth

  const email = user.email?.toLowerCase()
  if (!email) return

  const adminEmails = (process.env.ADMIN_EMAILS ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
  const premiumEmails = (process.env.PREMIUM_EMAILS ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)

  const isAdmin = adminEmails.includes(email)
  const isPremium = premiumEmails.includes(email)
  if (!isAdmin && !isPremium) return

  try {
    const service = createServiceClient()

    // Grant admin access
    if (isAdmin) {
      const { data: existing } = await service
        .from('admin_users')
        .select('user_id')
        .eq('user_id', user.id)
        .maybeSingle()

      if (!existing) {
        await service.from('admin_users').insert({ user_id: user.id, role: 'admin' })
      }
    }

    // Grant premium (unlimited) access
    if (isPremium) {
      const { data: profile } = await service
        .from('profiles')
        .select('kimp_unlimited')
        .eq('id', user.id)
        .maybeSingle()

      if (profile && !profile.kimp_unlimited) {
        // Ensure allowlist row exists (satisfies enforce_kimp_unlimited_proof trigger)
        const { data: allowlistRow } = await service
          .from('kimp_client_allowlist')
          .select('id, is_active')
          .eq('email', email)
          .maybeSingle()

        if (!allowlistRow) {
          await service.from('kimp_client_allowlist').insert({
            email,
            is_active: true,
            note: 'Auto-granted via PREMIUM_EMAILS env var on Google login',
          })
        } else if (!allowlistRow.is_active) {
          await service
            .from('kimp_client_allowlist')
            .update({ is_active: true })
            .eq('id', allowlistRow.id)
        }

        // Grant unlimited — proof trigger checks allowlist row
        await service
          .from('profiles')
          .update({
            kimp_unlimited: true,
            kimp_client_status: 'active',
            kimp_verified_at: new Date().toISOString(),
          })
          .eq('id', user.id)
      }
    }
  } catch (err: unknown) {
    Sentry.addBreadcrumb({
      category: sentryCategory,
      level: 'warning',
      message: 'autoGrantPrivilegedAccess failed',
      data: { user_id: user.id, error: err instanceof Error ? err.message : String(err) },
    })
  }
}

// Window during which a profile is considered "newly created" — gate for
// first-time-only stamping (acquisition_source, referrals, signup tracking).
// Generous 60s because the auth callback runs immediately after the
// `handle_new_user` Postgres trigger creates the profile.
const NEW_USER_WINDOW_MS = 60_000

// UTM values are user-controllable in the URL — cap them aggressively to
// keep a malicious link from stuffing megabytes into the jsonb blob.
function capStr(s: string | null, n = 200): string | null {
  if (s === null) return null
  return s.length > n ? s.slice(0, n) : s
}

interface OnboardingArgs {
  supabase: SupabaseClient<Database>
  request: NextRequest
  user: User
  /**
   * Tells Sentry breadcrumbs + the SIGNUP_COMPLETED `method` field which
   * auth surface ran the onboarding. `'magic_link'` for /auth/confirm,
   * derived from `user.app_metadata.provider` for /auth/callback.
   */
  authMethod?: 'magic_link' | 'google'
  /**
   * Distinguishes Sentry breadcrumb category for the two callers so
   * "acquisition_source stamp failed" rows can be filtered per surface.
   */
  sentryCategory: string
}

interface OnboardingResult {
  /**
   * True iff the referral cookie was read + applied. Caller should
   * `response.cookies.delete(REFERRAL_COOKIE_NAME)` on the redirect
   * response to prevent re-attribution on subsequent loads.
   */
  consumedReferralCookie: boolean
}

/**
 * Runs the post-verification onboarding shared by `/auth/callback`
 * (OAuth code exchange) and `/auth/confirm` (magic-link token-hash).
 *
 * Behavior:
 * - Identifies the user in PostHog
 * - Reads the profile row (acquisition_source, created_at, referred_by, tos_accepted_at)
 * - Stamps `tos_accepted_at` if NULL
 * - For first-time users only (profile created in last NEW_USER_WINDOW_MS):
 *   - Stamps `acquisition_source` from URL UTM params
 *   - Consumes the `tig_ref` cookie, sets `referred_by`, inserts `referrals` row
 *   - Tracks SIGNUP_COMPLETED with `method` + `referred` flags
 * - Flushes the analytics buffer
 *
 * Failures inside acquisition_source stamping are caught + breadcrumbed —
 * onboarding is best-effort and must never block the redirect to `next`.
 */
export async function runPostAuthOnboarding({
  supabase,
  request,
  user,
  authMethod,
  sentryCategory,
}: OnboardingArgs): Promise<OnboardingResult> {
  identifyServer(user.id, { email: user.email ?? undefined })

  const { data: profileRow } = await supabase
    .from('profiles')
    .select('acquisition_source, created_at, referred_by, tos_accepted_at')
    .eq('id', user.id)
    .maybeSingle()
  const profile = profileRow ?? null
  let referredBy: string | null = profile?.referred_by ?? null
  let consumedReferralCookie = false

  const isNewUser =
    profile !== null && Date.now() - new Date(profile.created_at).getTime() < NEW_USER_WINDOW_MS

  // Stamp ToS acceptance on first arrival. The login server actions reject
  // any sign-in attempt where the checkbox wasn't ticked, so reaching this
  // helper is sufficient evidence of consent. The column is nullable +
  // RLS-protected against being cleared once set.
  if (profile && profile.tos_accepted_at === null) {
    await supabase
      .from('profiles')
      .update({ tos_accepted_at: new Date().toISOString() })
      .eq('id', user.id)
  }

  // Auto-grant admin / premium access for Google-verified privileged emails
  await autoGrantPrivilegedAccess(user, sentryCategory)

  // Stamp acquisition_source on first signup only (and only if not yet
  // recorded). UTM params live on the callback URL because the login
  // redirect carries them through Supabase's OAuth/magic-link bounce.
  // A failure here must not block the redirect — log a breadcrumb and
  // continue.
  if (isNewUser && profile && profile.acquisition_source === null) {
    try {
      const url = new URL(request.url)
      const acquisitionSource = {
        utm_source: capStr(url.searchParams.get('utm_source')),
        utm_medium: capStr(url.searchParams.get('utm_medium')),
        utm_campaign: capStr(url.searchParams.get('utm_campaign')),
        utm_content: capStr(url.searchParams.get('utm_content')),
        utm_term: capStr(url.searchParams.get('utm_term')),
        referrer: capStr(request.headers.get('referer')),
        landed_at: new Date().toISOString(),
      }
      await supabase
        .from('profiles')
        .update({ acquisition_source: acquisitionSource })
        .eq('id', user.id)
    } catch (err: unknown) {
      Sentry.addBreadcrumb({
        category: sentryCategory,
        level: 'warning',
        message: 'acquisition_source stamp failed',
        data: { user_id: user.id, error: err instanceof Error ? err.message : String(err) },
      })
    }
  }

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
      const referrer = referrerRow ?? null

      if (referrer && referrer.id !== user.id) {
        const update = { referred_by: referrer.id }
        const { error: updateErr } = await supabase
          .from('profiles')
          .update(update)
          .eq('id', user.id)
        if (!updateErr) {
          const insertRow = {
            referrer_id: referrer.id,
            referred_id: user.id,
            status: 'pending' as const,
          }
          await supabase.from('referrals').insert(insertRow)
          referredBy = referrer.id
        }
      }
      consumedReferralCookie = true
    }
  }

  if (isNewUser) {
    const provider = (user.app_metadata?.provider as string | undefined) ?? 'magic_link'
    const method: 'google' | 'magic_link' =
      authMethod ?? (provider === 'google' ? 'google' : 'magic_link')
    trackServer(user.id, EVENTS.SIGNUP_COMPLETED, {
      method,
      referred: referredBy !== null,
    })
  }

  await flushServer()

  return { consumedReferralCookie }
}
