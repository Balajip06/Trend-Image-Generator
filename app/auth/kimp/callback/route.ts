import { NextResponse, type NextRequest } from 'next/server'
import { z } from 'zod'
import { resolveKimpEntitlement } from '@/lib/auth/kimp/resolve-entitlement'
import { createServiceClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const IdTokenClaimsSchema = z.object({
  sub: z.string().min(1),
  email: z.string().email(),
  email_verified: z.boolean().optional(),
  nonce: z.string().optional(),
  'kimp:client_status': z.enum(['active', 'inactive']).optional(),
  'kimp:client_id': z.string().optional(),
})

export async function GET(request: NextRequest): Promise<NextResponse> {
  const url = new URL(request.url)
  const code = url.searchParams.get('code')
  const returnedState = url.searchParams.get('state')
  const errorParam = url.searchParams.get('error')
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'

  if (errorParam) {
    return NextResponse.redirect(new URL(`/login?error=kimp_oauth_${errorParam}`, request.url))
  }

  // Validate PKCE transaction cookie
  const txCookie = request.cookies.get('kimp_oidc_tx')?.value
  if (!txCookie || !code || !returnedState) {
    return NextResponse.redirect(new URL('/login?error=kimp_state_invalid', request.url))
  }

  let tx: { codeVerifier: string; state: string; nonce: string; next: string }
  try {
    tx = JSON.parse(txCookie) as { codeVerifier: string; state: string; nonce: string; next: string }
  } catch {
    return NextResponse.redirect(new URL('/login?error=kimp_state_invalid', request.url))
  }

  if (tx.state !== returnedState) {
    return NextResponse.redirect(new URL('/login?error=kimp_state_mismatch', request.url))
  }

  const issuer = process.env.KIMP360_OIDC_ISSUER
  const clientId = process.env.KIMP360_OIDC_CLIENT_ID
  const clientSecret = process.env.KIMP360_OIDC_CLIENT_SECRET
  if (!issuer || !clientId || !clientSecret) {
    return NextResponse.redirect(new URL('/login?error=kimp_unavailable', request.url))
  }

  // Exchange code for tokens
  const tokenRes = await fetch(`${issuer}/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: `${siteUrl}/auth/kimp/callback`,
      client_id: clientId,
      client_secret: clientSecret,
      code_verifier: tx.codeVerifier,
    }),
  })

  if (!tokenRes.ok) {
    return NextResponse.redirect(new URL('/login?error=kimp_token_failed', request.url))
  }

  const tokens = (await tokenRes.json()) as { access_token?: string; id_token?: string }
  if (!tokens.id_token) {
    return NextResponse.redirect(new URL('/login?error=kimp_token_failed', request.url))
  }

  // Decode id_token claims (signature validation is Supabase's job if using native OIDC;
  // for hand-rolled path, trust HTTPS + client_secret bound token exchange)
  const parts = tokens.id_token.split('.')
  if (parts.length < 2) {
    return NextResponse.redirect(new URL('/login?error=kimp_claims_invalid', request.url))
  }
  let rawClaims: unknown
  try {
    rawClaims = JSON.parse(Buffer.from(parts[1], 'base64url').toString())
  } catch {
    return NextResponse.redirect(new URL('/login?error=kimp_claims_invalid', request.url))
  }

  const claims = IdTokenClaimsSchema.safeParse(rawClaims)
  if (!claims.success) {
    return NextResponse.redirect(new URL('/login?error=kimp_claims_invalid', request.url))
  }

  const { sub, email, nonce: claimNonce } = claims.data
  // Verify nonce (replay protection)
  if (claimNonce && claimNonce !== tx.nonce) {
    return NextResponse.redirect(new URL('/login?error=kimp_nonce_mismatch', request.url))
  }

  // Bridge into Supabase: look up existing user by email
  const service = createServiceClient()
  const { data: listData } = await service.auth.admin.listUsers()
  const existingUser = listData?.users.find(
    (u) => u.email?.toLowerCase() === email.toLowerCase()
  )

  let supabaseUserId: string

  if (existingUser) {
    // Guard: if sub is already linked to a DIFFERENT profile → conflict
    // Cast required: kimp_subject_id column added by migration, types not yet regenerated
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: conflictRow } = await (service as any)
      .from('profiles')
      .select('id')
      .eq('kimp_subject_id', sub)
      .neq('id', existingUser.id)
      .maybeSingle()
    if (conflictRow) {
      return NextResponse.redirect(new URL('/login?error=kimp_account_conflict', request.url))
    }
    supabaseUserId = existingUser.id
  } else {
    // Create new Supabase user
    const { data: newUser, error: createError } = await service.auth.admin.createUser({
      email,
      email_confirm: true,
      user_metadata: { provider: 'kimp360', kimp_subject_id: sub },
    })
    if (createError || !newUser.user) {
      return NextResponse.redirect(new URL('/login?error=kimp_create_failed', request.url))
    }
    supabaseUserId = newUser.user.id
  }

  // Generate a magic link to bridge the Supabase session.
  // The action_link, when visited by the browser, completes the sign-in
  // via /auth/callback?code=... which handles session setup.
  const { data: sessionData, error: sessionError } = await service.auth.admin.generateLink({
    type: 'magiclink',
    email,
  })
  if (sessionError || !sessionData?.properties?.action_link) {
    return NextResponse.redirect(new URL('/login?error=kimp_session_failed', request.url))
  }

  // Resolve KIMP entitlement
  const entitlement = await resolveKimpEntitlement({
    userId: supabaseUserId,
    email,
    oidcSub: sub,
    oidcStatus: claims.data['kimp:client_status'],
  })

  // Grant unlimited if active
  // Cast required: grant_kimp_unlimited RPC added by migration, types not yet regenerated
  if (entitlement === 'active') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (service as any).rpc('grant_kimp_unlimited', {
      p_user_id: supabaseUserId,
      p_subject: sub,
      p_client_id: claims.data['kimp:client_id'] ?? null,
      p_verified_at: new Date().toISOString(),
    })
  }

  // Clear PKCE cookie and redirect to the magic link action URL.
  // The browser visits it, which lands at /auth/callback and completes session setup.
  const response = NextResponse.redirect(sessionData.properties.action_link)
  response.cookies.delete('kimp_oidc_tx')
  return response
}
