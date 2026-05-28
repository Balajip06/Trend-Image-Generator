'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import {
  TrendSuggestionPayloadSchema,
  type AutoSuggestionPayload,
} from '@/lib/trends/suggestions/payload'
import { createClient } from '@/lib/supabase/server'

interface SuggestionRow {
  id: string
  source: 'auto' | 'user'
  payload: unknown
  status: string
}

async function loadAndValidate(suggestionId: string): Promise<{
  row: SuggestionRow
  payload: ReturnType<typeof TrendSuggestionPayloadSchema.parse>
}> {
  const supabase = await createClient()
  const { data } = await supabase
    .from('trend_suggestions')
    .select('id, source, payload, status')
    .eq('id', suggestionId)
    .maybeSingle()
  const row = data as unknown as SuggestionRow | null
  if (!row) {
    redirect('/admin/suggestions?error=not_found')
  }
  if (row.status !== 'pending') {
    redirect(`/admin/suggestions?error=${encodeURIComponent('already reviewed')}`)
  }
  const parsed = TrendSuggestionPayloadSchema.safeParse(row.payload)
  if (!parsed.success) {
    redirect(`/admin/suggestions?error=${encodeURIComponent('payload invalid: ' + (parsed.error.issues[0]?.message ?? ''))}`)
  }
  return { row, payload: parsed.data }
}

async function markReviewed(
  suggestionId: string,
  status: 'approved' | 'rejected'
): Promise<void> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  const update = {
    status,
    reviewed_by: user?.id ?? null,
    reviewed_at: new Date().toISOString(),
  } as never
  await supabase.from('trend_suggestions').update(update).eq('id', suggestionId)
}

export async function approveAutoSuggestion(suggestionId: string): Promise<void> {
  const { row, payload } = await loadAndValidate(suggestionId)
  if (row.source !== 'auto' || payload.type !== 'auto') {
    redirect(`/admin/suggestions?error=${encodeURIComponent('only auto suggestions can be auto-approved')}`)
  }
  const auto = payload as AutoSuggestionPayload
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const insertRow = {
    slug: auto.proposal.suggested_slug,
    title: auto.proposal.suggested_title,
    description: auto.proposal.suggested_description,
    prompt_template: auto.proposal.prompt_template,
    model: auto.proposal.model,
    input_schema: auto.proposal.input_schema,
    aspect_ratio: '1:1',
    display_order: 0,
    is_active: false,
    created_by: user?.id ?? null,
  } as never

  const { data: created, error: insertError } = await supabase
    .from('trends')
    .insert(insertRow)
    .select('id')
    .maybeSingle()

  if (insertError) {
    const msg = insertError.message.includes('duplicate key')
      ? `slug "${auto.proposal.suggested_slug}" already exists — edit manually`
      : insertError.message
    redirect(`/admin/suggestions?error=${encodeURIComponent(msg)}`)
  }

  await markReviewed(suggestionId, 'approved')

  revalidatePath('/admin/suggestions')
  revalidatePath('/admin/trends')

  const newTrendId = (created as { id?: string } | null)?.id
  redirect(newTrendId ? `/admin/trends/${newTrendId}/edit?created=1` : '/admin/trends')
}

export async function rejectSuggestion(suggestionId: string): Promise<void> {
  await loadAndValidate(suggestionId)
  await markReviewed(suggestionId, 'rejected')
  revalidatePath('/admin/suggestions')
  redirect('/admin/suggestions?rejected=1')
}
