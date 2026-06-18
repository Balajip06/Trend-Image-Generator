'use server'

import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { safeNextPath } from '@/lib/auth/safe-next-path'
import { createClient } from '@/lib/supabase/server'
import { verifyTurnstile } from '@/lib/turnstile/verify'

// `tos_accepted` MUST be the literal string "1" — the LoginForms checkbox
// emits "0" by default and "1" only once the user checks it.
const EmailPasswordSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  next: z.string().optional(),
  turnstile_token: z.string().optional(),
  tos_accepted: z.literal('1'),
})

async function clientIp(): Promise<string | undefined> {
  const h = await headers()
  return h.get('x-forwarded-for')?.split(',')[0]?.trim() ?? undefined
}

function resolveNext(raw: string | undefined): string {
  const normalized = safeNextPath(raw ?? '/me/studio')
  return normalized === '/' ? '/me/studio' : normalized
}

export async function signInWithEmail(formData: FormData): Promise<void> {
  const parsed = EmailPasswordSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
    next: formData.get('next'),
    turnstile_token: formData.get('turnstile_token'),
    tos_accepted: formData.get('tos_accepted'),
  })
  if (!parsed.success) {
    const tosFailed = parsed.error.issues.some((i) => i.path[0] === 'tos_accepted')
    if (tosFailed) redirect('/login?error=tos_required')
    const pwFailed = parsed.error.issues.some((i) => i.path[0] === 'password')
    if (pwFailed) redirect('/login?error=password_too_short')
    redirect('/login?error=invalid_email')
  }

  const ok = await verifyTurnstile(parsed.data.turnstile_token ?? '', await clientIp())
  if (!ok) redirect('/login?error=bot_check_failed')

  const next = resolveNext(parsed.data.next)
  const supabase = await createClient()

  // Try password sign-in first (returning user path).
  const { error: signInError } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  })

  if (!signInError) {
    redirect(next)
  }

  // Password wrong or account doesn't exist — single generic error (no enumeration).
  redirect('/login?error=invalid_credentials')
}

export async function signInWithKimp(formData: FormData): Promise<void> {
  const rawNext = (formData.get('next') as string) || '/me/studio'
  const next = resolveNext(rawNext)
  const tosAccepted = (formData.get('tos_accepted') as string) || '0'

  if (tosAccepted !== '1') redirect('/login?error=tos_required')

  // Delegate to the dedicated initiate route. The route handler performs the
  // OIDC redirect — server actions cannot issue external OAuth redirects directly.
  redirect(`/api/auth/kimp/initiate?next=${encodeURIComponent(next)}`)
}

export async function signInWithGoogle(formData: FormData): Promise<void> {
  const rawNext = (formData.get('next') as string) || '/me/studio'
  const next = resolveNext(rawNext)
  const token = (formData.get('turnstile_token') as string) || ''
  const tosAccepted = (formData.get('tos_accepted') as string) || '0'

  if (tosAccepted !== '1') redirect('/login?error=tos_required')

  const ok = await verifyTurnstile(token, await clientIp())
  if (!ok) redirect('/login?error=bot_check_failed')

  const supabase = await createClient()
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: `${siteUrl}/auth/callback?next=${encodeURIComponent(next)}` },
  })
  if (error || !data.url) redirect('/login?error=oauth_failed')
  redirect(data.url)
}
