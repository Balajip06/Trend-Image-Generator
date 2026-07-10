'use client'

import { Check, ImageOff, Loader2, Play, Power, Rocket, Trash2, X } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { toast } from 'sonner'
import { ActiveBadge, EvalBadge } from '@/components/admin/StatusBadges'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Separator } from '@/components/ui/separator'
import { IMAGE_MODELS, MODEL_LABELS, type ImageModel } from '@/lib/image-provider/types'
import { cn } from '@/lib/utils/cn'
import {
  approveAndGoLive,
  markTrendEval,
  rateEvalRun,
  removeEvalInput,
  runEval,
  type EvalActionResult,
} from './actions'
import { toggleActive } from '../../actions'
import { EvalUploadForm } from './EvalUploadForm'

interface EvalInputRow {
  id: string
  label: string
  image_url: string
  created_at: string
}

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

interface TrendRow {
  id: string
  slug: string
  title: string
  model: string
  version: number
  eval_status: 'untested' | 'passed' | 'failed'
  is_active: boolean
}

interface EvalWorkflowProps {
  trend: TrendRow
  inputs: EvalInputRow[]
  latestRuns: Record<string, EvalRunRow>
  addEvalInputAction: (formData: FormData) => Promise<void>
}

type PendingKind = 'test' | 'pass' | 'fail' | 'remove'
interface PendingState {
  inputId: string
  kind: PendingKind
}

function handleResult(result: EvalActionResult, onSuccess?: () => void) {
  if (!result.ok) {
    toast.error(result.error)
    return
  }
  onSuccess?.()
}

