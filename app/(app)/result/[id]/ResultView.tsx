'use client'

import { ArrowLeft, Download, ImageIcon, RefreshCw } from 'lucide-react'
import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { GradientButton } from '@/components/brand/GradientButton'
import { Button } from '@/components/ui/button'
import { analytics, EVENTS } from '@/lib/analytics/client'
import {
  ensurePushSubscription,
  getPermissionState,
  isIosSafariNeedsInstall,
} from '@/lib/push/client'
import { createClient } from '@/lib/supabase/client'
import { ResultCanvas } from './ResultCanvas'
import { ShareBurst } from './ShareBurst'
import { StatusBadge, type Status } from './StatusBadge'

interface Initial {
  id: string
  status: Status
  output_image_url: string | null
  error_message: string | null
  attempts: number
  trend_id: string
  created_at: string
  cost_usd: number
  completed_at: string | null
}

interface Trend {
  slug: string
  title: string
  share_caption_template: string | null
}

interface ResultViewProps {
  initial: Initial
  trend: Trend
}

export function ResultView({ initial, trend }: ResultViewProps) {
  const [row, setRow] = useState<Initial>(initial)
  const [retrying, setRetrying] = useState(false)
  const [pushHint, setPushHint] = useState<string | null>(null)
  const askedRef = useRef(false)

  useEffect(() => {
    if (row.status === 'completed') {
      const durationMs = row.completed_at
        ? new Date(row.completed_at).getTime() - new Date(row.created_at).getTime()
        : 0
      analytics.track(EVENTS.GENERATE_COMPLETED, {
        trend_slug: trend.slug,
        duration_ms: durationMs,
        cost_usd: row.cost_usd,
        attempts: row.attempts,
      })
    } else if (row.status === 'failed') {
      const message = row.error_message ?? ''
      const reason: 'safety' | 'timeout' | 'transient' | 'invalid' = message.startsWith('safety')
        ? 'safety'
        : message.includes('timed out') || message.includes('timeout')
          ? 'timeout'
          : message.startsWith('terminal after')
            ? 'transient'
            : 'invalid'
      analytics.track(EVENTS.GENERATE_FAILED, {
        trend_slug: trend.slug,
        reason,
        attempts: row.attempts,
      })
    }
  }, [
    row.attempts,
    row.completed_at,
    row.cost_usd,
    row.created_at,
    row.error_message,
    row.status,
    trend.slug,
  ])

  useEffect(() => {
    if (row.status !== 'completed') return
    if (askedRef.current) return
    askedRef.current = true

    const state = getPermissionState()
    if (state === 'unsupported' || state === 'denied') return

    if (isIosSafariNeedsInstall()) {
      // One-shot hint flag — synchronous setState here is intentional and
      // guarded by `askedRef`, so it runs at most once per mount.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPushHint('Add this site to your Home Screen to get push notifications next time.')
      return
    }

    analytics.track(EVENTS.PUSH_PERMISSION_REQUESTED, {})
    void ensurePushSubscription().then((res) => {
      if (res.ok) {
        analytics.track(EVENTS.PUSH_PERMISSION_GRANTED, {})
      } else if (res.reason === 'denied') {
        analytics.track(EVENTS.PUSH_PERMISSION_DENIED, {})
      } else if (res.reason === 'needs_pwa_install') {
        setPushHint('Add this site to your Home Screen to enable push.')
      }
    })
  }, [row.status])

  useEffect(() => {
    if (row.status === 'completed' || row.status === 'failed') return

    const supabase = createClient()
    const wasSubscribedRef = { current: false }

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
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          // Cover the RSC→SUBSCRIBED window (H-R2) and reconnect gap (H-R3)
          wasSubscribedRef.current = true
          try {
            const { data } = await supabase
              .from('generations')
              .select('id, status, output_image_url, error_message, attempts, cost_usd, completed_at')
              .eq('id', row.id)
              .maybeSingle()
            if (data) setRow((prev) => ({ ...prev, ...data }))
          } catch { /* best-effort */ }
        }
      })

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [row.id, row.status])

  const onRetry = async () => {
    setRetrying(true)
    try {
      // Red-team L4: retry no longer echoes the row's idempotency_key
      // through the client. The server resolves it from the
      // generations row and re-enqueues.
      const res = await fetch('/api/generate/retry', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ generation_id: row.id }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Retry failed')
      setRow((prev) => ({ ...prev, status: 'pending', error_message: null }))
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Retry failed')
    } finally {
      setRetrying(false)
    }
  }

  const downloadUrl = `/api/download/${row.id}`

  return (
    <section className="flex flex-col gap-8">
      <header className="flex items-center justify-between">
        <Link
          href={`/trend/${trend.slug}`}
          className="text-muted-foreground hover:bg-muted hover:text-foreground inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm"
        >
          <ArrowLeft className="size-4" />
          Back to {trend.title}
        </Link>
        <StatusBadge status={row.status} attempts={row.attempts} />
      </header>

      <h1 className="text-4xl font-extrabold tracking-tight sm:text-5xl">
        {row.status === 'completed' ? (
          <>
            <span className="text-gradient-hero">{trend.title}</span> — fresh off the model
          </>
        ) : row.status === 'failed' ? (
          'Something went sideways'
        ) : (
          <>
            Cooking your <span className="text-gradient-hero">{trend.title}</span>
          </>
        )}
      </h1>

      <ResultCanvas
        status={row.status}
        outputImageUrl={row.output_image_url}
        errorMessage={row.error_message}
        attempts={row.attempts}
        title={trend.title}
      />

      {/* Actions */}
      <div className="flex flex-wrap items-center gap-3">
        {row.status === 'completed' && (
          <GradientButton size="lg" asChild>
            <a
              href={downloadUrl}
              onClick={() =>
                analytics.track(EVENTS.DOWNLOAD_CLICKED, {
                  trend_slug: trend.slug,
                  watermarked: row.cost_usd > 0 ? false : true,
                })
              }
            >
              <Download className="size-4" />
              Download
            </a>
          </GradientButton>
        )}
        {(row.status === 'failed' || row.status === 'failed_retryable') && (
          <GradientButton size="lg" onClick={onRetry} disabled={retrying}>
            <RefreshCw className={retrying ? 'size-4 animate-spin' : 'size-4'} />
            {retrying ? 'Retrying…' : 'Try again'}
          </GradientButton>
        )}
        <Button asChild variant="outline" size="lg" className="rounded-full">
          <Link href="/me/creations">
            <ImageIcon className="size-4" />
            My creations
          </Link>
        </Button>
      </div>

      {row.status === 'completed' && row.output_image_url && (
        <ShareBurst
          trendSlug={trend.slug}
          trendTitle={trend.title}
          outputImageUrl={row.output_image_url}
          shareCaptionTemplate={trend.share_caption_template}
        />
      )}

      {pushHint && (
        <p className="bg-muted text-muted-foreground rounded-full px-4 py-2 text-center text-xs">
          {pushHint}
        </p>
      )}
    </section>
  )
}
