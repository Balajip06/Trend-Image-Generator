'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { logAdminAction } from '@/lib/admin/audit'
import {
  DEFAULT_TREND_INPUT,
  FAQSchema,
  TrendInputSchema,
  faqToJson,
  trendInputToJson,
  type FAQ,
  type TrendInput,
} from '@/lib/trends/input-schema'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import type { Json } from '@/lib/supabase/database.types'

/**
 * Resolve the acting admin's id for the audit trail. Trend writes run on the
 * service client (the `trends` table has RLS enabled with read-only public
 * policies and no admin write policy, so the authed client cannot write), but
 * the audit log still needs the real actor — read it from the authed session.
 * /admin is gated to admins upstream in proxy.ts.
 */
async function adminActorId(): Promise<string | null> {
  const authed = await createClient()
  const {
    data: { user },
  } = await authed.auth.getUser()
  return user?.id ?? null
}

const TrendUpsertSchema = z.object({
  slug: z
    .string()
    .min(1)
    .max(120)
    .regex(/^[a-z][a-z0-9-]*$/, 'lowercase kebab-case starting with a letter'),
  title: z.string().min(1).max(200),
  description: z.string().max(1000).optional().nullable(),
  prompt_template: z.string().min(10).max(2000),
  model: z.enum(['nano-banana-2', 'nano-banana-2-lite', 'gpt-image-2']),
  model_pinned: z.coerce.boolean().default(true),
  aspect_ratio: z.enum(['1:1', '3:4', '16:9', '9:16']),
  display_order: z.coerce.number().int().min(0).max(9999).default(0),
  thumbnail_url: z.string().url().optional().nullable(),
  sample_before_url: z.string().url().optional().nullable(),
  sample_after_url: z.string().url().optional().nullable(),
  seo_title: z.string().max(200).optional().nullable(),
  seo_description: z.string().max(300).optional().nullable(),
  share_caption_template: z.string().max(300).optional().nullable(),
  input_schema: z.unknown(),
  faq: z.unknown(),
  // Lifecycle (Phase 7+): scheduling, featured, auto-deactivate guards.
  goes_live_at: z.string().datetime().nullable().optional(),
  is_featured: z.boolean().default(false),
  auto_deactivate_disabled: z.boolean().default(false),
  auto_deactivate_threshold: z.coerce.number().int().min(1).max(100).default(5),
})

