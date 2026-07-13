import { NextResponse, type NextRequest } from 'next/server'
import {
  generateCodeVerifier,
  generateCodeChallenge,
  generateState,
  generateNonce,
} from '@/lib/auth/kimp/pkce'
import { safeNextPath } from '@/lib/auth/safe-next-path'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest): Promise<NextResponse> {
  const issuer = process.env.KIMP360_OIDC_ISSUER
  const clientId = process.env.KIMP360_OIDC_CLIENT_ID
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'

  // Fallback: IdP not yet configured — surface clean error
  if (!issuer || !clientId) {
    return NextResponse.redirect(new URL('/login?error=kimp_unavailable', request.url))
  }

  const url = new URL(request.url)
  const next = safeNextPath(url.searchParams.get('next') ?? '/studio')

  const codeVerifier = await generateCodeVerifier()
  const codeChallenge = await generateCodeChallenge(codeVerifier)
  const state = generateState()
  const nonce = generateNonce()

  // Build OIDC authorization URL
  const authUrl = new URL(`${issuer}/authorize`)
  authUrl.searchParams.set('client_id', clientId)
  authUrl.searchParams.set('redirect_uri', `${siteUrl}/auth/kimp/callback`)
  authUrl.searchParams.set('response_type', 'code')
  authUrl.searchParams.set('scope', 'openid email profile kimp.client_status')
  authUrl.searchParams.set('state', state)
  authUrl.searchParams.set('nonce', nonce)
  authUrl.searchParams.set('code_challenge', codeChallenge)
  authUrl.searchParams.set('code_challenge_method', 'S256')

  // Store PKCE transaction in a short-lived httpOnly cookie
  const txValue = JSON.stringify({ codeVerifier, state, nonce, next })
  const response = NextResponse.redirect(authUrl.toString())
  response.cookies.set('kimp_oidc_tx', txValue, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 600, // 10 minutes
    path: '/',
  })

  return response
}
