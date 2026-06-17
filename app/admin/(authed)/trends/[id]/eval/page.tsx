import { ArrowRight, Check, ImageOff, Play, Plus, Trash2, X } from 'lucide-react'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { FlashToasts } from '@/components/admin/FlashToasts'
import { ActiveBadge, EvalBadge } from '@/components/admin/StatusBadges'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { createServiceClient } from '@/lib/supabase/server'
import { cn } from '@/lib/utils/cn'
import { addEvalInput, markTrendEval, rateEvalRun, removeEvalInput, runEval } from './actions'

export const dynamic = 'force-dynamic'

interface EvalRunRow {
  id: string
  trend_id: string
  prompt_version: number
  eval_input_id: string
  output_url: string | null
  admin_rating: string | null
  created_at: string
}

interface EvalPageProps {
  params: Promise<{ id: string }>
  searchParams: Promise<{
    error?: string
    added?: string
    removed?: string
    ran?: string
    marked?: string
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
    .select('id, label, image_url, demographic_tag, created_at')
    .eq('trend_id', id)
    .order('created_at', { ascending: true })
  const inputs = (inputRows ?? []).filter(Boolean)

  const { data: runRows } = await supabase
    .from('trend_eval_runs')
    .select('id, trend_id, prompt_version, eval_input_id, output_url, admin_rating, created_at')
    .eq('trend_id', id)
    .order('created_at', { ascending: false })
    .limit(inputs.length || 10)
  const latestRuns = (runRows ?? []).reduce<Record<string, EvalRunRow>>((acc, run) => {
    if (!acc[run.eval_input_id]) acc[run.eval_input_id] = run
    return acc
  }, {})

  const rated = Object.values(latestRuns).filter(
    (r) => r.admin_rating === 'pass' || r.admin_rating === 'fail'
  )
  const allRated = inputs.length > 0 && rated.length === inputs.length
  const anyFail = rated.some((r) => r.admin_rating === 'fail')
  const hasResults = inputs.length > 0 && Object.keys(latestRuns).length > 0

  async function boundAdd(formData: FormData): Promise<void> {
    'use server'
    await addEvalInput(id, formData)
  }
  async function boundRun(): Promise<void> {
    'use server'
    await runEval(id)
  }
  async function boundMarkPassed(): Promise<void> {
    'use server'
    await markTrendEval(id, 'passed')
  }
  async function boundMarkFailed(): Promise<void> {
    'use server'
    await markTrendEval(id, 'failed')
  }

  return (
    <section className="flex flex-col gap-6">
      <FlashToasts
        flashes={[
          { key: 'error', level: 'error' },
          { key: 'added', level: 'success', message: 'Reference photo added.' },
          { key: 'removed', level: 'info', message: 'Reference removed.' },
          { key: 'ran', level: 'success', message: 'Test run dispatched.' },
          {
            key: 'marked-passed',
            level: 'success',
            message: 'Trend eval marked passed. Activate from Edit page.',
          },
          { key: 'marked-failed', level: 'success', message: 'Trend eval marked failed.' },
        ]}
      />

      <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-muted-foreground text-xs font-semibold tracking-[0.2em] uppercase">
            Eval workflow
          </p>
          <h1 className="text-3xl font-extrabold tracking-tight">{trend.title}</h1>
          <div className="text-muted-foreground mt-2 flex flex-wrap items-center gap-2 text-xs">
            <code className="bg-muted rounded px-1.5 py-0.5">/{trend.slug}</code>
            <span>·</span>
            <span>v{trend.version}</span>
            <span>·</span>
            <span className="font-mono">{trend.model}</span>
            <EvalBadge status={trend.eval_status} />
            <ActiveBadge active={trend.is_active} />
          </div>
        </div>
        <Button asChild variant="ghost" size="sm">
          <Link href={`/admin/trends/${trend.id}/edit`}>← Edit trend</Link>
        </Button>
      </header>

      {/* Step 1: references */}
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2 text-base">
                <StepDot n={1} /> Reference photos
              </CardTitle>
              <CardDescription>
                Public image URLs covering the demographics, lighting, and ages this trend must
                handle.
              </CardDescription>
            </div>
            <span className="bg-muted rounded-full px-2.5 py-0.5 font-mono text-[11px]">
              {inputs.length}
            </span>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <form action={boundAdd} className="grid gap-3 sm:grid-cols-[1fr_2fr_1fr_auto]">
            <div className="flex flex-col gap-1.5">
              <Label
                htmlFor="ref-label"
                className="text-muted-foreground text-[11px] tracking-wide uppercase"
              >
                Label
              </Label>
              <Input
                id="ref-label"
                name="label"
                required
                maxLength={80}
                placeholder="child / glasses / dark"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label
                htmlFor="ref-url"
                className="text-muted-foreground text-[11px] tracking-wide uppercase"
              >
                Image URL
              </Label>
              <Input id="ref-url" name="image_url" required type="url" placeholder="https://…" />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label
                htmlFor="ref-tag"
                className="text-muted-foreground text-[11px] tracking-wide uppercase"
              >
                Tag
              </Label>
              <Input id="ref-tag" name="demographic_tag" maxLength={40} placeholder="optional" />
            </div>
            <div className="flex flex-col justify-end">
              <Button type="submit" size="default">
                <Plus className="size-4" /> Add
              </Button>
            </div>
          </form>

          {inputs.length > 0 && (
            <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {inputs.map((input) => {
                async function boundRemove(): Promise<void> {
                  'use server'
                  await removeEvalInput(id, input.id)
                }
                return (
                  <li
                    key={input.id}
                    className="group border-border/60 bg-card relative flex flex-col gap-2 overflow-hidden rounded-xl border p-2"
                  >
                    <div className="bg-muted aspect-square overflow-hidden rounded-md">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={input.image_url}
                        alt={input.label}
                        className="h-full w-full object-cover"
                      />
                    </div>
                    <div className="flex items-center justify-between gap-2 px-1 pb-1">
                      <div className="min-w-0">
                        <div className="truncate text-xs font-semibold">{input.label}</div>
                        {input.demographic_tag && (
                          <div className="text-muted-foreground truncate text-[10px]">
                            {input.demographic_tag}
                          </div>
                        )}
                      </div>
                      <form action={boundRemove}>
                        <Button
                          type="submit"
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`Remove ${input.label}`}
                          className="text-muted-foreground hover:text-destructive"
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      </form>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Step 2: dispatch run */}
      <Card>
        <CardHeader>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <CardTitle className="flex items-center gap-2 text-base">
                <StepDot n={2} /> Test run
              </CardTitle>
              <CardDescription>
                Generates one output per reference using the current prompt + model.
                {inputs.length === 0 && ' Add at least one reference photo first.'}
              </CardDescription>
            </div>
            <form action={boundRun}>
              <Button type="submit" disabled={inputs.length === 0} size="lg">
                <Play className="size-4" /> Test now ({inputs.length})
              </Button>
            </form>
          </div>
        </CardHeader>
      </Card>

      {/* Step 3: rate */}
      {hasResults && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <StepDot n={3} /> Rate results
            </CardTitle>
            <CardDescription>
              Pass each row that nails the trend. Rated {rated.length}/{inputs.length}.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="flex flex-col gap-3">
              {inputs.map((input) => {
                const run = latestRuns[input.id]
                if (!run) return null

                async function boundRatePass(): Promise<void> {
                  'use server'
                  await rateEvalRun(id, run.id, 'pass')
                }
                async function boundRateFail(): Promise<void> {
                  'use server'
                  await rateEvalRun(id, run.id, 'fail')
                }

                const errorMsg = run.admin_rating?.startsWith('error:') ? run.admin_rating : null

                return (
                  <li
                    key={run.id}
                    className="border-border/60 bg-card grid gap-3 rounded-xl border p-3 sm:grid-cols-[120px_120px_1fr_auto] sm:items-center"
                  >
                    <EvalThumb
                      src={input.image_url}
                      alt={`input ${input.label}`}
                      placeholder="input"
                    />
                    <EvalThumb
                      src={run.output_url}
                      alt={`output ${input.label}`}
                      placeholder={errorMsg ? errorMsg : 'pending'}
                      isError={Boolean(errorMsg)}
                    />
                    <div className="flex min-w-0 flex-col gap-0.5">
                      <div className="truncate text-sm font-semibold">{input.label}</div>
                      {input.demographic_tag && (
                        <div className="text-muted-foreground text-xs">{input.demographic_tag}</div>
                      )}
                      <div className="text-muted-foreground mt-1 text-[10px] tracking-wide uppercase">
                        v{run.prompt_version}
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <form action={boundRatePass}>
                        <Button
                          type="submit"
                          size="sm"
                          variant={run.admin_rating === 'pass' ? 'default' : 'outline'}
                          className={cn(
                            run.admin_rating === 'pass' &&
                              'bg-emerald-600 text-white hover:bg-emerald-700'
                          )}
                        >
                          <Check className="size-3.5" /> Pass
                        </Button>
                      </form>
                      <form action={boundRateFail}>
                        <Button
                          type="submit"
                          size="sm"
                          variant={run.admin_rating === 'fail' ? 'destructive' : 'outline'}
                        >
                          <X className="size-3.5" /> Fail
                        </Button>
                      </form>
                    </div>
                  </li>
                )
              })}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* Step 4: mark */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <StepDot n={4} /> Mark trend
          </CardTitle>
          <CardDescription>
            {allRated
              ? anyFail
                ? 'At least one reference failed — mark trend failed.'
                : 'All references passed — mark trend passed to enable activation.'
              : `Rate all ${inputs.length} reference(s) before marking the trend.`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Separator className="mb-4" />
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-muted-foreground text-xs">
              {allRated && !anyFail && (
                <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                  <ArrowRight className="size-3.5" /> Next: activate on the Edit page.
                </span>
              )}
            </p>
            <div className="flex gap-2">
              <form action={boundMarkPassed}>
                <Button
                  type="submit"
                  size="default"
                  disabled={!allRated || anyFail}
                  className="bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50"
                >
                  <Check className="size-4" /> Mark passed
                </Button>
              </form>
              <form action={boundMarkFailed}>
                <Button type="submit" variant="destructive" size="default" disabled={!allRated}>
                  <X className="size-4" /> Mark failed
                </Button>
              </form>
            </div>
          </div>
        </CardContent>
      </Card>
    </section>
  )
}

function StepDot({ n }: { n: number }) {
  return (
    <span className="grid size-6 place-items-center rounded-full bg-gradient-to-br from-[var(--brand-grad-1)] to-[var(--brand-grad-2)] text-[11px] font-bold text-white shadow-sm">
      {n}
    </span>
  )
}

interface EvalThumbProps {
  src: string | null
  alt: string
  placeholder: string
  isError?: boolean
}

function EvalThumb({ src, alt, placeholder, isError }: EvalThumbProps) {
  return (
    <div className="border-border/60 bg-muted aspect-square overflow-hidden rounded-lg border">
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt={alt} className="h-full w-full object-cover" />
      ) : (
        <div
          className={cn(
            'flex h-full w-full flex-col items-center justify-center gap-1 p-2 text-center text-[10px]',
            isError ? 'text-destructive' : 'text-muted-foreground'
          )}
        >
          <ImageOff className="size-4" />
          <span className="line-clamp-2 break-all">{placeholder}</span>
        </div>
      )}
    </div>
  )
}
