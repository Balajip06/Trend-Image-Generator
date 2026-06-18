'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { logAdminAction } from '@/lib/admin/audit'
import { requireAdminRole } from '@/lib/admin/require-role'
import { createServiceClient } from '@/lib/supabase/server'

const ModelSchema = z.enum(['nano-banana', 'nano-banana-pro', 'gpt-image'])
type AllowedModel = z.infer<typeof ModelSchema>

/**
 * Escape hatch for tables and columns not yet reflected in generated types
 * (app_settings table, model_pinned column, gpt-image enum value).
 * Remove once `pnpm supabase:types` is re-run against the live schema.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function anyClient(service: ReturnType<typeof createServiceClient>): any {
  return service
}

export async function setGlobalDefaultModel(formData: FormData): Promise<void> {
  // Only 'admin' role can change global model (H-S2)
  const { userId } = await requireAdminRole('admin')

  const parsed = ModelSchema.safeParse(formData.get('model'))
  if (!parsed.success) return
  const newModel: AllowedModel = parsed.data

  const service = createServiceClient()
  const svc = anyClient(service)

  // 1. Read current default from app_settings (table pending pnpm supabase:types re-run)
  const { data: current } = await svc
    .from('app_settings')
    .select('value')
    .eq('key', 'default_image_model')
    .maybeSingle()

  const currentModel = (current?.value as string | undefined)?.replace(/"/g, '') ?? 'nano-banana-pro'
  if (currentModel === newModel) return // No change

  // 2. Find live non-pinned trends that will be affected
  //    (model_pinned column pending pnpm supabase:types re-run)
  const { data: affectedRows } = await svc
    .from('trends')
    .select('slug')
    .eq('model_pinned', false)
    .eq('is_active', true)

  const affectedSlugs = (affectedRows ?? []).map((r: { slug: string }) => r.slug)

  // 3. Bulk-UPDATE non-pinned trends to the new model.
  //    This fires bump_trend_version → eval_status='untested' + is_active=false per row.
  //    These trends go dark until re-evaluated. This is intentional and correct (H-M2).
  if (affectedSlugs.length > 0) {
    await svc.from('trends').update({ model: newModel }).eq('model_pinned', false)
  }

  // 4. Write the new global default
  await svc
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

  revalidatePath('/admin/settings')
  revalidatePath('/admin/trends')
}
