import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { IMAGE_MODELS, MODEL_LABELS, type ImageModel } from '@/lib/image-provider/types'
import type { ModelCostLimits } from '@/lib/pricing/cost-limits'
import { COST_USD_PER_IMAGE } from '@/lib/pricing/models'
import { cn } from '@/lib/utils/cn'
import { setModelCostLimits } from './actions'

export interface ModelSpend {
  daily: number
  monthly: number
}

interface ModelCostLimitsProps {
  limits: ModelCostLimits
  spend: Record<string, ModelSpend>
}

function usd(n: number, digits = 2): string {
  return `$${n.toFixed(digits)}`
}

/** Bar tinting: amber approaching the cap, red once it is reached. */
function meterTone(used: number, cap: number | null | undefined): string {
  if (cap == null || cap <= 0) return 'bg-muted-foreground/40'
  const pct = used / cap
  if (pct >= 1) return 'bg-destructive'
  if (pct >= 0.8) return 'bg-amber-500'
  return 'bg-emerald-500'
}

function Meter({ label, used, cap }: { label: string; used: number; cap: number | null }) {
  const pct = cap && cap > 0 ? Math.min(100, (used / cap) * 100) : 0
  return (
    <div className="flex flex-col gap-1">
      <div className="text-muted-foreground flex items-center justify-between text-[11px]">
        <span>{label}</span>
        <span className="font-mono tabular-nums">
          {usd(used, 4)}
          {cap != null ? ` / ${usd(cap)}` : ' / no limit'}
        </span>
      </div>
      <div className="bg-muted h-1.5 overflow-hidden rounded-full">
        <div
          className={cn('h-full rounded-full transition-all', meterTone(used, cap))}
          style={{ width: `${cap != null ? Math.max(2, pct) : 0}%` }}
          aria-hidden="true"
        />
      </div>
    </div>
  )
}

/**
 * Per-model USD ceilings + live spend.
 *
 * Nothing capped AI spend per model before this: the two existing budgets were
 * env-var only (redeploy to change) and neither was per-model. Spend shown here
 * comes from the same `model_spend_usd` RPC the enforcement gate reads, so the
 * meter and the gate can never disagree.
 */
export function ModelCostLimitsSection({ limits, spend }: ModelCostLimitsProps) {
  return (
    <Card className="gap-4 py-6">
      <CardHeader className="px-6 pb-0">
        <CardTitle className="text-lg font-bold">Model cost limits</CardTitle>
        <CardDescription className="text-xs">
          Ceilings are enforced before every provider call — customer generations and admin eval
          runs both count. A blocked generation fails cleanly and refunds the user&apos;s quota.
          Leave a field empty for no limit.
        </CardDescription>
      </CardHeader>
      <CardContent className="px-6">
        <form action={setModelCostLimits} className="flex flex-col gap-5">
          {IMAGE_MODELS.map((model: ImageModel) => {
            const limit = limits[model] ?? {}
            const used = spend[model] ?? { daily: 0, monthly: 0 }
            const enabled = limit.enabled !== false
            return (
              <div
                key={model}
                className="border-border/60 flex flex-col gap-3 rounded-xl border p-4"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold">{MODEL_LABELS[model]}</p>
                    <p className="text-muted-foreground font-mono text-[11px]">
                      {model} · {usd(COST_USD_PER_IMAGE[model], 4)}/image
                    </p>
                  </div>
                  <label className="flex cursor-pointer items-center gap-2 text-xs font-medium">
                    <input
                      type="checkbox"
                      name={`${model}__enabled`}
                      defaultChecked={enabled}
                      className="size-4"
                    />
                    Enabled
                  </label>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="flex flex-col gap-1.5 text-xs font-medium">
                    Daily cap (USD)
                    <input
                      type="number"
                      name={`${model}__daily`}
                      min="0"
                      step="0.01"
                      defaultValue={limit.daily_usd ?? ''}
                      placeholder="no limit"
                      className="border-input h-9 rounded-md border bg-transparent px-3 text-sm"
                    />
                  </label>
                  <label className="flex flex-col gap-1.5 text-xs font-medium">
                    Monthly cap (USD)
                    <input
                      type="number"
                      name={`${model}__monthly`}
                      min="0"
                      step="0.01"
                      defaultValue={limit.monthly_usd ?? ''}
                      placeholder="no limit"
                      className="border-input h-9 rounded-md border bg-transparent px-3 text-sm"
                    />
                  </label>
                </div>

                <div className="grid gap-2 sm:grid-cols-2">
                  <Meter label="Today" used={used.daily} cap={limit.daily_usd ?? null} />
                  <Meter label="This month" used={used.monthly} cap={limit.monthly_usd ?? null} />
                </div>
              </div>
            )
          })}

          <div>
            <button
              type="submit"
              className="bg-primary text-primary-foreground hover:bg-primary/90 inline-flex h-9 items-center rounded-md px-4 text-sm font-medium"
            >
              Save limits
            </button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}
