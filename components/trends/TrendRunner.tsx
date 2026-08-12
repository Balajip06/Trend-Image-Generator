'use client'

import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { TurnstileWidget } from '@/components/auth/TurnstileWidget'
import { QuotaUpsellModal } from '@/components/payments/QuotaUpsellModal'
import { SchemaForm } from '@/components/upload/SchemaForm'
import { AnonymousTrialUsedModal } from './AnonymousTrialUsedModal'
import { analytics, EVENTS } from '@/lib/analytics/client'
import { getFingerprintHash } from '@/lib/fingerprint/client'
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
 *   - /studio          — authed dashboard
 *
 * Authed users land here either by clicking a trend in the studio rail
 * (URL becomes /studio?trend=<slug>) or by visiting /trend/<slug>
 * directly (server redirects to /studio?trend=<slug>). Either way,
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
  const [trialUsedOpen, setTrialUsedOpen] = useState(false)
  const [isAuthed, setIsAuthed] = useState<boolean | null>(null)
  const [turnstileToken, setTurnstileToken] = useState('')
  const submitting = phase !== 'idle'
  const turnstileGated = Boolean(process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY)

  useEffect(() => {
    let cancelled = false
    createClient()
      .auth.getUser()
      .then(({ data }) => {
        if (!cancelled) setIsAuthed(Boolean(data.user))
      })
    return () => {
      cancelled = true
    }
  }, [])

  const runAnonymous = useCallback(
    async (payload: {
      values: Record<string, string | string[]>
      files: Record<string, File[]>
    }) => {
      if (turnstileGated && !turnstileToken) {
        toast.error('Waiting for bot-check — try again in a moment')
        setPhase('idle')
        return
      }

      const fingerprintHash = await getFingerprintHash()
      const valuesWithUrls: Record<string, string | string[]> = { ...payload.values }

      for (const [fieldName, files] of Object.entries(payload.files)) {
        if (!files || files.length === 0) continue
        const signedUrls: string[] = []
        for (const rawFile of files) {
          const prepared = await prepareImageForUpload(rawFile)
          const form = new FormData()
          form.set('fingerprint_hash', fingerprintHash)
          form.set('file', prepared.file)
          const uploadRes = await fetch('/api/upload-anonymous', { method: 'POST', body: form })
          const uploadBody = (await uploadRes.json()) as { url?: string; error?: string }
          if (!uploadRes.ok || !uploadBody.url) {
            throw new Error(uploadBody.error ?? `upload ${fieldName} failed (${uploadRes.status})`)
          }
          signedUrls.push(uploadBody.url)
        }
        valuesWithUrls[fieldName] = signedUrls.length === 1 ? signedUrls[0] : signedUrls
      }

      analytics.track(EVENTS.GENERATE_CLICKED, {
        trend_slug: trend.slug,
        model: trend.model,
        is_anonymous: true,
      })

      setPhase('starting')
      const idemKey = generateIdempotencyKey()
      const res = await fetch('/api/generate-anonymous', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'idempotency-key': idemKey },
        body: JSON.stringify({
          trend_slug: trend.slug,
          values: valuesWithUrls,
          turnstile_token: turnstileToken,
          fingerprint_hash: fingerprintHash,
        }),
      })
      const body = (await res.json()) as { anonymous_attempt_id?: string; error?: string }
      if (res.status === 409) {
        setTrialUsedOpen(true)
        setPhase('idle')
        return
      }
      if (!res.ok || !body.anonymous_attempt_id) {
        throw new Error(body.error ?? `Generate failed (${res.status})`)
      }
      router.push(`/anonymous/${body.anonymous_attempt_id}`)
    },
    [router, trend.slug, trend.model, turnstileGated, turnstileToken]
  )

  const runAuthed = useCallback(
    async (
      user: { id: string },
      payload: {
        values: Record<string, string | string[]>
        files: Record<string, File[]>
      }
    ) => {
      const supabase = createClient()
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
    },
    [router, trend.slug, trend.model]
  )

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

        if (user) {
          await runAuthed(user, payload)
        } else {
          await runAnonymous(payload)
        }
        // navigating away — overlay unmounts with the route; no reset needed
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
    [runAnonymous, runAuthed, trend.slug]
  )

  return (
    <>
      {isAuthed === false && turnstileGated && (
        <div className="mb-3 flex flex-col items-center gap-2">
          <TurnstileWidget onToken={setTurnstileToken} />
          {!turnstileToken && (
            <p className="text-muted-foreground text-xs">Waiting for bot-check…</p>
          )}
        </div>
      )}
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
      <AnonymousTrialUsedModal
        open={trialUsedOpen}
        onOpenChange={setTrialUsedOpen}
        trendSlug={trend.slug}
      />
    </>
  )
}
