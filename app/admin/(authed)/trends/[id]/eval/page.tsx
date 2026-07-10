import Link from 'next/link'
import { notFound } from 'next/navigation'
import { FlashToasts } from '@/components/admin/FlashToasts'
import { Button } from '@/components/ui/button'
import { createServiceClient } from '@/lib/supabase/server'
import { EvalWorkflow } from './EvalWorkflow'
import { addEvalInput } from './actions'

// runEval's server action can take 170s for gpt-image-2 image-edit calls —
// Vercel's default function duration is well under that. Server Actions
// inherit the duration of the page that invokes them.
export const maxDuration = 180

export const dynamic = 'force-dynamic'

interface EvalRunRow {
  id: string
  trend_id: string
  prompt_version: number
  eval_input_id: string
  output_url: string | null
  admin_rating: string | null
  model: string | null
  created_at: string
}

interface EvalPageProps {
  params: Promise<{ id: string }>
  searchParams: Promise<{
    error?: string
    added?: string
    'marked-passed'?: string
    'marked-failed'?: string
    live?: string
    activated?: string
    deactivated?: string
  }>
}

export default async function EvalPage({ params, searchParams }: EvalPageProps) {
  const { id } = await params
  await searchParams // consumed by FlashToasts client-side

  // Service-role: trend_eval_inputs + trend_eval_runs have RLS enabled with
  // no SELECT policy (deny-all to the authed client), so the eval grid would
  // render empty even when test inputs/runs exist. Proxy.ts gates /admin to
  // admins; service-role is the correct read for this admin-only workflow.
  const supabase = createServiceClient()

  const { data: trendRow } = await supabase
    .from('trends')
    .select('id, slug, title, model, version, eval_status, is_active')
    .eq('id', id)
    .maybeSingle()
  const trend = trendRow
  if (!trend) notFound()

  const { data: inputRows } = await supabase
    .from('trend_eval_inputs')
    .select('id, label, image_url, created_at')
    .eq('trend_id', id)
    .order('created_at', { ascending: true })
  const inputs = (inputRows ?? []).filter(Boolean)

  const { data: runRows } = await supabase
    .from('trend_eval_runs')
    .select('id, trend_id, prompt_version, eval_input_id, output_url, admin_rating, model, created_at')
    .eq('trend_id', id)
    .order('created_at', { ascending: false })
    .limit(inputs.length || 10)
  const latestRuns = (runRows ?? []).reduce<Record<string, EvalRunRow>>((acc, run) => {
    if (!acc[run.eval_input_id]) acc[run.eval_input_id] = run
    return acc
  }, {})

  async function boundAdd(formData: FormData): Promise<void> {
    'use server'
    await addEvalInput(id, formData)
  }

  return (
    <section className="flex flex-col gap-6">
      <FlashToasts
        flashes={[
          { key: 'error', level: 'error' },
          { key: 'added', level: 'success', message: 'Reference photo added.' },
          {
            key: 'marked-passed',
            level: 'success',
            message: 'Trend eval marked passed. Activate from Edit page.',
          },
          { key: 'marked-failed', level: 'success', message: 'Trend eval marked failed.' },
          { key: 'live', level: 'success', message: 'Trend approved and live for customers. 🎉' },
          { key: 'activated', level: 'success', message: 'Trend activated.' },
          { key: 'deactivated', level: 'info', message: 'Trend deactivated.' },
        ]}
      />

      <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-muted-foreground text-xs font-semibold tracking-[0.2em] uppercase">
            Test preview workflow
          </p>
          <h1 className="text-4xl font-extrabold tracking-tight">{trend.title}</h1>
          <div className="text-muted-foreground mt-2 flex flex-wrap items-center gap-2 text-xs">
            <code className="bg-muted rounded px-1.5 py-0.5">/{trend.slug}</code>
            <span>·</span>
            <span>v{trend.version}</span>
            <span>·</span>
            <span className="font-mono">{trend.model}</span>
          </div>
        </div>
        <Button asChild variant="ghost" size="sm">
          <Link href={`/admin/trends/${trend.id}/edit`}>← Edit trend</Link>
        </Button>
      </header>

      <EvalWorkflow
        trend={trend}
        inputs={inputs}
        latestRuns={latestRuns}
        addEvalInputAction={boundAdd}
      />
    </section>
  )
}
