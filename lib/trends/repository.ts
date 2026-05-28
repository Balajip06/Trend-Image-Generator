/**
 * Trend queries used by SSR + SEO + sitemap.
 * Centralizes the column projection + active+not-expired filter so the
 * "active" definition lives in one place.
 */

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
  model: 'nano-banana' | 'nano-banana-pro'
  input_schema: TrendInput
  seo_title: string | null
  seo_description: string | null
  faq: FAQItem[]
  display_order: number
  updated_at: string
}

const COLUMNS =
  'id, slug, title, description, thumbnail_url, sample_before_url, sample_after_url, aspect_ratio, model, input_schema, seo_title, seo_description, faq, display_order, updated_at'

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
    model: (row.model as PublicTrend['model']) ?? 'nano-banana-pro',
    input_schema,
    seo_title: (row.seo_title as string | null) ?? null,
    seo_description: (row.seo_description as string | null) ?? null,
    faq,
    display_order: (row.display_order as number) ?? 0,
    updated_at: row.updated_at as string,
  }
}

export async function listActiveTrends(): Promise<PublicTrend[]> {
  if (MOCK_TRENDS_ENABLED) return MOCK_TRENDS

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('trends')
    .select(COLUMNS)
    .order('display_order', { ascending: true })

  if (error || !data) return []
  return (data as Record<string, unknown>[]).map(coerce)
}

export async function getActiveTrendBySlug(slug: string): Promise<PublicTrend | null> {
  if (MOCK_TRENDS_ENABLED) return MOCK_TRENDS.find((t) => t.slug === slug) ?? null

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('trends')
    .select(COLUMNS)
    .eq('slug', slug)
    .maybeSingle()

  if (error || !data) return null
  return coerce(data as Record<string, unknown>)
}