export function EvalWorkflow({ trend, inputs, latestRuns, addEvalInputAction }: EvalWorkflowProps) {
  const router = useRouter()
  const [pending, setPending] = useState<PendingState | null>(null)
  const [, startTransition] = useTransition()
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)
  // Per-card model selection for the Test button. Defaults to the trend's
  // saved model; the admin can switch to compare models before going live.
  const [selectedModels, setSelectedModels] = useState<Record<string, ImageModel>>({})
  const modelFor = (inputId: string): ImageModel =>
    selectedModels[inputId] ?? (trend.model as ImageModel)

  const rated = Object.values(latestRuns).filter(
    (r) => r.admin_rating === 'pass' || r.admin_rating === 'fail'
  )
  const hasResults = inputs.length > 0 && Object.keys(latestRuns).length > 0
  const hasSuccessfulResults = Object.values(latestRuns).some((r) => r.output_url)
  // The run that Approve & Go Live will commit: the successful latest run whose
  // model matches the trend's, else the first successful one (its model gets
  // committed). Shown in the confirmation dialog so the admin sees exactly what
  // goes live + which model it locks in.
  const successfulRuns = Object.values(latestRuns).filter((r) => r.output_url)
  const winningRun =
    successfulRuns.find((r) => r.model === trend.model) ?? successfulRuns[0] ?? null
  const winningModel = (winningRun?.model as ImageModel | undefined) ?? (trend.model as ImageModel)

  function isPending(inputId: string, kind: PendingKind) {
    return pending?.inputId === inputId && pending?.kind === kind
  }

  function runAction(inputId: string, kind: PendingKind, action: () => Promise<EvalActionResult>) {
    if (pending) return
    setPending({ inputId, kind })
    startTransition(async () => {
      const result = await action()
      setPending(null)
      handleResult(result, () => router.refresh())
    })
  }

  function handleTest(inputId: string) {
    const model = modelFor(inputId)
    runAction(inputId, 'test', () => runEval(trend.id, inputId, model))
  }
  function handlePass(inputId: string, runId: string) {
    runAction(inputId, 'pass', () => rateEvalRun(trend.id, runId, 'pass'))
  }
  function handleFail(inputId: string, runId: string) {
    runAction(inputId, 'fail', () => rateEvalRun(trend.id, runId, 'fail'))
  }
  function handleRemove(inputId: string) {
    runAction(inputId, 'remove', () => removeEvalInput(trend.id, inputId))
  }

  function handleDeactivate() {
    startTransition(async () => {
      await toggleActive(trend.id, false, `/admin/trends/${trend.id}/eval`)
    })
  }
  function confirmApprove() {
    setConfirmOpen(false)
    startTransition(async () => {
      await approveAndGoLive(trend.id)
    })
  }
  function handleReject() {
    startTransition(async () => {
      await markTrendEval(trend.id, 'failed')
    })
  }

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-3">
            <div>
              <CardTitle className="text-base">Reference photos</CardTitle>
              <CardDescription>
                Upload a test photo, then click Test to generate exactly one output for it.
              </CardDescription>
            </div>
            <span className="bg-muted rounded-full px-2.5 py-0.5 font-mono text-[11px]">
              {inputs.length}
            </span>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <EvalUploadForm addAction={addEvalInputAction} />

          {inputs.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              Upload your first test photo to start.
            </p>
          ) : (
            <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {inputs.map((input) => {
                const run = latestRuns[input.id]
                const reviewed = run?.admin_rating === 'pass' || run?.admin_rating === 'fail'
                const testing = isPending(input.id, 'test')
                return (
                  <li
                    key={input.id}
                    className={cn(
                      'group border-border/60 relative flex flex-col gap-3 overflow-hidden rounded-xl border p-3 transition-colors',
                      reviewed ? 'bg-muted/40' : 'bg-card'
                    )}
                  >
                    {run?.output_url && !reviewed && (
                      <div
                        aria-hidden
                        className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-[var(--brand-grad-1)] to-[var(--brand-grad-2)]"
                      />
                    )}
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <div className="border-border/60 bg-muted size-8 shrink-0 overflow-hidden rounded-md border">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={input.image_url}
                            alt={input.label}
                            className="h-full w-full object-cover"
                          />
                        </div>
                        <span className="text-muted-foreground truncate text-xs">
                          v{trend.version}
                        </span>
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label="Remove reference photo"
                        disabled={isPending(input.id, 'remove')}
                        onClick={() => handleRemove(input.id)}
                        className="text-muted-foreground hover:text-destructive shrink-0"
                      >
                        {isPending(input.id, 'remove') ? (
                          <Loader2 className="size-3.5 animate-spin" />
                        ) : (
                          <Trash2 className="size-3.5" />
                        )}
                      </Button>
                    </div>

                    <button
                      type="button"
                      disabled={!run?.output_url}
                      onClick={() => run?.output_url && setPreviewUrl(run.output_url)}
                      className={cn(
                        'border-border/60 bg-muted relative aspect-square w-full overflow-hidden rounded-lg border',
                        run?.output_url && 'cursor-zoom-in'
                      )}
                    >
                      {testing && (
                        <div className="animate-shimmer absolute inset-0 z-10 bg-gradient-to-br from-transparent via-white/10 to-transparent" />
                      )}
                      {run?.output_url ? (
                        <>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={run.output_url}
                            alt={`${input.label} result`}
                            className="animate-pop-in h-full w-full object-cover"
                          />
                          {run.model && (
                            <span className="absolute bottom-1 left-1 z-10 rounded bg-black/60 px-1.5 py-0.5 font-mono text-[10px] text-white">
                              {MODEL_LABELS[run.model as ImageModel] ?? run.model}
                            </span>
                          )}
                        </>
                      ) : (
                        <div className="text-muted-foreground flex h-full w-full flex-col items-center justify-center gap-2 text-center text-xs">
                          {testing ? (
                            <>
                              <Loader2 className="size-5 animate-spin" />
                              <span>Testing… up to ~3 min</span>
                            </>
                          ) : (
                            <ImageOff className="size-5" />
                          )}
                        </div>
                      )}
                    </button>

                    {/* Per-test model picker — compare models before going live. */}
                    <label className="text-muted-foreground flex items-center gap-2 text-[11px]">
                      <span className="shrink-0 tracking-wide uppercase">Model</span>
                      <select
                        value={modelFor(input.id)}
                        disabled={testing}
                        onChange={(e) =>
                          setSelectedModels((prev) => ({
                            ...prev,
                            [input.id]: e.target.value as ImageModel,
                          }))
                        }
                        className="border-border/60 bg-background h-7 w-full min-w-0 rounded-md border px-2 text-xs disabled:opacity-50"
                      >
                        {IMAGE_MODELS.map((m) => (
                          <option key={m} value={m}>
                            {MODEL_LABELS[m]}
                          </option>
                        ))}
                      </select>
                    </label>

                    <div className="flex gap-2">
                      <Button
                        type="button"
                        size="sm"
                        disabled={testing}
                        onClick={() => handleTest(input.id)}
                        className="flex-1"
                      >
                        {testing ? (
                          <Loader2 className="size-3.5 animate-spin" />
                        ) : (
                          <Play className="size-3.5" />
                        )}
                        {testing ? 'Testing…' : run?.output_url ? 'Re-test' : 'Test'}
                      </Button>
                      {run?.output_url && (
                        <>
                          <Button
                            type="button"
                            size="sm"
                            variant={run.admin_rating === 'pass' ? 'default' : 'outline'}
                            disabled={isPending(input.id, 'pass')}
                            onClick={() => handlePass(input.id, run.id)}
                            className={cn(
                              run.admin_rating === 'pass' &&
                                'bg-emerald-600 text-white hover:bg-emerald-700'
                            )}
                          >
                            {isPending(input.id, 'pass') ? (
                              <Loader2 className="size-3.5 animate-spin" />
                            ) : (
                              <Check className="size-3.5" />
                            )}
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant={run.admin_rating === 'fail' ? 'destructive' : 'outline'}
                            disabled={isPending(input.id, 'fail')}
                            onClick={() => handleFail(input.id, run.id)}
                          >
                            {isPending(input.id, 'fail') ? (
                              <Loader2 className="size-3.5 animate-spin" />
                            ) : (
                              <X className="size-3.5" />
                            )}
                          </Button>
                        </>
                      )}
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Go live</CardTitle>
          <CardDescription>
            {trend.is_active
              ? 'This trend is live and visible to customers.'
              : hasSuccessfulResults
                ? 'Outputs look right? One click marks the test passed and activates the trend — customers see it immediately.'
                : 'Test at least one reference photo and review the output before going live.'}
          </CardDescription>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
            <EvalBadge status={trend.eval_status} />
            <ActiveBadge active={trend.is_active} />
            {hasResults && (
              <span className="text-muted-foreground">
                Rated {rated.length}/{inputs.length}
              </span>
            )}
          </div>
        </CardHeader>
        <CardContent>
          <Separator className="mb-4" />
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-muted-foreground text-xs">
              Editing the prompt or model later re-bumps the version → resets eval and
              auto-deactivates, so you’ll re-test before it can go live again.
            </p>
            <div className="flex flex-wrap gap-2">
              {trend.is_active ? (
                <Button
                  type="button"
                  variant="outline"
                  size="default"
                  disabled={pending !== null}
                  onClick={handleDeactivate}
                >
                  <Power className="size-4" /> Deactivate
                </Button>
              ) : (
                <>
                  <Button
                    type="button"
                    variant="outline"
                    size="default"
                    disabled={!hasResults}
                    onClick={handleReject}
                  >
                    <X className="size-4" /> Reject
                  </Button>
                  <Button
                    type="button"
                    size="lg"
                    disabled={!hasSuccessfulResults}
                    onClick={() => setConfirmOpen(true)}
                    className="bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50"
                  >
                    <Rocket className="size-4" /> Approve &amp; Go Live
                  </Button>
                </>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      <Dialog open={previewUrl !== null} onOpenChange={(open) => !open && setPreviewUrl(null)}>
        <DialogContent className="sm:max-w-3xl">
          <DialogTitle className="sr-only">Result preview</DialogTitle>
          {previewUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={previewUrl} alt="Result preview" className="w-full rounded-lg" />
          )}
        </DialogContent>
      </Dialog>

      {/* Approve confirmation — shows exactly what goes live + which model it commits. */}
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Go live with this result?</DialogTitle>
            <DialogDescription>
              This activates the trend for customers and locks in the model below. Editing the
              prompt or model later resets the eval.
            </DialogDescription>
          </DialogHeader>
          {winningRun?.output_url && (
            <div className="flex flex-col gap-3">
              <div className="border-border/60 bg-muted mx-auto aspect-square w-full max-w-xs overflow-hidden rounded-xl border">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={winningRun.output_url}
                  alt="Result going live"
                  className="h-full w-full object-cover"
                />
              </div>
              <div className="flex items-center justify-center gap-2 text-sm">
                <span className="text-muted-foreground">Model:</span>
                <span className="bg-muted rounded px-2 py-0.5 font-mono text-xs">
                  {MODEL_LABELS[winningModel] ?? winningModel}
                </span>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setConfirmOpen(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              onClick={confirmApprove}
              className="bg-emerald-600 text-white hover:bg-emerald-700"
            >
              <Rocket className="size-4" /> Confirm &amp; Go Live
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