function parseJsonField<T>(
  raw: string | null,
  schema: z.ZodSchema<T>,
  fieldName: string,
  fallback: T
): T {
  // Empty/whitespace form fields fall back to the supplied default — the
  // schema itself isn't required to have a `.default()`, so this keeps the
  // upstream Zod schemas (used elsewhere) unchanged while letting admin forms
  // submit a blank FAQ etc.
  if (!raw || raw.trim() === '') return fallback
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

function checkboxOn(v: FormDataEntryValue | null): boolean {
  return v === 'on' || v === '1' || v === 'true'
}

// datetime-local inputs submit "YYYY-MM-DDTHH:MM" (no seconds, no zone). Zod's
// .datetime() requires full ISO-8601 with Z, so normalise here before parsing.
function datetimeLocalToIso(v: FormDataEntryValue | null): string | null {
  if (typeof v !== 'string') return null
  const s = v.trim()
  if (s === '') return null
  // Treat naked datetime-local as local time, convert to ISO with offset.
  const d = new Date(s)
  if (Number.isNaN(d.getTime())) return null
  return d.toISOString()
}

// Magic-byte allowlist for raster image types only — file.type/file.name are
// client-controlled and trivially spoofable (e.g. an SVG containing a
// <script> tag renamed to thumbnail.jpg with type: 'image/jpeg' would pass a
// naive check and, served from the same origin as `outputs`, execute as
// stored XSS). Sniffing the real bytes and hard-rejecting SVG/HTML-capable
// types closes that off without pulling in a library for 4 signatures.
const IMAGE_SIGNATURES: Array<{ mime: string; ext: string; magic: number[] }> = [
  { mime: 'image/jpeg', ext: '.jpg', magic: [0xff, 0xd8, 0xff] },
  { mime: 'image/png', ext: '.png', magic: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { mime: 'image/gif', ext: '.gif', magic: [0x47, 0x49, 0x46, 0x38] },
  // WEBP: "RIFF"...."WEBP" — bytes 8-11 checked separately below.
  { mime: 'image/webp', ext: '.webp', magic: [0x52, 0x49, 0x46, 0x46] },
]

function sniffImageType(bytes: Uint8Array): { mime: string; ext: string } | null {
  for (const sig of IMAGE_SIGNATURES) {
    if (sig.magic.every((b, i) => bytes[i] === b)) {
      if (sig.mime === 'image/webp') {
        const webpTag = String.fromCharCode(...bytes.slice(8, 12))
        if (webpTag !== 'WEBP') continue
      }
      return { mime: sig.mime, ext: sig.ext }
    }
  }
  return null
}

/**
 * Uploads an admin-supplied trend thumbnail/sample image to the public
 * `outputs` bucket via the service client — the authed admin client has no
 * write policy on `outputs` (customer-facing bucket, service_role-only
 * writes per migration 20260528000002), so this proxies the write through
 * the server action instead of adding a new RLS policy.
 */
export async function uploadTrendImage(
  formData: FormData
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const file = formData.get('file')
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: 'No file provided.' }
  }

  const head = new Uint8Array(await file.slice(0, 16).arrayBuffer())
  const detected = sniffImageType(head)
  if (!detected) {
    return { ok: false, error: 'File must be a JPEG, PNG, GIF, or WEBP image.' }
  }

  const supabase = createServiceClient()
  const path = `trends/${crypto.randomUUID()}${detected.ext}`
  const { error: uploadErr } = await supabase.storage
    .from('outputs')
    .upload(path, file, { contentType: detected.mime, upsert: true })
  if (uploadErr) return { ok: false, error: uploadErr.message }

  const { data } = supabase.storage.from('outputs').getPublicUrl(path)
  return { ok: true, url: data.publicUrl }
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // strip combining diacritics
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 120)
}

function readTrendForm(formData: FormData): z.infer<typeof TrendUpsertSchema> {
  const inputSchemaRaw = (formData.get('input_schema') as string | null) ?? null
  const faqRaw = (formData.get('faq') as string | null) ?? null

  const input_schema = parseJsonField(
    inputSchemaRaw,
    TrendInputSchema,
    'input_schema',
    DEFAULT_TREND_INPUT
  )
  const faq = parseJsonField(faqRaw, FAQSchema, 'faq', [])

  const parsed = TrendUpsertSchema.safeParse({
    slug: formData.get('slug'),
    title: formData.get('title'),
    description: emptyToNull(formData.get('description')),
    prompt_template: formData.get('prompt_template'),
    model: formData.get('model'),
    model_pinned: formData.get('model_pinned'),
    aspect_ratio: formData.get('aspect_ratio'),
    display_order: formData.get('display_order'),
    thumbnail_url: emptyToNull(formData.get('thumbnail_url')),
    sample_before_url: emptyToNull(formData.get('sample_before_url')),
    sample_after_url: emptyToNull(formData.get('sample_after_url')),
    seo_title: emptyToNull(formData.get('seo_title')),
    seo_description: emptyToNull(formData.get('seo_description')),
    share_caption_template: emptyToNull(formData.get('share_caption_template')),
    input_schema,
    faq,
    goes_live_at: datetimeLocalToIso(formData.get('goes_live_at')),
    is_featured: checkboxOn(formData.get('is_featured')),
    auto_deactivate_disabled: checkboxOn(formData.get('auto_deactivate_disabled')),
    auto_deactivate_threshold: formData.get('auto_deactivate_threshold') ?? 5,
  })
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? 'invalid form data')
  }
  return parsed.data
}

