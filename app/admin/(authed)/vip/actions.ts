'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { logAdminAction } from '@/lib/admin/audit'
import { requireAdminRole } from '@/lib/admin/require-role'
import { createServiceClient } from '@/lib/supabase/server'

const FindSchema = z.object({
  email: z.string().email(),
})

const SetVipSchema = z.object({
  user_id: z.string().uuid(),
  email: z.string().email(),
  enable: z.enum(['0', '1']),
  reason: z.string().max(300).optional(),
})

function back(params: URLSearchParams): never {
  redirect(`/admin/vip?${params.toString()}`)
}

/**
 * Look up a user by email. We don't return the row — we just redirect to
 * `?email=<email>` and let the page re-render with the user state visible.
 * Keeps a single rendering path on the page (server component reads the
 * same query param whether the admin typed it or we redirected).
 */
export async function findUserForVip(formData: FormData): Promise<void> {
  // Read-only, but it discloses whether an email has an account — gate it.
  await requireAdminRole('editor')
  const parsed = FindSchema.safeParse({ email: formData.get('email') })
  if (!parsed.success) {
    back(new URLSearchParams({ error: 'invalid email' }))
  }

  const service = createServiceClient()
  const { data: row, error } = await service
    .from('profiles')
    .select('id, email, is_vip')
    .eq('email', parsed.data.email)
    .maybeSingle()

  if (error) {
    back(new URLSearchParams({ error: `lookup failed: ${error.message}` }))
  }
  const profile = row ?? null
  if (!profile) {
    back(new URLSearchParams({ error: `no profile for ${parsed.data.email}` }))
  }

  back(new URLSearchParams({ email: parsed.data.email }))
}

/**
 * Toggle a profile's VIP flag. Always writes an audit entry — VIP grants
 * are a compliance-sensitive event because they comp the quota that
 * paying users hit. `vip_granted_by` is stamped from the current admin's
 * session so the audit trail attributes the comp.
 */
export async function setVip(formData: FormData): Promise<void> {
  const parsed = SetVipSchema.safeParse({
    user_id: formData.get('user_id'),
    email: formData.get('email'),
    enable: formData.get('enable'),
    reason: formData.get('reason') ?? undefined,
  })
  if (!parsed.success) {
    const msg = parsed.error.issues[0]?.message ?? 'invalid input'
    back(new URLSearchParams({ error: msg }))
  }

  const enable = parsed.data.enable === '1'

  // Authorize AND resolve the acting admin in one step. VIP comps the quota
  // paying users hit, so this is 'admin'. Previously this only read the
  // session for attribution and relied on proxy.ts for the gate — which has a
  // documented MOCK_TRENDS bypass.
  const { userId: adminUserId } = await requireAdminRole('admin')

  const service = createServiceClient()
  const updatePayload = enable
    ? {
        is_vip: true,
        vip_reason: parsed.data.reason ?? null,
        vip_granted_by: adminUserId,
        vip_granted_at: new Date().toISOString(),
      }
    : {
        is_vip: false,
        vip_reason: null,
        vip_granted_by: null,
        vip_granted_at: null,
      }

  const { error: updateErr } = await service
    .from('profiles')
    .update(updatePayload)
    .eq('id', parsed.data.user_id)

  if (updateErr) {
    back(new URLSearchParams({ error: `update failed: ${updateErr.message}` }))
  }

  await logAdminAction({
    adminId: adminUserId,
    action: enable ? 'vip_grant' : 'vip_revoke',
    targetTable: 'profiles',
    targetId: parsed.data.user_id,
    after: { is_vip: enable, reason: parsed.data.reason ?? null },
  })

  revalidatePath('/admin/vip')
  back(new URLSearchParams({ ok: '1', email: parsed.data.email }))
}
