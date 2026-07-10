'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { logAdminAction } from '@/lib/admin/audit'
import { generateImage } from '@/lib/image-provider'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { buildEvalValues } from '@/lib/trends/eval-values'
import { TrendInputSchema, type TrendInput } from '@/lib/trends/input-schema'
import { collectImageInputs, interpolatePrompt, REALISM_SUFFIX } from '@/lib/trends/interpolate'

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

export type EvalActionResult = { ok: true } | { ok: false; error: string }

export async function removeEvalInput(trendId: string, inputId: string): Promise<EvalActionResult> {
  const supabase = createServiceClient()
  const { error } = await supabase.from('trend_eval_inputs').delete().eq('id', inputId)
  if (error) return { ok: false, error: error.message }
  revalidatePath(`/admin/trends/${trendId}/eval`)
  return { ok: true }
}

/**
 * Runs the current trend prompt against a single eval input.
 *
 * Text + select placeholders in the prompt are substituted with each field's
 * admin-defined `default` (text) or first-option value (select). Trends with
 * required text fields that have no `default` will fail interpolation and
 * the failure is returned to the caller — the run row itself stays untouched
 * so `admin_rating` remains reserved for actual pass/fail review state.
 *
 * Uploads the Gemini output to outputs/eval/<trend_id>/<run_id>.png and
 * inserts a trend_eval_runs row. Falls back to mock-mode when GEMINI_API_KEY
 * is missing so the workflow can be exercised locally.
 */
export async function runEval(trendId: string, inputId: string): Promise<EvalActionResult> {
  const supabase = createServiceClient()

  const { data: trend } = await supabase
    .from('trends')
    .select('id, prompt_template, model, version, input_schema')
    .eq('id', trendId)
    .maybeSingle()
  if (!trend) return { ok: false, error: 'Trend not found.' }

  const schemaParsed = TrendInputSchema.safeParse(trend.input_schema)
  if (!schemaParsed.success) {
    return {
      ok: false,
      error: `input_schema invalid: ${schemaParsed.error.issues[0]?.message ?? ''}`,
    }
  }
  const schema: TrendInput = schemaParsed.data

  const { data: input } = await supabase
    .from('trend_eval_inputs')
    .select('id, image_url')
    .eq('id', inputId)
    .maybeSingle()
  if (!input) return { ok: false, error: 'Reference photo not found.' }

  const insertRow = {
    trend_id: trendId,
    prompt_version: trend.version,
    eval_input_id: input.id,
    model: trend.model,
  }
  const { data: created, error: insertErr } = await supabase
    .from('trend_eval_runs')
    .insert(insertRow)
    .select('id')
    .maybeSingle()
  if (insertErr || !created) {
    return { ok: false, error: insertErr?.message ?? 'Could not create eval run.' }
  }
  const runId = (created as { id: string }).id

  let prompt: string
  let imageUrls: string[]
  try {
    const values = buildEvalValues(schema, input.image_url)
    prompt = interpolatePrompt(trend.prompt_template, schema, values) + REALISM_SUFFIX
    imageUrls = collectImageInputs(schema, values)
  } catch (err: unknown) {
    const reason = err instanceof Error ? err.message : 'interpolation_failed'
    return { ok: false, error: `Missing eval default: ${reason}` }
  }

  const result = await generateImage({
    model: trend.model,
    prompt,
    imageUrls,
    // Eval runs as a plain Next.js server action, not the Supabase Edge
    // Function — no 150s platform wall-clock applies here. gpt-image-2
    // has been observed taking 93-134s+ for image-edit calls; give this
    // admin-only path more headroom than the production default.
    timeoutMs: 170_000,
  })
  if (!result.ok) {
    return { ok: false, error: result.message }
  }

  const path = `eval/${trendId}/${runId}.png`
  const { error: uploadErr } = await supabase.storage
    .from('outputs')
    .upload(path, result.outputPng, { contentType: 'image/png', upsert: true })
  if (uploadErr) return { ok: false, error: uploadErr.message }

  const { data: publicUrl } = supabase.storage.from('outputs').getPublicUrl(path)
  const update = { output_url: publicUrl.publicUrl }
  const { error: updateErr } = await supabase.from('trend_eval_runs').update(update).eq('id', runId)
  if (updateErr) return { ok: false, error: updateErr.message }

  revalidatePath(`/admin/trends/${trendId}/eval`)
  return { ok: true }
}

export async function rateEvalRun(
  trendId: string,
  runId: string,
  rating: 'pass' | 'fail'
): Promise<EvalActionResult> {
  const supabase = createServiceClient()
  const update = { admin_rating: rating }
  const { error } = await supabase.from('trend_eval_runs').update(update).eq('id', runId)
  if (error) return { ok: false, error: error.message }
  revalidatePath(`/admin/trends/${trendId}/eval`)
  return { ok: true }
}

/**
 * One-click "Approve & Go Live" — the streamlined path. Marks every latest
 * successful run (at the current prompt version) as passing, flips
 * `eval_status='passed'`, and activates the trend in a single action. The DB
 * eval-proof trigger is satisfied because we rate the runs `pass` first, and
 * the eval-gate CHECK passes because we set `eval_status='passed'` together
 * with `is_active=true`. Use this instead of the rate-each → mark → activate
 * ceremony when the admin has eyeballed the outputs and they look right.
 */
export async function approveAndGoLive(trendId: string): Promise<void> {
  const supabase = createServiceClient()

  const { data: trend } = await supabase
    .from('trends')
    .select('id, version')
    .eq('id', trendId)
    .maybeSingle()
  if (!trend) {
    redirect(`/admin/trends/${trendId}/eval?error=trend_not_found`)
  }

  // Latest run per input at the current version that actually produced an image.
  const { data: runRows } = await supabase
    .from('trend_eval_runs')
    .select('id, eval_input_id, output_url, created_at')
    .eq('trend_id', trendId)
    .eq('prompt_version', trend!.version)
    .order('created_at', { ascending: false })
  const latestByInput = new Map<string, { id: string; output_url: string | null }>()
  for (const r of (runRows ?? []) as Array<{
    id: string
    eval_input_id: string
    output_url: string | null
  }>) {
    if (!latestByInput.has(r.eval_input_id)) latestByInput.set(r.eval_input_id, r)
  }
  const successfulRunIds = [...latestByInput.values()].filter((r) => r.output_url).map((r) => r.id)

  if (successfulRunIds.length === 0) {
    redirect(
      `/admin/trends/${trendId}/eval?error=${encodeURIComponent('Run a successful test before going live')}`
    )
  }

  // Rate the reviewed runs pass → satisfies require_eval_proof_for_passed.
  await supabase.from('trend_eval_runs').update({ admin_rating: 'pass' }).in('id', successfulRunIds)

  // Flip eval + activation together (CHECK constraint + proof trigger both hold).
  const { error } = await supabase
    .from('trends')
    .update({ eval_status: 'passed', is_active: true })
    .eq('id', trendId)
  if (error) {
    redirect(`/admin/trends/${trendId}/eval?error=${encodeURIComponent(error.message)}`)
  }

  const authed = await createClient()
  const {
    data: { user },
  } = await authed.auth.getUser()
  await logAdminAction({
    adminId: user?.id ?? null,
    action: 'trend_approve_and_go_live',
    targetTable: 'trends',
    targetId: trendId,
    after: { eval_status: 'passed', is_active: true },
  })

  revalidatePath(`/admin/trends/${trendId}/eval`)
  revalidatePath('/admin/trends')
  revalidatePath(`/admin/trends/${trendId}/edit`)
  redirect(`/admin/trends/${trendId}/eval?live=1`)
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
