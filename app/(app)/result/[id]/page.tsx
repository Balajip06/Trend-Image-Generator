import { notFound, redirect } from 'next/navigation'
import {
  findMockGeneration,
  findMockTrendById,
  MOCK_TRENDS_ENABLED,
  MOCK_USER,
} from '@/lib/dev/mock-data'
import { createClient } from '@/lib/supabase/server'
import { ResultView } from './ResultView'

export const dynamic = 'force-dynamic'

interface InitialRow {
  id: string
  user_id: string
  trend_id: string
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'failed_retryable'
  output_image_url: string | null
  error_message: string | null
  attempts: number
  idempotency_key: string
  created_at: string
  cost_usd: number
  completed_at: string | null
}

interface TrendBrief {
  slug: string
  title: string
}

interface ResultPageProps {
  params: Promise<{ id: string }>
}

export default async function ResultPage({ params }: ResultPageProps) {
  const { id } = await params

  if (MOCK_TRENDS_ENABLED && id.startsWith('mock-')) {
    const mockGen = findMockGeneration(id)
    if (!mockGen) notFound()
    const mockTrend = findMockTrendById(mockGen.trend_id)
    const initial: InitialRow = {
      id: mockGen.id,
      user_id: MOCK_USER.id,
      trend_id: mockGen.trend_id,
      status: mockGen.status,
      output_image_url: mockGen.output_image_url,
      error_message: mockGen.error_message,
      attempts: mockGen.attempts,
      idempotency_key: mockGen.idempotency_key,
      created_at: mockGen.created_at,
      cost_usd: mockGen.cost_usd,
      completed_at: mockGen.completed_at,
    }
    const trend: TrendBrief = mockTrend
      ? { slug: mockTrend.slug, title: mockTrend.title }
      : { slug: 'unknown', title: 'Trend' }
    return <ResultView initial={initial} trend={trend} />
  }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect(`/login?next=/result/${id}`)

  const { data: row } = await supabase
    .from('generations')
    .select('id, user_id, trend_id, status, output_image_url, error_message, attempts, idempotency_key, created_at, cost_usd, completed_at')
    .eq('id', id)
    .maybeSingle()

  const gen = row as unknown as InitialRow | null
  if (!gen) notFound()
  if (gen.user_id !== user.id) notFound() // hide via 404 rather than 403 to avoid id-leaks

  const { data: trendRow } = await supabase
    .from('trends')
    .select('slug, title')
    .eq('id', gen.trend_id)
    .maybeSingle()
  const trend = (trendRow as unknown as TrendBrief | null) ?? { slug: 'unknown', title: 'Trend' }

  return <ResultView initial={gen} trend={trend} />
}
