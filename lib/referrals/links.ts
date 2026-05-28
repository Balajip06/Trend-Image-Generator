/**
 * Referral URL helpers.
 *
 * Server side (DB):
 *   - profiles.referral_code (auto-generated 12-hex on insert)
 *   - profiles.referred_by   (FK populated on signup if `?ref=` cookie present)
 *   - referrals row created  (by app code on signup; status='pending')
 *   - bonus credited         (by trigger after referee's first completed generation,
 *                              capped at profiles.bonus_credits_earned <= 50)
 *
 * This module owns the *link* side: building share URLs from a referrer's code
 * and parsing `?ref=<code>` from incoming request URLs.
 */

const PARAM = 'ref'
const CODE_RE = /^[a-f0-9]{12}$/i

export function buildReferralUrl(siteUrl: string, referralCode: string, path = '/'): string {
  if (!CODE_RE.test(referralCode)) {
    throw new Error('Invalid referral code shape — expected 12 hex chars')
  }
  const u = new URL(path, siteUrl)
  u.searchParams.set(PARAM, referralCode)
  return u.toString()
}

export function parseReferralFromUrl(rawUrl: string): string | null {
  try {
    const u = new URL(rawUrl)
    const ref = u.searchParams.get(PARAM)
    if (!ref) return null
    return CODE_RE.test(ref) ? ref.toLowerCase() : null
  } catch {
    return null
  }
}

/**
 * Decode pending referral code from a cookie value (set on landing, read on signup).
 * Returns null if malformed.
 */
export function parseReferralFromCookie(value: string | undefined | null): string | null {
  if (!value) return null
  return CODE_RE.test(value) ? value.toLowerCase() : null
}

export const REFERRAL_COOKIE_NAME = 'tig_ref'
/** 30 days — matches the typical "first generation completes within X days of signup" assumption. */
export const REFERRAL_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30
