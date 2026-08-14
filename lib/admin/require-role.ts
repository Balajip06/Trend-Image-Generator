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
  const result = await checkAdminRole(min)
  if (!result.ok) {
    redirect(
      result.reason === 'unauthenticated'
        ? '/admin/login'
        : result.reason === 'not_admin'
          ? '/admin/login?error=not_admin'
          : '/admin/login?error=forbidden'
    )
  }
  return { userId: result.userId, role: result.role }
}

export type AdminRoleDenial = 'unauthenticated' | 'not_admin' | 'forbidden'

export type AdminRoleCheck =
  | { ok: true; userId: string; role: AdminRole }
  | { ok: false; reason: AdminRoleDenial }

/**
 * Non-redirecting variant of `requireAdminRole`.
 *
 * Server actions that return a typed result (e.g. `{ ok: false, error }`)
 * cannot use the redirecting guard: `redirect()` throws `NEXT_REDIRECT`, which
 * escapes the action's contract and surfaces as an unhandled rejection in the
 * calling client component instead of an error message. Those actions call
 * this and map the denial into their own result shape.
 */
export async function checkAdminRole(min: AdminRole = 'editor'): Promise<AdminRoleCheck> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, reason: 'unauthenticated' }

  const { data: adminRow } = await supabase
    .from('admin_users')
    .select('role')
    .eq('user_id', user.id)
    .maybeSingle()

  if (!adminRow) return { ok: false, reason: 'not_admin' }

  if (min === 'admin' && adminRow.role !== 'admin') {
    return { ok: false, reason: 'forbidden' }
  }

  return { ok: true, userId: user.id, role: adminRow.role as AdminRole }
}
