'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { logAdminAction } from '@/lib/admin/audit'
import { generateImage } from '@/lib/image-provider'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { buildEvalValues } from '@/lib/trends/eval-values'
import { TrendInputSchema, type TrendInput } from '@/lib/trends/input-schema'
import { collectImageInputs, interpolatePrompt } from '@/lib/trends/interpolate'

const InputCreateSchema = z.object({
  label: z.string().min(1).max(80),
  image_url: z.string().url(),
  demographic_tag: z.string().max(40).optional().nullable(),
})

function emptyToNull(v: FormDataEntryValue | null): string | null {
  if (typeof v !== 'string') return null
  const s = v.trim()
  return s === '' ? null : s
}

export async function addEvalInput(trendId: string, formData: FormData): Promise<void> {
  const parsed = InputCreateSchema.safeParse({
    label: formData.get('label'),
    image_url: formData.get('image_url'),
    demographic_tag: emptyToNull(formData.get('demographic_tag')),
  })
  if (!parsed.success) {
    const msg = parsed.error.issues[0]?.message ?? 'invalid'
    redirect(`/admin/trends/${trendId}/eval?error=${encodeURIComponent(msg)}`)
  }

  const supabase = createServiceClient()
  const insertRow = { trend_id: trendId, ...parsed.data }
  const { error } = await supabase.from('trend_eval_inputs').insert(insertRow)
  if (error) {
    redirect(`/admin/trends/${trendId}/eval?error=${encodeURIComponent(error.message)}`)
  }
  revalidatePath(`/admin/trends/${trendId}/eval`)
  redirect(`/admin/trends/${trendId}/eval?added=1`)
}

export async function removeEvalInput(trendId: string, inputId: string): Promise<void> {
  const supabase = createServiceClient()
  await supabase.from('trend_eval_inputs').delete().eq('id', inputId)
  revalidatePath(`/admin/trends/${trendId}/eval`)
  redirect(`/admin/trends/${trendId}/eval?removed=1`)
}

/**
 * Runs the current trend prompt against every eval input in parallel.
 *
 * Text + select placeholders in the prompt are substituted with each field's
 * admin-defined `default` (text) or first-option value (select). Trends with
 * required text fields that have no `default` will fail interpolation here
 * and the run is marked `error:missing_eval_default` — surfaces the gap
 * loudly so the admin knows to set a default before re-running.
 *
 * Uploads each Gemini output to outputs/eval/<trend_id>/<run_id>.png and
 * inserts a trend_eval_runs row. Falls back to mock-mode when GEMINI_API_KEY
 * is missing so the workflow can be exercised locally.
 */
export async function runEval(trendId: string): Promise<void> {
  const supabase = createServiceClient()

  const { data: trendRow } = await supabase
    .from('trends')
    .select('id, prompt_template, model, version, input_schema')
    .eq('id', trendId)
    .maybeSingle()
  const trend = trendRow
  if (!trend) {
    redirect(`/admin/trends/${trendId}/eval?error=trend_not_found`)
  }

  const schemaParsed = TrendInputSchema.safeParse(trend!.input_schema)
  if (!schemaParsed.success) {
    redirect(
      `/admin/trends/${trendId}/eval?error=${encodeURIComponent('input_schema invalid: ' + (schemaParsed.error.issues[0]?.message ?? ''))}`
    )
  }
  const schema: TrendInput = schemaParsed.data

  const { data: inputRows } = await supabase
    .from('trend_eval_inputs')
    .select('id, image_url')
    .eq('trend_id', trendId)
  const inputs = inputRows ?? []
  if (inputs.length === 0) {
    redirect(`/admin/trends/${trendId}/eval?error=no_inputs`)
  }

  await Promise.allSettled(
    inputs.map(async (input) => {
      const insertRow = {
        trend_id: trendId,
        prompt_version: trend!.version,
        eval_input_id: input.id,
        model: trend!.model,
      }
      const { data: created, error: insertErr } = await supabase
        .from('trend_eval_runs')
        .insert(insertRow)
        .select('id')
        .maybeSingle()
      if (insertErr || !created) return
      const runId = (created as { id: string }).id

      let prompt: string
      let imageUrls: string[]
      try {
        const values = buildEvalValues(schema, input.image_url)
        prompt = interpolatePrompt(trend!.prompt_template, schema, values)
        imageUrls = collectImageInputs(schema, values)
      } catch (err: unknown) {
        const reason = err instanceof Error ? err.message : 'interpolation_failed'
        const update = {
          output_url: null,
          admin_rating: `error:missing_eval_default:${reason.slice(0, 80)}`,
        }
        await supabase.from('trend_eval_runs').update(update).eq('id', runId)
        return
      }

      const result = await generateImage({
        model: trend!.model,
        prompt,
        imageUrls,
      })
      if (!result.ok) {
        const update = { output_url: null, admin_rating: `error:${result.reason}` }
        await supabase.from('trend_eval_runs').update(update).eq('id', runId)
        return
      }

      const path = `eval/${trendId}/${runId}.png`
      const { error: uploadErr } = await supabase.storage
        .from('outputs')
        .upload(path, result.outputPng, { contentType: 'image/png', upsert: true })
      if (uploadErr) return

      const { data: publicUrl } = supabase.storage.from('outputs').getPublicUrl(path)
      const update = { output_url: publicUrl.publicUrl }
      await supabase.from('trend_eval_runs').update(update).eq('id', runId)
    })
  )

  revalidatePath(`/admin/trends/${trendId}/eval`)
  redirect(`/admin/trends/${trendId}/eval?ran=1`)
}

export async function rateEvalRun(
  trendId: string,
  runId: string,
  rating: 'pass' | 'fail'
): Promise<void> {
  const supabase = createServiceClient()
  const update = { admin_rating: rating }
  await supabase.from('trend_eval_runs').update(update).eq('id', runId)
  revalidatePath(`/admin/trends/${trendId}/eval`)
}

export async function markTrendEval(
  trendId: string,
  status: 'passed' | 'failed' | 'untested'
): Promise<void> {
  const supabase = createServiceClient()
  const update = { eval_status: status }
  const { error } = await supabase.from('trends').update(update).eq('id', trendId)
  if (error) {
    redirect(`/admin/trends/${trendId}/eval?error=${encodeURIComponent(error.message)}`)
  }

  const authed = await createClient()
  const {
    data: { user },
  } = await authed.auth.getUser()
  await logAdminAction({
    adminId: user?.id ?? null,
    action: `mark_eval_${status}`,
    targetTable: 'trends',
    targetId: trendId,
    after: { eval_status: status },
  })

  revalidatePath(`/admin/trends/${trendId}/eval`)
  revalidatePath('/admin/trends')
  revalidatePath(`/admin/trends/${trendId}/edit`)
  redirect(`/admin/trends/${trendId}/eval?marked-${status}=1`)
}
