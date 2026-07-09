import { createServiceClient } from '@/lib/supabase/server'
import { setBannerTrend, setGlobalDefaultModel } from './actions'

export const dynamic = 'force-dynamic'

export default async function SettingsPage() {
  const service = createServiceClient()

  const { data: setting } = await service
    .from('app_settings')
    .select('value')
    .eq('key', 'default_image_model')
    .maybeSingle()

  const currentModel =
    (setting?.value as string | undefined)?.replace(/"/g, '') ?? 'gpt-image'

  const { data: bannerSetting } = await service
    .from('app_settings')
    .select('value')
    .eq('key', 'banner_trend_id')
    .maybeSingle()
  const currentBannerTrendId = (bannerSetting?.value as string | null) ?? null

  const { data: activeTrends } = await service
    .from('trends')
    .select('id, title, slug')
    .eq('is_active', true)
    .order('display_order', { ascending: true })

  return (
    <div className="mx-auto max-w-2xl space-y-8 p-6">
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

        <form action={setGlobalDefaultModel} className="space-y-3">
          {(['nano-banana', 'nano-banana-pro', 'gpt-image'] as const).map((model) => (
            <label key={model} className="flex cursor-pointer items-center gap-3">
              <input
                type="radio"
                name="model"
                value={model}
                defaultChecked={currentModel === model}
                className="h-4 w-4"
              />
              <span className="text-sm font-medium">{model}</span>
              {model === 'nano-banana-pro' && (
                <span className="text-muted-foreground text-xs">(Gemini — quality default)</span>
              )}
              {model === 'nano-banana' && (
                <span className="text-muted-foreground text-xs">(Gemini — fast/cheap)</span>
              )}
              {model === 'gpt-image' && (
                <span className="text-muted-foreground text-xs">
                  (OpenAI — requires OPENAI_API_KEY)
                </span>
              )}
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

      <section className="space-y-4">
        <div>
          <h2 className="text-base font-medium">Homepage Banner Trend</h2>
          <p className="text-muted-foreground mt-1 text-sm">
            Pins a specific trend as the homepage hero banner, overriding the normal
            display-order sort. Leave on &ldquo;No override&rdquo; to use the lowest display-order
            active trend automatically.
          </p>
        </div>

        <form action={setBannerTrend} className="space-y-3">
          <select
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
