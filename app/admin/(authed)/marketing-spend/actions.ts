'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { logAdminAction } from '@/lib/admin/audit'
import { requireAdminRole } from '@/lib/admin/require-role'
import { createServiceClient } from '@/lib/supabase/server'

const RecordSchema = z.object({
  week_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'week_start must be YYYY-MM-DD'),
  channel: z.string().trim().min(1).max(40),
  usd_spent: z.coerce.number().min(0),
  notes: z.string().trim().max(500).optional(),
})

function back(params: URLSearchParams): never {
  redirect(`/admin/marketing-spend?${params.toString()}`)
}

/**
 * Insert (or upsert on unique week_start+channel) a marketing-spend row.
 * Service-role because the table has no user-facing RLS policy. Audit-logged
 * so the trail captures who recorded what spend on which week.
 */
export async function recordMarketingSpend(formData: FormData): Promise<void> {
  const parsed = RecordSchema.safeParse({
    week_start: formData.get('week_start'),
    channel: (formData.get('channel') as string | null)?.toLowerCase(),
    usd_spent: formData.get('usd_spent'),
    notes: (formData.get('notes') as string | null) ?? undefined,
  })
  if (!parsed.success) {
    const msg = parsed.error.issues[0]?.message ?? 'invalid input'
    back(new URLSearchParams({ error: msg }))
  }

  // Authorize AND resolve the actor. `recorded_by` previously fell back to
  // null when the session was missing, writing an unattributable spend row.
  const { userId: adminUserId } = await requireAdminRole('editor')

  const service = createServiceClient()
  const insertPayload = {
    week_start: parsed.data.week_start,
    channel: parsed.data.channel,
    usd_spent: parsed.data.usd_spent,
    notes: parsed.data.notes ?? null,
    recorded_by: adminUserId,
  }
  const { error } = await service
    .from('admin_marketing_spend')
    .upsert(insertPayload, { onConflict: 'week_start,channel' })

  if (error) {
    back(new URLSearchParams({ error: `insert failed: ${error.message}` }))
  }

  await logAdminAction({
    adminId: adminUserId,
    action: 'marketing_spend_recorded',
    targetTable: 'admin_marketing_spend',
    targetId: null,
    after: insertPayload,
  })

  revalidatePath('/admin/marketing-spend')
  revalidatePath('/admin/margin')
  back(new URLSearchParams({ ok: '1' }))
}
