import { createServiceClient } from '@/lib/supabase/server'
import { GenerationsMonitor } from './GenerationsMonitor'

export const dynamic = 'force-dynamic'

// Type for the untyped admin_generations_feed view (until pnpm supabase:types regenerates)
export interface FeedRow {
  id: string
  user_id: string | null
  trend_slug: string | null
  status: string
  model_used: string | null
  attempts: number
  cost_usd: number
  created_at: string
  completed_at: string | null
}

export default async function GenerationsPage() {
  const service = createServiceClient()

  // Initial 100 rows from admin_generations_feed (authed gens).
  // as any cast required until pnpm supabase:types regenerates with the view.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: feedRows } = await (service as any)
    .from('admin_generations_feed')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(100)

  // Initial 50 rows from anonymous_attempts
  const { data: anonRows } = await service
    .from('anonymous_attempts')
    .select('id, status, cost_usd, created_at, completed_at, trend_id')
    .order('created_at', { ascending: false })
    .limit(50)

  return (
    <div className="flex flex-col gap-6 p-6">
      <header>
        <h1 className="text-xl font-semibold">Live Generations</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Real-time feed of all generation activity.
        </p>
      </header>
      <GenerationsMonitor
        initialFeed={(feedRows ?? []) as FeedRow[]}
        initialAnon={anonRows ?? []}
      />
    </div>
  )
}