export async function createTrend(formData: FormData): Promise<void> {
  const supabase = createServiceClient()
  let data
  try {
    data = readTrendForm(formData)
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'invalid'
    redirect(`/admin/trends/new?error=${encodeURIComponent(msg)}`)
  }

  const actorId = await adminActorId()
  // input_schema and faq are validated via parseJsonField against Zod schemas
  // (TrendInputSchema, FAQSchema). They flow through TrendUpsertSchema as
  // `unknown`, so narrow back through the typed helpers before insert.
  const insertRow = {
    ...data,
    input_schema: trendInputToJson(data.input_schema as TrendInput),
    faq: faqToJson(data.faq as FAQ),
    created_by: actorId,
    is_active: false, // drafts start inactive; activation requires eval_status='passed'
  }

  const { data: inserted, error } = await supabase
    .from('trends')
    .insert(insertRow)
    .select('id')
    .maybeSingle()
  if (error) {
    redirect(`/admin/trends/new?error=${encodeURIComponent(error.message)}`)
  }
  const id = (inserted as { id?: string } | null)?.id
  await logAdminAction({
    adminId: actorId,
    action: 'create',
    targetTable: 'trends',
    targetId: id ?? null,
    after: { slug: data.slug, title: data.title, model: data.model },
  })
  revalidatePath('/admin/trends')
  redirect(id ? `/admin/trends/${id}/edit?created=1` : '/admin/trends')
}

export async function updateTrend(id: string, formData: FormData): Promise<void> {
  const supabase = createServiceClient()
  let data
  try {
    data = readTrendForm(formData)
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'invalid'
    redirect(`/admin/trends/${id}/edit?error=${encodeURIComponent(msg)}`)
  }

  // input_schema and faq are Zod-validated `unknown`; narrow back through the
  // typed helpers (see input-schema.ts) before update.
  const update = {
    ...data,
    input_schema: trendInputToJson(data.input_schema as TrendInput),
    faq: faqToJson(data.faq as FAQ),
  }
  const { error } = await supabase.from('trends').update(update).eq('id', id)
  if (error) {
    redirect(`/admin/trends/${id}/edit?error=${encodeURIComponent(error.message)}`)
  }
  const actorId = await adminActorId()
  await logAdminAction({
    adminId: actorId,
    action: 'update',
    targetTable: 'trends',
    targetId: id,
    after: { slug: data.slug, title: data.title, model: data.model },
  })
  revalidatePath('/admin/trends')
  revalidatePath(`/admin/trends/${id}/edit`)
  revalidatePath(`/trend/${data.slug}`)
  redirect(`/admin/trends/${id}/edit?saved=1`)
}

const IdSchema = z.string().uuid()

interface SourceTrendForClone {
  id: string
  title: string
  description: string | null
  prompt_template: string
  model: 'nano-banana-2' | 'nano-banana-2-lite'
  aspect_ratio: '1:1' | '3:4' | '16:9' | '9:16'
  display_order: number
  thumbnail_url: string | null
  sample_before_url: string | null
  sample_after_url: string | null
  seo_title: string | null
  seo_description: string | null
  input_schema: Json
  faq: Json
  goes_live_at: string | null
  auto_deactivate_threshold: number
  auto_deactivate_disabled: boolean
}

/**
 * Clones a trend into a fresh draft. Resets eval state + activation per the
 * eval gate (ADR 4) — the new row starts untested + inactive so an admin
 * must re-validate before shipping it. `cloned_from` records lineage for
 * future analytics + the audit trail.
 */
