import { NextResponse, type NextRequest } from 'next/server'
import { createRemoteJWKSet, jwtVerify } from 'jose'
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

  // Verify id_token signature via JWKS before trusting any claims
  let verifiedPayload: unknown
  try {
    const JWKS = createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`))
    const { payload } = await jwtVerify(tokens.id_token, JWKS, {
      issuer,
      audience: clientId,
    })
    verifiedPayload = payload
  } catch {
    return NextResponse.redirect(new URL('/login?error=kimp_claims_invalid', request.url))
  }

  const claims = IdTokenClaimsSchema.safeParse(verifiedPayload)
  if (!claims.success) {
    return NextResponse.redirect(new URL('/login?error=kimp_claims_invalid', request.url))
  }

  const { sub, email, nonce: claimNonce } = claims.data

  // Issue 1: Require verified email before any user lookup or creation
  if (!claims.data.email_verified) {
    return NextResponse.redirect(new URL('/login?error=kimp_email_unverified', request.url))
  }

  // Issue 2: Nonce check must be unconditional — undefined !== tx.nonce rejects missing nonce
  if (claimNonce !== tx.nonce) {
    return NextResponse.redirect(new URL('/login?error=kimp_nonce_mismatch', request.url))
  }

  // Bridge into Supabase: prefer matching by kimp_subject_id, fall back to email
  const service = createServiceClient()
  const { data: subjectRow } = await service
    .from('profiles')
    .select('id')
    .eq('kimp_subject_id', sub)
    .maybeSingle()

  let existingUser: { id: string } | undefined
  if (subjectRow) {
    existingUser = { id: subjectRow.id as string }
  } else {
    // Fall back to email match only when email is verified (already guarded above)
    const { data: listData } = await service.auth.admin.listUsers()
    existingUser = listData?.users.find(
      (u) => u.email?.toLowerCase() === email.toLowerCase()
    )
  }

  let supabaseUserId: string

  if (existingUser) {
    // Guard: if sub is already linked to a DIFFERENT profile → conflict
    const { data: conflictRow } = await service
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
  if (entitlement === 'active') {
    await service.rpc('grant_kimp_unlimited', {
      p_user_id: supabaseUserId,
      p_subject: sub,
      // p_client_id is nullable in Postgres (text, no NOT NULL); generated types are
      // overly strict here — cast to satisfy the client while preserving null semantics.
      p_client_id: (claims.data['kimp:client_id'] ?? null) as string,
      p_verified_at: new Date().toISOString(),
    })
  }

  // Clear PKCE cookie and redirect to the magic link action URL.
  // The browser visits it, which lands at /auth/callback and completes session setup.
  const response = NextResponse.redirect(sessionData.properties.action_link)
  response.cookies.delete('kimp_oidc_tx')
  return response
}
