'use client'

import { useRouter } from 'next/navigation'
import { useCallback, useState } from 'react'
import { SchemaForm } from '@/components/upload/SchemaForm'
import { generateIdempotencyKey } from '@/lib/idempotency'
import { createClient } from '@/lib/supabase/client'
import type { TrendInput } from '@/lib/trends/input-schema'
import { prepareImageForUpload } from '@/lib/utils/image'

interface TrendUploadProps {
  trendSlug: string
  schema: TrendInput
}

const SIGNED_URL_TTL_SECONDS = 3600

export function TrendUpload({ trendSlug, schema }: TrendUploadProps) {
  const router = useRouter()
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = useCallback(
    async (payload: { values: Record<string, string | string[]>; files: Record<string, File[]> }) => {
      setSubmitting(true)
      setError(null)

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
        setError(err instanceof Error ? err.message : 'Something went wrong')
        setSubmitting(false)
      }
    },
    [router, trendSlug]
  )

  return (
    <div className="flex flex-col gap-4">
      <SchemaForm schema={schema} onSubmit={handleSubmit} submitting={submitting} ctaLabel="Generate" />
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  )
}
