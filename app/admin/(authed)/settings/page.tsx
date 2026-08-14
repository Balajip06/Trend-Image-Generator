import { LoadErrorBanner } from '@/components/admin/LoadErrorBanner'
import { adminRead, adminReadOne } from '@/lib/admin/read'
import { IMAGE_MODELS, MODEL_LABELS } from '@/lib/image-provider/types'
import { readModelCostLimits, readModelSpend } from '@/lib/pricing/cost-limits'
import { createServiceClient } from '@/lib/supabase/server'
import { ModelCostLimitsSection } from './ModelCostLimits'
import { setBannerTrend, setGlobalDefaultModel } from './actions'

export const dynamic = 'force-dynamic'

export default async function SettingsPage() {
  const service = createServiceClient()

  const { row: setting, error: modelError } = await adminReadOne<{ value: unknown }>(
    'settings.default-model',
    service.from('app_settings').select('value').eq('key', 'default_image_model').maybeSingle()
  )

  const currentModel = (setting?.value as string | undefined)?.replace(/"/g, '') ?? 'gpt-image-2'

  const { row: bannerSetting, error: bannerError } = await adminReadOne<{ value: unknown }>(
    'settings.banner-trend',
    service.from('app_settings').select('value').eq('key', 'banner_trend_id').maybeSingle()
  )
  const currentBannerTrendId = bannerSetting?.value ? String(bannerSetting.value) : null

  const { rows: activeTrends, error: trendsError } = await adminRead<{
    id: string
    title: string
    slug: string
  }>(
    'settings.active-trends',
    service
      .from('trends')
      .select('id, title, slug')
      .eq('is_active', true)
      .order('display_order', { ascending: true })
  )

  // A failed settings read would otherwise render the FALLBACK default as if
  // it were the saved value — an admin could "confirm" a model that isn't set.
  const loadError = modelError ?? bannerError ?? trendsError

  // Cost limits + live spend. Spend comes from the same RPC the enforcement
  // gate reads, so the meters cannot disagree with what actually blocks.
  const costLimits = await readModelCostLimits(service)
  const spendEntries = await Promise.all(
    IMAGE_MODELS.map(async (model) => [model, await readModelSpend(service, model)] as const)
  )
  const spendByModel = Object.fromEntries(spendEntries)

  return (
    <div className="mx-auto max-w-2xl space-y-8 p-6">
      <LoadErrorBanner error={loadError} label="settings" />
      <div>
        <h1 className="text-xl font-semibold">Settings</h1>
        <p className="text-muted-foreground mt-1 text-sm">Global configuration for all trends.</p>
      </div>

      <section className="space-y-4">
        <div>
          <h2 className="text-base font-medium">Default Generation Model</h2>
          <p className="text-muted-foreground mt-1 text-sm">
            Applies to all trends with &ldquo;Follow global default&rdquo; selected. Changing this
            will deactivate live non-pinned trends until they are re-evaluated.
          </p>
        </div>

        {/* Driven by IMAGE_MODELS/MODEL_LABELS, which lib/image-provider/types.ts
            documents as the single source of truth for exactly this form. The
            list and its labels were previously hardcoded here and would drift
            silently whenever a model was added or renamed. */}
        <form action={setGlobalDefaultModel} className="space-y-3">
          {IMAGE_MODELS.map((model) => (
            <label key={model} className="flex cursor-pointer items-center gap-3">
              <input
                type="radio"
                name="model"
                value={model}
                defaultChecked={currentModel === model}
                className="h-4 w-4"
              />
              <span className="text-sm font-medium">{MODEL_LABELS[model]}</span>
              <span className="text-muted-foreground font-mono text-xs">{model}</span>
            </label>
          ))}

          <button
            type="submit"
            className="bg-primary text-primary-foreground hover:bg-primary/90 mt-2 inline-flex h-9 items-center rounded-md px-4 text-sm font-medium"
          >
            Save
          </button>
        </form>
      </section>

      <ModelCostLimitsSection limits={costLimits} spend={spendByModel} />

      <section className="space-y-4">
        <div>
          <h2 className="text-base font-medium">Homepage Banner Trend</h2>
          <p className="text-muted-foreground mt-1 text-sm">
            Pins a specific trend as the homepage hero banner, overriding the normal display-order
            sort. Leave on &ldquo;No override&rdquo; to use the lowest display-order active trend
            automatically.
          </p>
        </div>

        <form action={setBannerTrend} className="space-y-3">
          <select
            key={currentBannerTrendId ?? ''}
            name="trend_id"
            defaultValue={currentBannerTrendId ?? ''}
            className="border-input h-9 w-full max-w-sm rounded-md border bg-transparent px-3 text-sm"
          >
            <option value="">No override (use display order)</option>
            {(activeTrends ?? []).map((t) => (
              <option key={t.id} value={t.id}>
                {t.title} (/{t.slug})
              </option>
            ))}
          </select>

          <button
            type="submit"
            className="bg-primary text-primary-foreground hover:bg-primary/90 mt-2 inline-flex h-9 items-center rounded-md px-4 text-sm font-medium"
          >
            Save
          </button>
        </form>
      </section>
    </div>
  )
}
