'use server'

import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { siteUrl } from '@/lib/utils/site-url'

/**
 * Send an admin password-reset email.
 *
 * We always redirect to `?sent=1` regardless of whether Supabase actually
 * found a matching account — prevents email enumeration. Failures are logged
 * server-side for debugging but never surfaced to the caller.
 *
 * The actual email send relies on Supabase Auth's configured SMTP / Resend
 * integration. If creds aren't wired in the Supabase dashboard, no email
 * goes out but the UI flow is unchanged.
 */
export async function sendResetEmail(formData: FormData): Promise<void> {
  const email = String(formData.get('email') ?? '')
    .trim()
    .toLowerCase()
  if (!email) redirect('/admin/forgot-password?error=invalid_email')

  const supabase = await createClient()
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: siteUrl('/admin/reset-password'),
  })

  if (error) {
    // Log but don't expose — generic success message protects against
    // account enumeration.
    console.error('resetPasswordForEmail failed:', error.message)
  }

  redirect('/admin/forgot-password?sent=1')
}
