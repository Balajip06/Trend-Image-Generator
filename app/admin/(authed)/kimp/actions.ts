'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { logAdminAction } from '@/lib/admin/audit'
import { requireAdminRole } from '@/lib/admin/require-role'
import { createServiceClient } from '@/lib/supabase/server'

const AddAllowlistSchema = z.object({
  email: z.string().email(),
  note: z.string().max(500).optional(),
})

function back(params: URLSearchParams): never {
  redirect(`/admin/kimp?${params.toString()}`)
}

/**
 * Add an email to the KIMP360 client allowlist.
 * Gated to role='admin' (H-S2: money-granting surface).
 */
export async function addAllowlistEntry(formData: FormData): Promise<void> {
  const { userId } = await requireAdminRole('admin')

  const parsed = AddAllowlistSchema.safeParse({
    email: formData.get('email'),
    note: (formData.get('note') as string | null) ?? undefined,
  })
  if (!parsed.success) back(new URLSearchParams({ error: 'Invalid email address' }))

  const service = createServiceClient()
  const { error } = await service.from('kimp_client_allowlist').insert({
    email: parsed.data.email.toLowerCase(),
    note: parsed.data.note ?? null,
    added_by: userId,
    is_active: true,
  })

  if (error) {
    const msg =
      error.code === '23505'
        ? `${parsed.data.email} is already on the allowlist`
        : error.message
    back(new URLSearchParams({ error: msg }))
  }

  await logAdminAction({
    adminId: userId,
    action: 'kimp_allowlist_add',
    targetTable: 'kimp_client_allowlist',
    targetId: parsed.data.email,
    after: { email: parsed.data.email, note: parsed.data.note ?? null },
  })

  revalidatePath('/admin/kimp')
  back(new URLSearchParams({ ok: '1' }))
}

/**
 * Deactivate an allowlist entry (soft-delete via is_active=false).
 * Does NOT immediately revoke the matched profile — the nightly cron handles that.
 * Gated to role='admin'.
 */
export async function deactivateAllowlistEntry(formData: FormData): Promise<void> {
  const { userId } = await requireAdminRole('admin')

  const email = (formData.get('email') as string | null)?.toLowerCase()
  if (!email) back(new URLSearchParams({ error: 'Missing email' }))

  const service = createServiceClient()
  const { error } = await service
    .from('kimp_client_allowlist')
    .update({ is_active: false, updated_at: new Date().toISOString() })
    .eq('email', email)

  if (error) back(new URLSearchParams({ error: error.message }))

  await logAdminAction({
    adminId: userId,
    action: 'kimp_allowlist_deactivate',
    targetTable: 'kimp_client_allowlist',
    targetId: email!,
    after: { email, is_active: false },
  })

  revalidatePath('/admin/kimp')
  back(new URLSearchParams({ ok: '1' }))
}

/**
 * Reactivate a previously deactivated allowlist entry.
 * Gated to role='admin'.
 */
export async function reactivateAllowlistEntry(formData: FormData): Promise<void> {
  const { userId } = await requireAdminRole('admin')

  const email = (formData.get('email') as string | null)?.toLowerCase()
  if (!email) back(new URLSearchParams({ error: 'Missing email' }))

  const service = createServiceClient()
  const { error } = await service
    .from('kimp_client_allowlist')
    .update({ is_active: true, updated_at: new Date().toISOString() })
    .eq('email', email)

  if (error) back(new URLSearchParams({ error: error.message }))

  await logAdminAction({
    adminId: userId,
    action: 'kimp_allowlist_reactivate',
    targetTable: 'kimp_client_allowlist',
    targetId: email!,
    after: { email, is_active: true },
  })

  revalidatePath('/admin/kimp')
  back(new URLSearchParams({ ok: '1' }))
}
