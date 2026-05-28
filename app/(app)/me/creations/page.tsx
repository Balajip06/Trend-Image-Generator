import { ImageIcon } from 'lucide-react'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { GradientButton } from '@/components/brand/GradientButton'
import { Badge } from '@/components/ui/badge'
import { MOCK_GENERATIONS, MOCK_TRENDS_ENABLED } from '@/lib/dev/mock-data'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

interface CreationRow {
  id: string
  trend_id: string
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'failed_retryable'
  output_image_url: string | null
  created_at: string
  purge_at: string | null
}

const STATUS_BADGE: Record<CreationRow['status'], { label: string; cls: string }> = {
  pending: { label: 'Queued', cls: 'bg-muted text-foreground/70' },
  processing: { label: 'Cooking', cls: 'bg-[var(--brand-cyan)]/15 text-[var(--brand-cyan)]' },
  completed: { label: 'Done', cls: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300' },
  failed_retryable: { label: 'Retrying', cls: 'bg-amber-500/15 text-amber-700 dark:text-amber-300' },
  failed: { label: 'Failed', cls: 'bg-destructive/15 text-destructive' },
}

export default async function CreationsPage() {
  let creations: CreationRow[]

  if (MOCK_TRENDS_ENABLED) {
    creations = MOCK_GENERATIONS.map((g) => ({
      id: g.id,
      trend_id: g.trend_id,
      status: g.status,
      output_image_url: g.output_image_url,
      created_at: g.created_at,
      purge_at: g.purge_at,
    }))
  } else {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) redirect('/login?next=/me/creations')

    const { data: rows } = await supabase
      .from('generations')
      .select('id, trend_id, status, output_image_url, created_at, purge_at')
      .order('created_at', { ascending: false })
      .limit(60)

    creations = ((rows as unknown as CreationRow[]) ?? []).filter(Boolean)
  }

  const completed = creations.filter((c) => c.status === 'completed').length

  return (
    <section className="flex flex-col gap-8">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-4xl font-extrabold tracking-tight">
            Your <span className="text-gradient-hero">creations</span>
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {completed} ready · Free-tier renders purge 30 days after creation.
          </p>
        </div>
        <GradientButton size="md" asChild>
          <Link href="/">Pick a new trend</Link>
        </GradientButton>
      </header>

      {creations.length === 0 ? (
        <div className="flex flex-col items-center gap-4 rounded-3xl border border-dashed border-border/60 bg-card/40 p-16 text-center">
          <div className="grid size-14 place-items-center rounded-full bg-gradient-hero text-white shadow-glow-pink">
            <ImageIcon className="size-6" />
          </div>
          <div>
            <p className="text-lg font-bold">No creations yet</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Make your first trend in seconds.
            </p>
          </div>
          <GradientButton asChild size="md">
            <Link href="/">Pick a trend</Link>
          </GradientButton>
        </div>
      ) : (
        <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {creations.map((c, idx) => (
            <li
              key={c.id}
              className="animate-fade-up"
              style={{ animationDelay: `${idx * 60}ms` }}
            >
              <Link
                href={`/result/${c.id}`}
                className="group relative block aspect-square overflow-hidden rounded-2xl border border-border/60 bg-card transition-transform hover:-translate-y-1 hover:shadow-pop"
              >
                {c.output_image_url ? (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img
                    src={c.output_image_url}
                    alt="Creation"
                    className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-105"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center bg-gradient-hero/30 text-xs text-foreground">
                    {STATUS_BADGE[c.status].label}
                  </div>
                )}
                <div className="absolute left-2 top-2">
                  <Badge className={`rounded-full px-2.5 py-0.5 text-[10px] font-semibold ${STATUS_BADGE[c.status].cls}`}>
                    {STATUS_BADGE[c.status].label}
                  </Badge>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
