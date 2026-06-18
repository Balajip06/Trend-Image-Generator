import { createServiceClient } from '@/lib/supabase/server'
import type { Tables } from '@/lib/supabase/database.types'
import { GenerationsMonitor } from './GenerationsMonitor'

export const dynamic = 'force-dynamic'

export type FeedRow = Tables<'admin_generations_feed'>

export default async function GenerationsPage() {
  const service = createServiceClient()

  // Initial 100 rows from admin_generations_feed (authed gens).
  const { data: feedRows } = await service
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
