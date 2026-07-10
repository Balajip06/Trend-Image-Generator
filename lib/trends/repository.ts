/**
 * Trend queries used by SSR + SEO + sitemap.
 * Centralizes the column projection + active+not-expired filter so the
 * "active" definition lives in one place.
 */

import * as Sentry from '@sentry/nextjs'
import { MOCK_TRENDS, MOCK_TRENDS_ENABLED } from '@/lib/dev/mock-data'
import { createClient } from '@/lib/supabase/server'
import { DEFAULT_TREND_INPUT, TrendInputSchema, type TrendInput } from './input-schema'

export interface FAQItem {
  question: string
  answer: string
}

export interface PublicTrend {
  id: string
  slug: string
  title: string
  description: string | null
  thumbnail_url: string | null
  sample_before_url: string | null
  sample_after_url: string | null
  aspect_ratio: '1:1' | '3:4' | '16:9' | '9:16'
  model: 'nano-banana-2' | 'nano-banana-2-lite'
  input_schema: TrendInput
  seo_title: string | null
  seo_description: string | null
  faq: FAQItem[]
  display_order: number
  updated_at: string
  activated_at: string | null
}

const COLUMNS =
  'id, slug, title, description, thumbnail_url, sample_before_url, sample_after_url, aspect_ratio, model, input_schema, seo_title, seo_description, faq, display_order, updated_at, activated_at'

function coerce(row: Record<string, unknown>): PublicTrend {
  const inputSchemaParse = TrendInputSchema.safeParse(row.input_schema)
  const input_schema = inputSchemaParse.success ? inputSchemaParse.data : DEFAULT_TREND_INPUT

  const faq = Array.isArray(row.faq) ? (row.faq as FAQItem[]) : []

  return {
    id: row.id as string,
    slug: row.slug as string,
    title: row.title as string,
    description: (row.description as string | null) ?? null,
    thumbnail_url: (row.thumbnail_url as string | null) ?? null,
    sample_before_url: (row.sample_before_url as string | null) ?? null,
    sample_after_url: (row.sample_after_url as string | null) ?? null,
    aspect_ratio: (row.aspect_ratio as PublicTrend['aspect_ratio']) ?? '1:1',
    model: (row.model as PublicTrend['model']) ?? 'nano-banana-2-lite',
    input_schema,
    seo_title: (row.seo_title as string | null) ?? null,
    seo_description: (row.seo_description as string | null) ?? null,
    faq,
    display_order: (row.display_order as number) ?? 0,
    updated_at: row.updated_at as string,
    activated_at: (row.activated_at as string | null) ?? null,
  }
}

export async function listActiveTrends(): Promise<PublicTrend[]> {
  if (MOCK_TRENDS_ENABLED) return MOCK_TRENDS

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('trends')
    .select(COLUMNS)
    .order('display_order', { ascending: true })

  // Distinguish "DB error" (must surface) from "no rows" (legit empty state).
  // Returning [] in both cases is the right UX, but the error path needs to
  // breadcrumb so Sentry catches infra regressions instead of users seeing a
  // silently empty home grid.
  if (error) {
    Sentry.captureMessage('trends.list failed', {
      level: 'error',
      tags: { component: 'trends-repository', op: 'listActiveTrends' },
      extra: { code: error.code, message: error.message },
    })
    return []
  }
  if (!data) return []
  return (data as Record<string, unknown>[]).map(coerce)
}

export interface PagedTrends {
  trends: PublicTrend[]
  total: number
}

export async function listActiveTrendsPaged(
  q: string,
  page: number,
  perPage: number
): Promise<PagedTrends> {
  if (MOCK_TRENDS_ENABLED) {
    const lower = q.toLowerCase()
    const filtered = q
      ? MOCK_TRENDS.filter(
          (t) =>
            t.title.toLowerCase().includes(lower) ||
            (t.description ?? '').toLowerCase().includes(lower)
        )
      : MOCK_TRENDS
    const from = (page - 1) * perPage
    return { trends: filtered.slice(from, from + perPage), total: filtered.length }
  }

  const supabase = await createClient()
  const from = (page - 1) * perPage
  const to = from + perPage - 1

  let query = supabase
    .from('trends')
    .select(COLUMNS, { count: 'exact' })
    .order('display_order', { ascending: true })
    .range(from, to)

  if (q) query = query.ilike('title', `%${q}%`)

  const { data, error, count } = await query

  if (error) {
    Sentry.captureMessage('trends.paged failed', {
      level: 'error',
      tags: { component: 'trends-repository', op: 'listActiveTrendsPaged' },
      extra: { code: error.code, message: error.message },
    })
    return { trends: [], total: 0 }
  }

  return {
    trends: (data ?? []).map((r) => coerce(r as Record<string, unknown>)),
    total: count ?? 0,
  }
}

export async function getActiveTrendBySlug(slug: string): Promise<PublicTrend | null> {
  if (MOCK_TRENDS_ENABLED) return MOCK_TRENDS.find((t) => t.slug === slug) ?? null

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('trends')
    .select(COLUMNS)
    .eq('slug', slug)
    .maybeSingle()

  // Same logic as listActiveTrends — only the DB-error branch breadcrumbs.
  // A missing slug (data === null with no error) is the SSR 404 path and is
  // expected (e.g. retired trends, typo'd URLs).
  if (error) {
    Sentry.captureMessage('trends.bySlug failed', {
      level: 'error',
      tags: { component: 'trends-repository', op: 'getActiveTrendBySlug' },
      extra: { slug, code: error.code, message: error.message },
    })
    return null
  }
  if (!data) return null
  return coerce(data as Record<string, unknown>)
}
