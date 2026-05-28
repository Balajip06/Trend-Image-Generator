'use client'

import { useRouter } from 'next/navigation'
import { useCallback, useState } from 'react'
import { toast } from 'sonner'
import { SchemaForm } from '@/components/upload/SchemaForm'
import { analytics, EVENTS } from '@/lib/analytics/client'
import { generateIdempotencyKey } from '@/lib/idempotency'
import { createClient } from '@/lib/supabase/client'
import type { TrendInput } from '@/lib/trends/input-schema'
import { prepareImageForUpload } from '@/lib/utils/image'

interface TrendUploadProps {
  trendSlug: string
  schema: TrendInput
  model: 'nano-banana' | 'nano-banana-pro'
}

const SIGNED_URL_TTL_SECONDS = 3600

export function TrendUpload({ trendSlug, schema, model }: TrendUploadProps) {
  const router = useRouter()
  const [submitting, setSubmitting] = useState(false)

  const handleSubmit = useCallback(
    async (payload: { values: Record<string, string | string[]>; files: Record<string, File[]> }) => {
      setSubmitting(true)

      const fileCount = Object.values(payload.files).reduce((n, fs) => n + fs.length, 0)
      analytics.track(EVENTS.UPLOAD_STARTED, { trend_slug: trendSlug, file_count: fileCount })

      try {
        const supabase = createClient()
        const {
          data: { user },
        } = await supabase.auth.getUser()
        if (!user) {
          router.push(`/login?next=/trend/${trendSlug}`)
          return
        }

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
          trend_slug: trendSlug,
          model,
          is_anonymous: false,
        })

        const res = await fetch('/api/generate', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'idempotency-key': idemKey,
          },
          body: JSON.stringify({ trend_slug: trendSlug, values: valuesWithUrls }),
        })
        const body = (await res.json()) as { generation_id?: string; error?: string }
        if (!res.ok || !body.generation_id) {
          throw new Error(body.error ?? `Generate failed (${res.status})`)
        }
        router.push(`/result/${body.generation_id}`)
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Something went wrong'
        analytics.track(EVENTS.GENERATE_FAILED, {
          trend_slug: trendSlug,
          reason: 'invalid',
          attempts: 0,
        })
        toast.error(message)
        setSubmitting(false)
      }
    },
    [model, router, trendSlug]
  )

  return <SchemaForm schema={schema} onSubmit={handleSubmit} submitting={submitting} ctaLabel="Generate" />
}
