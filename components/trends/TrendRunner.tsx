'use client'

import { useRouter } from 'next/navigation'
import { useCallback, useState } from 'react'
import { toast } from 'sonner'
import { QuotaUpsellModal } from '@/components/payments/QuotaUpsellModal'
import { SchemaForm } from '@/components/upload/SchemaForm'
import { analytics, EVENTS } from '@/lib/analytics/client'
import { generateIdempotencyKey } from '@/lib/idempotency'
import { createClient } from '@/lib/supabase/client'
import type { PublicTrend } from '@/lib/trends/repository'
import { prepareImageForUpload } from '@/lib/utils/image'

interface TrendRunnerProps {
  trend: Pick<PublicTrend, 'slug' | 'input_schema' | 'model'>
  freeUsedThisWeek?: number
}

const SIGNED_URL_TTL_SECONDS = 3600

/**
 * Shared upload + generate runner used by both:
 *   - /trend/[slug]      — anonymous-trial + SEO surface
 *   - /me/studio          — authed dashboard
 *
 * Authed users land here either by clicking a trend in the studio rail
 * (URL becomes /me/studio?trend=<slug>) or by visiting /trend/<slug>
 * directly (server redirects to /me/studio?trend=<slug>). Either way,
 * the runner only owns the upload form + idempotent /api/generate call;
 * the surrounding shell decides where to render it.
 */
type Phase = 'idle' | 'uploading' | 'starting'

const PHASE_LABELS: Record<Exclude<Phase, 'idle'>, string> = {
  uploading: 'Uploading your photo…',
  starting: 'Starting generation…',
}

export function TrendRunner({ trend, freeUsedThisWeek = 5 }: TrendRunnerProps) {
  const router = useRouter()
  const [phase, setPhase] = useState<Phase>('idle')
  const [upsellOpen, setUpsellOpen] = useState(false)
  const submitting = phase !== 'idle'

  const handleSubmit = useCallback(
    async (payload: {
      values: Record<string, string | string[]>
      files: Record<string, File[]>
    }) => {
      setPhase('uploading')

      const fileCount = Object.values(payload.files).reduce((n, fs) => n + fs.length, 0)
      analytics.track(EVENTS.UPLOAD_STARTED, { trend_slug: trend.slug, file_count: fileCount })
      void fetch('/api/track', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ trend_slug: trend.slug, type: 'click_generate' }),
        keepalive: true,
      }).catch(() => {})

      try {
        const supabase = createClient()
        const {
          data: { user },
        } = await supabase.auth.getUser()
        if (!user) {
          // Send post-login users straight into the studio with this trend
          // pre-selected. Skips the /trend/<slug> → /me/studio hop.
          router.push(`/login?next=/me/studio?trend=${trend.slug}`)
          return
        }
        // navigating away — overlay unmounts with the route; no reset needed

        const idemKey = generateIdempotencyKey()
        const valuesWithUrls: Record<string, string | string[]> = { ...payload.values }

        for (const [fieldName, files] of Object.entries(payload.files)) {
          if (!files || files.length === 0) continue
          const signedUrls: string[] = []
          for (let i = 0; i < files.length; i++) {
            const prepared = await prepareImageForUpload(files[i])
            const path = `${user.id}/${idemKey}/${fieldName}_${i}.jpg`
            const { error: uploadErr } = await supabase.storage
              .from('uploads')
              .upload(path, prepared.file, { contentType: 'image/jpeg', upsert: true })
            if (uploadErr) throw new Error(`upload ${fieldName}[${i}]: ${uploadErr.message}`)

            const { data: signed, error: signErr } = await supabase.storage
              .from('uploads')
              .createSignedUrl(path, SIGNED_URL_TTL_SECONDS)
            if (signErr || !signed?.signedUrl) {
              throw new Error(`sign ${fieldName}[${i}]: ${signErr?.message ?? 'no url'}`)
            }
            signedUrls.push(signed.signedUrl)
          }
          valuesWithUrls[fieldName] = signedUrls.length === 1 ? signedUrls[0] : signedUrls
        }

        analytics.track(EVENTS.GENERATE_CLICKED, {
          trend_slug: trend.slug,
          model: trend.model,
          is_anonymous: false,
        })

        setPhase('starting')
        const res = await fetch('/api/generate', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'idempotency-key': idemKey,
          },
          body: JSON.stringify({ trend_slug: trend.slug, values: valuesWithUrls }),
        })
        const body = (await res.json()) as { generation_id?: string; error?: string }
        if (res.status === 402) {
          setUpsellOpen(true)
          setPhase('idle')
          return
        }
        if (!res.ok || !body.generation_id) {
          throw new Error(body.error ?? `Generate failed (${res.status})`)
        }
        router.push(`/result/${body.generation_id}`)
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Something went wrong'
        analytics.track(EVENTS.GENERATE_FAILED, {
          trend_slug: trend.slug,
          reason: 'invalid',
          attempts: 0,
        })
        toast.error(message)
        setPhase('idle')
      }
    },
    [router, trend.slug, trend.model]
  )

  return (
    <>
      <SchemaForm
        schema={trend.input_schema}
        onSubmit={handleSubmit}
        submitting={submitting}
        phaseLabel={phase === 'idle' ? undefined : PHASE_LABELS[phase]}
        ctaLabel="Generate"
      />
      <QuotaUpsellModal
        open={upsellOpen}
        onOpenChange={setUpsellOpen}
        freeUsedThisWeek={freeUsedThisWeek}
      />
    </>
  )
}
