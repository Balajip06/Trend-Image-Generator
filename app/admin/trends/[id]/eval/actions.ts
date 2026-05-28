'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { generateImage } from '@/lib/gemini/client'
import { createServiceClient } from '@/lib/supabase/server'

interface TrendForEval {
  id: string
  prompt_template: string
  model: 'nano-banana' | 'nano-banana-pro'
  version: number
}

interface EvalInputRow {
  id: string
  image_url: string
}

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
  const insertRow = { trend_id: trendId, ...parsed.data } as never
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
 * Uploads each Gemini output to outputs/eval/<trend_id>/<run_id>.png and
 * inserts a trend_eval_runs row. Falls back to mock-mode when GEMINI_API_KEY
 * is missing so the workflow can be exercised locally.
 *
 * Note: text-field placeholder substitution is skipped — eval inputs are
 * images-only; trends with required text fields need a richer eval flow
 * (out of scope for v1).
 */
export async function runEval(trendId: string): Promise<void> {
  const supabase = createServiceClient()

  const { data: trendRow } = await supabase
    .from('trends')
    .select('id, prompt_template, model, version')
    .eq('id', trendId)
    .maybeSingle()
  const trend = trendRow as unknown as TrendForEval | null
  if (!trend) {
    redirect(`/admin/trends/${trendId}/eval?error=trend_not_found`)
  }

  const { data: inputRows } = await supabase
    .from('trend_eval_inputs')
    .select('id, image_url')
    .eq('trend_id', trendId)
  const inputs = (inputRows as unknown as EvalInputRow[] | null) ?? []
  if (inputs.length === 0) {
    redirect(`/admin/trends/${trendId}/eval?error=no_inputs`)
  }

  await Promise.allSettled(
    inputs.map(async (input) => {
      const insertRow = {
        trend_id: trendId,
        prompt_version: trend!.version,
        eval_input_id: input.id,
      } as never
      const { data: created, error: insertErr } = await supabase
        .from('trend_eval_runs')
        .insert(insertRow)
        .select('id')
        .maybeSingle()
      if (insertErr || !created) return
      const runId = (created as { id: string }).id

      const result = await generateImage({
        model: trend!.model,
        prompt: trend!.prompt_template,
        imageUrls: [input.image_url],
      })
      if (!result.ok) {
        const update = { output_url: null, admin_rating: `error:${result.reason}` } as never
        await supabase.from('trend_eval_runs').update(update).eq('id', runId)
        return
      }

      const path = `eval/${trendId}/${runId}.png`
      const { error: uploadErr } = await supabase.storage
        .from('outputs')
        .upload(path, result.outputPng, { contentType: 'image/png', upsert: true })
      if (uploadErr) return

      const { data: publicUrl } = supabase.storage.from('outputs').getPublicUrl(path)
      const update = { output_url: publicUrl.publicUrl } as never
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
  const update = { admin_rating: rating } as never
  await supabase.from('trend_eval_runs').update(update).eq('id', runId)
  revalidatePath(`/admin/trends/${trendId}/eval`)
}

export async function markTrendEval(
  trendId: string,
  status: 'passed' | 'failed' | 'untested'
): Promise<void> {
  const supabase = createServiceClient()
  const update = { eval_status: status } as never
  const { error } = await supabase.from('trends').update(update).eq('id', trendId)
  if (error) {
    redirect(`/admin/trends/${trendId}/eval?error=${encodeURIComponent(error.message)}`)
  }
  revalidatePath(`/admin/trends/${trendId}/eval`)
  revalidatePath('/admin/trends')
  revalidatePath(`/admin/trends/${trendId}/edit`)
  redirect(`/admin/trends/${trendId}/eval?marked-${status}=1`)
}
