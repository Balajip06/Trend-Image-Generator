import { Reveal } from '@/components/admin/Reveal'
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
    <section className="flex flex-col gap-8">
      <Reveal as="section">
        <header className="flex flex-col gap-2">
          <p className="text-muted-foreground text-xs font-semibold tracking-[0.2em] uppercase">
            Operations
          </p>
          <h1 className="text-3xl font-extrabold tracking-tight">
            <span className="text-gradient-hero">Live</span> monitor
          </h1>
          <p className="text-muted-foreground text-sm">
            Real-time feed of every generation as it happens — authenticated + anonymous trials.
          </p>
        </header>
      </Reveal>
      <Reveal delay={80}>
        <GenerationsMonitor
          initialFeed={(feedRows ?? []) as FeedRow[]}
          initialAnon={anonRows ?? []}
        />
      </Reveal>
    </section>
  )
}
