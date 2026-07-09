'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { logAdminAction } from '@/lib/admin/audit'
import { requireAdminRole } from '@/lib/admin/require-role'
import { createServiceClient } from '@/lib/supabase/server'
import { EVENTS, flushServer, trackServer } from '@/lib/analytics/server'

const ModelSchema = z.enum(['nano-banana', 'nano-banana-pro', 'gpt-image'])
type AllowedModel = z.infer<typeof ModelSchema>

export async function setGlobalDefaultModel(formData: FormData): Promise<void> {
  // Only 'admin' role can change global model (H-S2)
  const { userId } = await requireAdminRole('admin')

  const parsed = ModelSchema.safeParse(formData.get('model'))
  if (!parsed.success) return
  const newModel: AllowedModel = parsed.data

  const service = createServiceClient()

  // 1. Read current default from app_settings
  const { data: current } = await service
    .from('app_settings')
    .select('value')
    .eq('key', 'default_image_model')
    .maybeSingle()

  const currentModel =
    (current?.value as string | undefined)?.replace(/"/g, '') ?? 'gpt-image'
  if (currentModel === newModel) return // No change

  // 2. Find live non-pinned trends that will be affected
  const { data: affectedRows } = await service
    .from('trends')
    .select('slug')
    .eq('model_pinned', false)
    .eq('is_active', true)

  const affectedSlugs = (affectedRows ?? []).map((r) => r.slug)

  // 3. Bulk-UPDATE non-pinned trends to the new model.
  //    This fires bump_trend_version → eval_status='untested' + is_active=false per row.
  //    These trends go dark until re-evaluated. This is intentional and correct (H-M2).
  if (affectedSlugs.length > 0) {
    await service.from('trends').update({ model: newModel }).eq('model_pinned', false)
  }

  // 4. Write the new global default
  await service
    .from('app_settings')
    .update({
      value: JSON.stringify(newModel),
      updated_by: userId,
      updated_at: new Date().toISOString(),
    })
    .eq('key', 'default_image_model')

  // 5. Audit trail (H-S9: app.admin_actor GUC doesn't work via PostgREST; use logAdminAction)
  await logAdminAction({
    adminId: userId,
    action: 'model_provider_switched',
    targetTable: 'app_settings',
    targetId: 'default_image_model',
    before: { model: currentModel },
    after: { model: newModel, affected_trend_count: affectedSlugs.length },
  })

  trackServer(userId, EVENTS.MODEL_PROVIDER_SWITCHED, {
    from: currentModel,
    to: newModel,
    affected_trends: affectedSlugs.length,
  })
  await flushServer()

  revalidatePath('/admin/settings')
  revalidatePath('/admin/trends')
}
