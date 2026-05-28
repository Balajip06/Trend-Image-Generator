'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { ensurePushSubscription, getPermissionState, isIosSafariNeedsInstall } from '@/lib/push/client'
import { createClient } from '@/lib/supabase/client'

type Status = 'pending' | 'processing' | 'completed' | 'failed' | 'failed_retryable'

interface Initial {
  id: string
  status: Status
  output_image_url: string | null
  error_message: string | null
  attempts: number
  idempotency_key: string
  trend_id: string
}

interface Trend {
  slug: string
  title: string
}

interface ResultViewProps {
  initial: Initial
  trend: Trend
}

export function ResultView({ initial, trend }: ResultViewProps) {
  const [row, setRow] = useState<Initial>(initial)
  const [retrying, setRetrying] = useState(false)
  const [retryError, setRetryError] = useState<string | null>(null)
  const [pushHint, setPushHint] = useState<string | null>(null)
  const askedRef = useRef(false)

  useEffect(() => {
    if (row.status !== 'completed') return
    if (askedRef.current) return
    askedRef.current = true

    const state = getPermissionState()
    if (state === 'unsupported' || state === 'denied') return

    if (isIosSafariNeedsInstall()) {
      setPushHint('Add this site to your Home Screen to get push notifications next time.')
      return
    }

    void ensurePushSubscription().then((res) => {
      if (!res.ok && res.reason === 'needs_pwa_install') {
        setPushHint('Add this site to your Home Screen to enable push.')
      }
    })
  }, [row.status])

  useEffect(() => {
    if (row.status === 'completed' || row.status === 'failed') return

    const supabase = createClient()
    const channel = supabase
      .channel(`gen-${row.id}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'generations', filter: `id=eq.${row.id}` },
        (payload) => {
          const next = payload.new as Initial
          setRow((prev) => ({ ...prev, ...next }))
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [row.id, row.status])

  const onRetry = async () => {
    setRetrying(true)
    setRetryError(null)
    try {
      // Reuses the original Idempotency-Key. The duplicate-key path in
      // /api/generate returns { generation_id, replayed: true } without
      // consuming quota.
      const res = await fetch('/api/generate', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'idempotency-key': row.idempotency_key,
        },
        body: JSON.stringify({ trend_slug: trend.slug, values: {} }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Retry failed')
      setRow((prev) => ({ ...prev, status: 'pending', error_message: null }))
    } catch (err: unknown) {
      setRetryError(err instanceof Error ? err.message : 'Retry failed')
    } finally {
      setRetrying(false)
    }
  }

  const downloadUrl = `/api/download/${row.id}`

  return (
    <section className="flex flex-col gap-6">
      <header className="flex items-baseline justify-between">
        <h1 className="text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          {trend.title}
        </h1>
        <Link
          href={`/trend/${trend.slug}`}
          className="text-sm text-zinc-500 underline-offset-2 hover:underline"
        >
          ← Back to trend
        </Link>
      </header>

      <StatusPill status={row.status} attempts={row.attempts} />

      <div className="aspect-square overflow-hidden rounded-xl border border-zinc-200 bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-900">
        {row.status === 'completed' && row.output_image_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={row.output_image_url} alt={trend.title} className="h-full w-full object-cover" />
        ) : row.status === 'failed' ? (
          <FailedPanel message={row.error_message} />
        ) : (
          <SkeletonPanel />
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        {row.status === 'completed' && (
          <a
            href={downloadUrl}
            className="h-11 rounded-md bg-zinc-900 px-5 text-sm font-medium text-zinc-50 hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
          >
            Download
          </a>
        )}
        {(row.status === 'failed' || row.status === 'failed_retryable') && (
          <button
            type="button"
            onClick={onRetry}
            disabled={retrying}
            className="h-11 rounded-md border border-zinc-300 px-5 text-sm font-medium text-zinc-900 hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-50 dark:hover:bg-zinc-800"
          >
            {retrying ? 'Retrying…' : 'Retry'}
          </button>
        )}
        <Link
          href="/me/creations"
          className="h-11 rounded-md border border-zinc-300 px-5 text-sm font-medium text-zinc-900 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-50 dark:hover:bg-zinc-800"
        >
          My creations
        </Link>
      </div>

      {retryError && <p className="text-sm text-red-600">{retryError}</p>}
      {pushHint && <p className="text-xs text-zinc-500">{pushHint}</p>}
    </section>
  )
}

function StatusPill({ status, attempts }: { status: Status; attempts: number }) {
  const map: Record<Status, { label: string; tone: string }> = {
    pending: { label: 'Queued', tone: 'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300' },
    processing: { label: 'Generating…', tone: 'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300' },
    completed: { label: 'Done', tone: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300' },
    failed_retryable: { label: `Retrying (attempt ${attempts})`, tone: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200' },
    failed: { label: 'Failed', tone: 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300' },
  }
  const { label, tone } = map[status]
  return <span className={`inline-flex w-fit rounded-full px-3 py-1 text-xs font-medium ${tone}`}>{label}</span>
}

function SkeletonPanel() {
  return (
    <div className="flex h-full w-full items-center justify-center">
      <div className="h-12 w-12 animate-spin rounded-full border-4 border-zinc-300 border-t-zinc-900 dark:border-zinc-700 dark:border-t-zinc-50" />
    </div>
  )
}

function FailedPanel({ message }: { message: string | null }) {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-2 px-6 text-center">
      <p className="text-sm font-medium text-red-600">Generation failed</p>
      {message && <p className="text-xs text-zinc-500">{message}</p>}
    </div>
  )
}