export async function cloneTrend(formData: FormData): Promise<void> {
  const idParse = IdSchema.safeParse(formData.get('id'))
  if (!idParse.success) {
    redirect('/admin/trends?error=invalid_id')
  }
  const sourceId = idParse.data
  const supabase = createServiceClient()

  const { data: src, error: readErr } = await supabase
    .from('trends')
    .select(
      'id, title, description, prompt_template, model, aspect_ratio, display_order, thumbnail_url, sample_before_url, sample_after_url, seo_title, seo_description, input_schema, faq, goes_live_at, auto_deactivate_threshold, auto_deactivate_disabled'
    )
    .eq('id', sourceId)
    .maybeSingle()

  if (readErr || !src) {
    const reason = readErr?.message ?? 'not_found'
    redirect(`/admin/trends?error=clone_failed&reason=${encodeURIComponent(reason)}`)
  }
  const source = src as unknown as SourceTrendForClone

  // Find an available slug — base, then base-2, base-3, … Red-team M8:
  // the previous implementation fired up to 50 individual SELECTs in a
  // sequential loop on the trends table. Collapse to a single
  // prefix-scan and pick the first integer suffix not in the returned
  // set. `slug` is unique-indexed so this scan is bounded by the number
  // of prior clones of this title — in practice 1.
  const base = slugify(`${source.title}-copy`) || 'trend-copy'
  const { data: collisions } = await supabase.from('trends').select('slug').like('slug', `${base}%`)
  const taken = new Set((collisions ?? []).map((r) => (r as { slug: string }).slug))
  let candidate = base
  if (taken.has(base)) {
    let suffix = 2
    while (taken.has(`${base}-${suffix}`) && suffix < 1000) suffix += 1
    candidate = `${base}-${suffix}`
  }

  const actorId = await adminActorId()

  const insertRow = {
    slug: candidate,
    title: `${source.title} (copy)`,
    description: source.description,
    prompt_template: source.prompt_template,
    model: source.model,
    aspect_ratio: source.aspect_ratio,
    display_order: source.display_order,
    thumbnail_url: source.thumbnail_url,
    sample_before_url: source.sample_before_url,
    sample_after_url: source.sample_after_url,
    seo_title: source.seo_title,
    seo_description: source.seo_description,
    // input_schema + faq were validated on the source row's insert (via
    // TrendInputSchema / FAQSchema in createTrend / updateTrend). Clone copies
    // the already-validated payload verbatim, narrowed back through the typed
    // helpers so the Database `Json` column type accepts the unknown source.
    input_schema: trendInputToJson(source.input_schema as TrendInput),
    faq: faqToJson(source.faq as FAQ),
    goes_live_at: source.goes_live_at,
    auto_deactivate_threshold: source.auto_deactivate_threshold,
    auto_deactivate_disabled: source.auto_deactivate_disabled,
    is_featured: false,
    is_active: false,
    eval_status: 'untested' as const,
    version: 1,
    cloned_from: source.id,
    created_by: actorId,
  }

  const { data: inserted, error: insertErr } = await supabase
    .from('trends')
    .insert(insertRow)
    .select('id')
    .maybeSingle()
  if (insertErr || !inserted) {
    const reason = insertErr?.message ?? 'insert_failed'
    redirect(`/admin/trends?error=clone_failed&reason=${encodeURIComponent(reason)}`)
  }
  const newId = (inserted as { id?: string } | null)?.id ?? null
  await logAdminAction({
    adminId: actorId,
    action: 'clone',
    targetTable: 'trends',
    targetId: newId,
    after: { cloned_from: source.id, slug: candidate },
  })
  revalidatePath('/admin/trends')
  redirect(newId ? `/admin/trends/${newId}/edit?cloned=1` : '/admin/trends?cloned=1')
}

const ToggleFeaturedSchema = z.object({
  id: z.string().uuid(),
  featured: z.enum(['0', '1']),
})

export async function toggleFeatured(formData: FormData): Promise<void> {
  const parsed = ToggleFeaturedSchema.safeParse({
    id: formData.get('id'),
    featured: formData.get('featured'),
  })
  if (!parsed.success) {
    redirect('/admin/trends?error=invalid_input')
  }
  const { id, featured } = parsed.data
  const nextValue = featured === '1'

  const supabase = createServiceClient()
  const { error } = await supabase.from('trends').update({ is_featured: nextValue }).eq('id', id)
  if (error) {
    redirect(`/admin/trends?error=${encodeURIComponent(error.message)}`)
  }
  const actorId = await adminActorId()
  await logAdminAction({
    adminId: actorId,
    action: nextValue ? 'feature' : 'unfeature',
    targetTable: 'trends',
    targetId: id,
    after: { is_featured: nextValue },
  })
  revalidatePath('/admin/trends')
  redirect(`/admin/trends?${nextValue ? 'featured=1' : 'unfeatured=1'}`)
}

