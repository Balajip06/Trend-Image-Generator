'use server'

import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

export type AdminRole = 'admin' | 'editor'

/**
 * Gate for money/eligibility admin actions (H-S2 / Risk #14).
 * Reads admin_users.role for the current session user.
 * Redirects to /admin/login?error=forbidden if the user is not at least `min` role.
 *
 * Call at the TOP of every server action that grants entitlements or modifies
 * global settings (VIP, KIMP allowlist, app_settings, credit refunds).
 *
 * Role hierarchy: admin > editor. Minimum 'editor' accepts both; 'admin' rejects editors.
 */
export async function requireAdminRole(
  min: AdminRole = 'editor'
): Promise<{ userId: string; role: AdminRole }> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/admin/login')

  const { data: adminRow } = await supabase
    .from('admin_users')
    .select('role')
    .eq('user_id', user.id)
    .maybeSingle()

  if (!adminRow) redirect('/admin/login?error=not_admin')

  if (min === 'admin' && adminRow.role !== 'admin') {
    redirect('/admin/login?error=forbidden')
  }

  return { userId: user.id, role: adminRow.role as AdminRole }
}
