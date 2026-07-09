import { ClipboardCheck } from 'lucide-react'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ConfirmDestructiveButton } from '@/components/admin/ConfirmDestructiveButton'
import { FlashToasts } from '@/components/admin/FlashToasts'
import { ActiveBadge, EvalBadge } from '@/components/admin/StatusBadges'
import { Button } from '@/components/ui/button'
import { createServiceClient } from '@/lib/supabase/server'
import { toggleActive, updateTrend } from '../../actions'
import { TrendForm } from '../../TrendForm'

export const dynamic = 'force-dynamic'

interface EditTrendPageProps {
  params: Promise<{ id: string }>
  searchParams: Promise<{
    error?: string
    saved?: string
    created?: string
    activated?: string
    cloned?: string
  }>
}

export default async function EditTrendPage({ params, searchParams }: EditTrendPageProps) {
  const { id } = await params
  await searchParams // consumed by FlashToasts client-side

  // Service-role read: `trends_public_read` RLS only allows is_active=true rows,
  // so drafts/clones (is_active=false) 404 for admins under the session client.
  // proxy.ts already gates /admin to admins.
  const supabase = createServiceClient()
  const { data: row } = await supabase
    .from('trends')
    .select(
      'id, slug, title, description, prompt_template, model, aspect_ratio, display_order, thumbnail_url, sample_before_url, sample_after_url, seo_title, seo_description, share_caption_template, input_schema, faq, is_active, eval_status, version, goes_live_at, is_featured, auto_deactivate_disabled, auto_deactivate_threshold'
    )
    .eq('id', id)
    .maybeSingle()
  const trend = row ?? null
  if (!trend) notFound()

  async function boundUpdate(formData: FormData): Promise<void> {
    'use server'
    await updateTrend(id, formData)
  }

  async function boundToggle(): Promise<void> {
    'use server'
    await toggleActive(id, !trend!.is_active)
  }

  async function boundDeactivate(): Promise<void> {
    'use server'
    await toggleActive(id, false)
  }

  const canActivate = trend.eval_status === 'passed'

  return (
    <section className="flex flex-col gap-6">
      <FlashToasts
        flashes={[
          { key: 'error', level: 'error' },
          { key: 'saved', level: 'success', message: 'Saved.' },
          { key: 'created', level: 'success', message: 'Draft created.' },
          { key: 'activated', level: 'info', message: 'Activated.' },
          { key: 'deactivated', level: 'info', message: 'Deactivated.' },
          {
            key: 'cloned',
            level: 'success',
            message: 'Cloned. Edit this draft and run eval before activating.',
          },
        ]}
      />

      <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-muted-foreground text-xs font-semibold tracking-[0.2em] uppercase">
            Editing
          </p>
          <h1 className="text-3xl font-extrabold tracking-tight">{trend.title}</h1>
          <div className="text-muted-foreground mt-2 flex flex-wrap items-center gap-2 text-xs">
            <code className="bg-muted rounded px-1.5 py-0.5">/{trend.slug}</code>
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
          trend.is_active ? (
            // Deactivation hides the trend from users — gate behind a confirm.
            // Trigger is type="button", so it won't submit the outer trend form;
            // ConfirmDestructiveButton renders its own form inside the dialog,
            // which Radix portals out of the parent so HTML stays valid.
            <ConfirmDestructiveButton
              formAction={boundDeactivate}
              triggerLabel="Deactivate"
              triggerVariant="outline"
              title="Deactivate this trend?"
              description={
                <>
                  Users won&apos;t see <strong>{trend.title}</strong> on the homepage anymore. You
                  can reactivate later as long as eval still passes.
                </>
              }
              confirmLabel="Yes, deactivate"
            />
          ) : (
            // Activate is a positive action — same form-action override pattern
            // as before so unsaved field edits still go through `updateTrend`
            // when the admin hits the primary submit.
            <Button
              type="submit"
              formAction={boundToggle}
              variant="default"
              size="lg"
              disabled={!canActivate}
              title={!canActivate ? 'Eval must pass before activating' : undefined}
            >
              {canActivate ? 'Activate' : 'Activate (eval required)'}
            </Button>
          )
        }
      />
    </section>
  )
}
