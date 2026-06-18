/**
 * SSRF guard for user-supplied image URLs (H-S3 / Risk #11).
 *
 * User-supplied image URLs flow from /api/generate → generations.input_payload
 * → Edge Function fetchAsInlineData. The Edge Function runs with the
 * service-role key, making SSRF exfiltration of cloud IAM creds possible.
 *
 * Only Supabase Storage URLs in the `uploads` bucket are valid inputs.
 * Enforce at 3 layers: API routes, collectImageInputs, and the Deno Edge
 * Function (its own copy of this logic).
 */

const LINK_LOCAL_PREFIXES = [
  '169.254.',   // AWS/GCP/Azure IMDS
  '127.',        // loopback
  '10.',         // RFC1918
  '192.168.',    // RFC1918
  '172.16.', '172.17.', '172.18.', '172.19.', '172.20.',
  '172.21.', '172.22.', '172.23.', '172.24.', '172.25.',
  '172.26.', '172.27.', '172.28.', '172.29.', '172.30.', '172.31.',
  '::1', 'fc', 'fd',  // IPv6 loopback + ULA
]

const BLOCKED_HOSTNAMES = [
  'metadata.google.internal',
  'localhost',
]

export function assertStorageUrl(url: string): void {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new Error('invalid image URL')
  }

  if (parsed.protocol !== 'https:') throw new Error('invalid image URL')

  // Must be the project's Supabase Storage host
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!supabaseUrl) throw new Error('NEXT_PUBLIC_SUPABASE_URL not configured')
  const allowedHost = new URL(supabaseUrl).host
  if (parsed.host !== allowedHost) throw new Error('invalid image URL')

  // Must be in the uploads bucket (not outputs, eval, etc.)
  if (
    !parsed.pathname.startsWith('/storage/v1/object/sign/uploads/') &&
    !parsed.pathname.startsWith('/storage/v1/object/public/uploads/')
  ) {
    throw new Error('invalid image URL')
  }

  // Reject link-local / private IPs by hostname (defence-in-depth for numeric IPs)
  const host = parsed.hostname.toLowerCase()
  if (BLOCKED_HOSTNAMES.some((b) => host === b || host.endsWith('.' + b))) {
    throw new Error('invalid image URL')
  }
  if (LINK_LOCAL_PREFIXES.some((prefix) => host.startsWith(prefix))) {
    throw new Error('invalid image URL')
  }
}
