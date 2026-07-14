'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { logAdminAction } from '@/lib/admin/audit'
import { requireAdminRole } from '@/lib/admin/require-role'
import { createServiceClient } from '@/lib/supabase/server'
import { EVENTS, flushServer, trackServer } from '@/lib/analytics/server'

const ModelSchema = z.enum(['nano-banana-2', 'nano-banana-2-lite', 'gpt-image-2'])
type AllowedModel = z.infer<typeof ModelSchema>

export async function setGlobalDefaultModel(formData: FormData): Promise<void> {
  // Only 'admin' role can change global model (H-S2)
  const { userId } = await requireAdminRole('admin')

  const parsed = ModelSchema.safeParse(formData.get('model'))
  if (!parsed.success) return
  const newModel: AllowedModel = parsed.data

  const service = createServiceClient()

  // 1. Read current default from app_settings.
  //    value is a jsonb scalar; supabase-js already parses it to a JS string.
  const { data: current } = await service
    .from('app_settings')
    .select('value')
    .eq('key', 'default_image_model')
    .maybeSingle()

  const currentModel = (current?.value as string | undefined) ?? 'gpt-image-2'
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

  // 4. Write the new global default. Pass the raw string — supabase-js
  //    JSON-encodes the request body, so the jsonb column receives a proper
  //    scalar. JSON.stringify here would double-encode it (stored as "\"x\"").
  const { error: writeError } = await service
    .from('app_settings')
    .update({
      value: newModel,
      updated_by: userId,
      updated_at: new Date().toISOString(),
    })
    .eq('key', 'default_image_model')
  if (writeError) throw new Error(`Failed to save default model: ${writeError.message}`)

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

export async function setBannerTrend(formData: FormData): Promise<void> {
  const { userId } = await requireAdminRole('editor')

  const raw = formData.get('trend_id')
  const parsed = z.union([z.string().uuid(), z.literal('')]).safeParse(raw)
  if (!parsed.success) return
  const newTrendId = parsed.data === '' ? null : parsed.data

  const service = createServiceClient()

  // value is a jsonb scalar; supabase-js parses it to a JS string (or null).
  const { data: current } = await service
    .from('app_settings')
    .select('value')
    .eq('key', 'banner_trend_id')
    .maybeSingle()
  const currentTrendId = (current?.value as string | null | undefined) ?? null
  if (currentTrendId === newTrendId) return

  // Pass the raw value — supabase-js JSON-encodes the body, so the jsonb column
  // stores a proper scalar (string or JSON null). JSON.stringify would
  // double-encode; a SQL NULL would violate the NOT NULL constraint.
  const { error: writeError } = await service
    .from('app_settings')
    .update({
      value: newTrendId,
      updated_by: userId,
      updated_at: new Date().toISOString(),
    })
    .eq('key', 'banner_trend_id')
  if (writeError) throw new Error(`Failed to save banner trend: ${writeError.message}`)

  await logAdminAction({
    adminId: userId,
    action: 'banner_trend_changed',
    targetTable: 'app_settings',
    targetId: 'banner_trend_id',
    before: { trend_id: currentTrendId },
    after: { trend_id: newTrendId },
  })

  revalidatePath('/admin/settings')
  revalidatePath('/')
}
