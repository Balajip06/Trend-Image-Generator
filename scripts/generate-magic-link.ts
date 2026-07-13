/**
 * Generates a one-time magic-link URL for an existing auth user, bypassing
 * Resend / email send entirely. Prints the URL; click it to sign in.
 *
 * Run: pnpm dlx tsx scripts/generate-magic-link.ts <email>
 */

import { config } from 'dotenv'
import { createClient } from '@supabase/supabase-js'

config({ path: '.env.local' })

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })

function normalizeNextPath(raw: string | undefined): string {
  if (!raw) return '/studio'
  // Strip Git-Bash MSYS path conversion artifact: `/creations` on Windows
  // bash gets rewritten to `C:/Program Files/Git/creations`. Detect by
  // looking for a drive prefix + recover the trailing slash-prefixed path.
  const winPathPrefix =
    /^[A-Za-z]:[\\/].*?[\\/](me|admin|result|login|trend|pricing|status|about)[\\/]?/i
  const match = winPathPrefix.exec(raw)
  if (match) {
    const idx = raw.toLowerCase().lastIndexOf('/' + match[1].toLowerCase())
    return raw.slice(idx).replace(/\\/g, '/')
  }
  // Accept either `me/creations` or `/creations` — normalize to leading `/`.
  return raw.startsWith('/') ? raw : `/${raw}`
}

async function main(): Promise<void> {
  const email = process.argv[2]
  const nextPath = normalizeNextPath(process.argv[3])
  if (!email) {
    console.error('Usage: pnpm dlx tsx scripts/generate-magic-link.ts <email> [next-path]')
    console.error('Example: pnpm dlx tsx scripts/generate-magic-link.ts you@example.com admin')
    console.error('Default next-path: /creations')
    process.exit(1)
  }

  const { data, error } = await supabase.auth.admin.generateLink({
    type: 'magiclink',
    email,
  })

  if (error || !data) {
    console.error(`generateLink failed: ${error?.message ?? 'no data returned'}`)
    process.exit(1)
  }

  const hashedToken = data.properties?.hashed_token
  if (!hashedToken) {
    console.error('No hashed_token in response — cannot build /auth/confirm URL.')
    process.exit(1)
  }

  // Bypass Supabase's /auth/v1/verify -> PKCE flow by routing directly to our
  // /auth/confirm endpoint, which calls verifyOtp() instead of
  // exchangeCodeForSession() — no code_verifier cookie required.
  const confirmUrl = `${SITE_URL}/auth/confirm?token_hash=${encodeURIComponent(hashedToken)}&type=magiclink&next=${encodeURIComponent(nextPath)}`

  console.log('')
  console.log('Click this URL in your browser to sign in:')
  console.log('')
  console.log(confirmUrl)
  console.log('')
  console.log(`One-time use. Expires in 1 hour. Lands at ${nextPath}.`)
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : 'unknown error')
  process.exit(1)
})
