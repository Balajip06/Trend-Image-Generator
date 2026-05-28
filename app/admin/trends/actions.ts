'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { TrendInputSchema } from '@/lib/trends/input-schema'
import { createClient } from '@/lib/supabase/server'

const FAQEntrySchema = z.object({
  question: z.string().min(1).max(300),
  answer: z.string().min(1).max(2000),
})
const FAQSchema = z.array(FAQEntrySchema).max(20)

const TrendUpsertSchema = z.object({
  slug: z
    .string()
    .min(1)
    .max(120)
    .regex(/^[a-z][a-z0-9-]*$/, 'lowercase kebab-case starting with a letter'),
  title: z.string().min(1).max(200),
  description: z.string().max(1000).optional().nullable(),
  prompt_template: z.string().min(10).max(2000),
  model: z.enum(['nano-banana', 'nano-banana-pro']),
  aspect_ratio: z.enum(['1:1', '3:4', '16:9', '9:16']),
  display_order: z.coerce.number().int().min(0).max(9999).default(0),
  thumbnail_url: z.string().url().optional().nullable(),
  sample_before_url: z.string().url().optional().nullable(),
  sample_after_url: z.string().url().optional().nullable(),
  seo_title: z.string().max(200).optional().nullable(),
  seo_description: z.string().max(300).optional().nullable(),
  input_schema: z.unknown(),
  faq: z.unknown(),
})

function parseJsonField<T>(raw: string | null, schema: z.ZodSchema<T>, fieldName: string): T {
  if (!raw || raw.trim() === '') {
    return schema.parse(undefined)
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error(`${fieldName}: invalid JSON`)
  }
  const result = schema.safeParse(parsed)
  if (!result.success) {
    throw new Error(`${fieldName}: ${result.error.issues[0]?.message ?? 'invalid shape'}`)
  }
  return result.data
}

function emptyToNull(v: FormDataEntryValue | null): string | null {
  if (typeof v !== 'string') return null
  const s = v.trim()
  return s === '' ? null : s
}

function readTrendForm(formData: FormData): z.infer<typeof TrendUpsertSchema> {
  const inputSchemaRaw = (formData.get('input_schema') as string | null) ?? null
  const faqRaw = (formData.get('faq') as string | null) ?? null

  const input_schema = parseJsonField(inputSchemaRaw, TrendInputSchema, 'input_schema')
  const faq = parseJsonField(faqRaw, FAQSchema, 'faq')

  const parsed = TrendUpsertSchema.safeParse({
    slug: formData.get('slug'),
    title: formData.get('title'),
    description: emptyToNull(formData.get('description')),
    prompt_template: formData.get('prompt_template'),
    model: formData.get('model'),
    aspect_ratio: formData.get('aspect_ratio'),
    display_order: formData.get('display_order'),
    thumbnail_url: emptyToNull(formData.get('thumbnail_url')),
    sample_before_url: emptyToNull(formData.get('sample_before_url')),
    sample_after_url: emptyToNull(formData.get('sample_after_url')),
    seo_title: emptyToNull(formData.get('seo_title')),
    seo_description: emptyToNull(formData.get('seo_description')),
    input_schema,
    faq,
  })
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? 'invalid form data')
  }
  return parsed.data
}

export async function createTrend(formData: FormData): Promise<void> {
  const supabase = await createClient()
  let data
  try {
    data = readTrendForm(formData)
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'invalid'
    redirect(`/admin/trends/new?error=${encodeURIComponent(msg)}`)
  }

  const {
    data: { user },
  } = await supabase.auth.getUser()
  // Cast required until `pnpm supabase:types` regenerates strict Database types.
  const insertRow = {
    ...data,
    created_by: user?.id ?? null,
    is_active: false, // drafts start inactive; activation requires eval_status='passed'
  } as never

  const { data: inserted, error } = await supabase
    .from('trends')
    .insert(insertRow)
    .select('id')
    .maybeSingle()
  if (error) {
    redirect(`/admin/trends/new?error=${encodeURIComponent(error.message)}`)
  }
  const id = (inserted as { id?: string } | null)?.id
  revalidatePath('/admin/trends')
  redirect(id ? `/admin/trends/${id}/edit?created=1` : '/admin/trends')
}

export async function updateTrend(id: string, formData: FormData): Promise<void> {
  const supabase = await createClient()
  let data
  try {
    data = readTrendForm(formData)
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'invalid'
    redirect(`/admin/trends/${id}/edit?error=${encodeURIComponent(msg)}`)
  }

  const update = data as never
  const { error } = await supabase.from('trends').update(update).eq('id', id)
  if (error) {
    redirect(`/admin/trends/${id}/edit?error=${encodeURIComponent(error.message)}`)
  }
  revalidatePath('/admin/trends')
  revalidatePath(`/admin/trends/${id}/edit`)
  revalidatePath(`/trend/${data.slug}`)
  redirect(`/admin/trends/${id}/edit?saved=1`)
}

export async function toggleActive(id: string, nextValue: boolean): Promise<void> {
  const supabase = await createClient()
  const update = { is_active: nextValue } as never
  const { error } = await supabase.from('trends').update(update).eq('id', id)
  if (error) {
    redirect(`/admin/trends/${id}/edit?error=${encodeURIComponent(error.message)}`)
  }
  revalidatePath('/admin/trends')
  revalidatePath(`/admin/trends/${id}/edit`)
  redirect(`/admin/trends/${id}/edit?${nextValue ? 'activated' : 'deactivated'}=1`)
}