const BumpOrderSchema = z.object({
  id: z.string().uuid(),
  direction: z.enum(['up', 'down']),
})

/**
 * Swaps a trend's display_order with the adjacent row in the given direction.
 * Supabase JS has no transactions, so we do two sequential updates — on
 * failure of the second, we attempt a best-effort revert. Audit-logged.
 */
export async function bumpOrder(formData: FormData): Promise<void> {
  const parsed = BumpOrderSchema.safeParse({
    id: formData.get('id'),
    direction: formData.get('direction'),
  })
  if (!parsed.success) {
    redirect('/admin/trends?error=invalid_input')
  }
  const { id, direction } = parsed.data
  const supabase = createServiceClient()

  const { data: currentRow } = await supabase
    .from('trends')
    .select('id, display_order')
    .eq('id', id)
    .maybeSingle()
  const current = currentRow as { id: string; display_order: number } | null
  if (!current) {
    redirect('/admin/trends?error=not_found')
  }

  // "up" → lower display_order (sorted desc to get closest); "down" → higher.
  const adjacentQuery =
    direction === 'up'
      ? supabase
          .from('trends')
          .select('id, display_order')
          .lt('display_order', current.display_order)
          .order('display_order', { ascending: false })
      : supabase
          .from('trends')
          .select('id, display_order')
          .gt('display_order', current.display_order)
          .order('display_order', { ascending: true })
  const { data: adjacentRow } = await adjacentQuery.limit(1).maybeSingle()
  const adjacent = adjacentRow as { id: string; display_order: number } | null
  if (!adjacent) {
    // Already at top/bottom — no-op.
    redirect('/admin/trends')
  }

  // Swap. Two updates — on second failure, revert the first.
  const a = current.display_order
  const b = adjacent.display_order
  const { error: e1 } = await supabase
    .from('trends')
    .update({ display_order: b })
    .eq('id', current.id)
  if (e1) {
    redirect(`/admin/trends?error=${encodeURIComponent(e1.message)}`)
  }
  const { error: e2 } = await supabase
    .from('trends')
    .update({ display_order: a })
    .eq('id', adjacent.id)
  if (e2) {
    // Best-effort revert.
    await supabase.from('trends').update({ display_order: a }).eq('id', current.id)
    redirect(`/admin/trends?error=${encodeURIComponent(e2.message)}`)
  }

  const actorId = await adminActorId()
  await logAdminAction({
    adminId: actorId,
    action: 'reorder',
    targetTable: 'trends',
    targetId: current.id,
    before: { display_order: a },
    after: { display_order: b, swapped_with: adjacent.id },
  })
  revalidatePath('/admin/trends')
  redirect('/admin/trends')
}

export async function toggleActive(
  id: string,
  nextValue: boolean,
  returnPath?: string
): Promise<void> {
  const base = returnPath ?? `/admin/trends/${id}/edit`
  const supabase = createServiceClient()
  const update = { is_active: nextValue }
  const { error } = await supabase.from('trends').update(update).eq('id', id)
  if (error) {
    redirect(`${base}?error=${encodeURIComponent(error.message)}`)
  }
  const actorId = await adminActorId()
  await logAdminAction({
    adminId: actorId,
    action: nextValue ? 'activate' : 'deactivate',
    targetTable: 'trends',
    targetId: id,
    after: { is_active: nextValue },
  })
  revalidatePath('/admin/trends')
  revalidatePath(`/admin/trends/${id}/edit`)
  revalidatePath(`/admin/trends/${id}/eval`)
  redirect(`${base}?${nextValue ? 'activated' : 'deactivated'}=1`)
}
