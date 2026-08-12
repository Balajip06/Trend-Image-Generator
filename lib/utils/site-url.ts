const FALLBACK_SITE_URL = 'http://localhost:3000'

/**
 * Canonical site origin, with any trailing slash stripped.
 *
 * `NEXT_PUBLIC_SITE_URL` is operator-configured, so it may or may not carry a
 * trailing slash. Call sites universally build `${siteUrl}/some/path`, and a
 * trailing slash there silently yields `https://host//some/path`. `new URL()`
 * does NOT collapse that double slash, so it reaches the wire — which breaks
 * exact-match allowlists (Supabase Redirect URLs, Stripe return URLs, OAuth
 * redirect_uri) and splits canonical/OG URLs into duplicates for crawlers.
 */
export function siteOrigin(): string {
  const raw = process.env.NEXT_PUBLIC_SITE_URL ?? FALLBACK_SITE_URL
  return raw.replace(/\/+$/, '')
}

/**
 * Absolute URL for a site-relative path. Accepts the path with or without a
 * leading slash; always emits exactly one separating slash.
 */
export function siteUrl(path = '/'): string {
  const origin = siteOrigin()
  if (!path || path === '/') return `${origin}/`
  return `${origin}/${path.replace(/^\/+/, '')}`
}
