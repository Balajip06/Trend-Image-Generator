import { ClipboardCheck } from 'lucide-react'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { FlashToasts } from '@/components/admin/FlashToasts'
import { ActiveBadge, EvalBadge } from '@/components/admin/StatusBadges'
import { Button } from '@/components/ui/button'
import { createClient } from '@/lib/supabase/server'
import { toggleActive, updateTrend } from '../../actions'
import { TrendForm } from '../../TrendForm'

export const dynamic = 'force-dynamic'

interface FullTrend {
  id: string
  slug: string
  title: string
  description: string | null
  prompt_template: string
  model: 'nano-banana' | 'nano-banana-pro'
  aspect_ratio: '1:1' | '3:4' | '16:9' | '9:16'
  display_order: number
  thumbnail_url: string | null
  sample_before_url: string | null
  sample_after_url: string | null
  seo_title: string | null
  seo_description: string | null
  input_schema: unknown
  faq: unknown
  is_active: boolean
  eval_status: 'untested' | 'passed' | 'failed'
  version: number
}

interface EditTrendPageProps {
  params: Promise<{ id: string }>
  searchParams: Promise<{ error?: string; saved?: string; created?: string; activated?: string }>
}

export default async function EditTrendPage({ params, searchParams }: EditTrendPageProps) {
  const { id } = await params
  await searchParams // consumed by FlashToasts client-side

  const supabase = await createClient()
  const { data: row } = await supabase
    .from('trends')
    .select(
      'id, slug, title, description, prompt_template, model, aspect_ratio, display_order, thumbnail_url, sample_before_url, sample_after_url, seo_title, seo_description, input_schema, faq, is_active, eval_status, version'
    )
    .eq('id', id)
    .maybeSingle()
  const trend = (row as unknown as FullTrend | null) ?? null
  if (!trend) notFound()

  async function boundUpdate(formData: FormData): Promise<void> {
    'use server'
    await updateTrend(id, formData)
  }

  async function boundToggle(): Promise<void> {
    'use server'
    await toggleActive(id, !trend!.is_active)
  }

  const canActivate = trend.eval_status === 'passed'

  return (
    <section className="flex flex-col gap-6">
      <FlashToasts
        flashes={[
          { key: 'error', level: 'error', message: (v) => v },
          { key: 'saved', level: 'success', message: 'Saved.' },
          { key: 'created', level: 'success', message: 'Draft created.' },
          {
            key: 'activated',
            level: 'info',
            message: (v) => (v === '1' ? 'Activated.' : 'Deactivated.'),
          },
        ]}
      />

      <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
            Editing
          </p>
          <h1 className="text-3xl font-extrabold tracking-tight">{trend.title}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <code className="rounded bg-muted px-1.5 py-0.5">/{trend.slug}</code>
            <span>·</span>
            <span>v{trend.version}</span>
            <span>·</span>
            <EvalBadge status={trend.eval_status} />
            <ActiveBadge active={trend.is_active} />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button asChild variant="outline" size="sm">
            <Link href={`/admin/trends/${trend.id}/eval`}>
              <ClipboardCheck className="size-4" /> Eval
            </Link>
          </Button>
          <Button asChild variant="ghost" size="sm">
            <Link href="/admin/trends">← Back</Link>
          </Button>
        </div>
      </header>

      <TrendForm
        action={boundUpdate}
        initial={trend}
        submitLabel="Save changes"
        extraActions={
          <form action={boundToggle}>
            <Button
              type="submit"
              variant={trend.is_active ? 'outline' : 'default'}
              size="lg"
              disabled={!trend.is_active && !canActivate}
              title={
                !trend.is_active && !canActivate
                  ? 'Eval must pass before activating'
                  : undefined
              }
            >
              {trend.is_active ? 'Deactivate' : canActivate ? 'Activate' : 'Activate (eval required)'}
            </Button>
          </form>
        }
      />
    </section>
  )
}
