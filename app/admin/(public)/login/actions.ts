'use server'

import { redirect } from 'next/navigation'
import { isEmailAllowedToLogin } from '@/lib/auth/login-allowlist'
import { safeNextPath } from '@/lib/auth/safe-next-path'
import { createClient } from '@/lib/supabase/server'

/**
 * Admin password sign-in.
 *
 * - Re-validates the `next` path so `?next=//evil.com` can't pivot a freshly
 *   issued admin session off-site (see lib/auth/safe-next-path.ts).
 * - Defense-in-depth: even after a successful password auth, we confirm a row
 *   exists in `admin_users` for this user_id. If not, we sign out + redirect
 *   to keep a non-admin from holding a session that proxy.ts already rejects.
 * - Generic `invalid_credentials` copy on any auth failure prevents account
 *   enumeration (no distinction between "no account", "wrong password",
 *   "wrong email").
 */
export async function signInWithPassword(formData: FormData): Promise<void> {
  const email = String(formData.get('email') ?? '')
    .trim()
    .toLowerCase()
  const password = String(formData.get('password') ?? '')
  const next = safeNextPath(String(formData.get('next') ?? '/admin'))

  if (!email || !password) {
    redirect(`/admin/login?error=invalid_credentials&next=${encodeURIComponent(next)}`)
  }
  if (password.length < 8) {
    redirect(`/admin/login?error=password_too_short&next=${encodeURIComponent(next)}`)
  }
  if (!isEmailAllowedToLogin(email)) {
    redirect(`/admin/login?error=invalid_credentials&next=${encodeURIComponent(next)}`)
  }

  const supabase = await createClient()
  const { data, error } = await supabase.auth.signInWithPassword({ email, password })

  if (error || !data.user) {
    redirect(`/admin/login?error=invalid_credentials&next=${encodeURIComponent(next)}`)
  }

  // Defense-in-depth: confirm admin row exists. Sign out + redirect if not.
  const { data: adminRow } = await supabase
    .from('admin_users')
    .select('user_id')
    .eq('user_id', data.user.id)
    .maybeSingle()
  if (!adminRow) {
    await supabase.auth.signOut()
    redirect(`/admin/login?error=not_admin`)
  }

  redirect(next)
}
