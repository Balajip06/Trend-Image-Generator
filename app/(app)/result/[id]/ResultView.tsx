'use client'

import { ArrowLeft, Copy, Download, ImageIcon, RefreshCw, Share2 } from 'lucide-react'
import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { GradientButton } from '@/components/brand/GradientButton'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { analytics, EVENTS } from '@/lib/analytics/client'
import {
  ensurePushSubscription,
  getPermissionState,
  isIosSafariNeedsInstall,
} from '@/lib/push/client'
import {
  buildTwitterShareUrl,
  buildWhatsappShareUrl,
  copyToClipboard,
  isWebShareSupported,
  shareNative,
  type ShareChannel,
} from '@/lib/share/web-share'
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
  created_at: string
  cost_usd: number
  completed_at: string | null
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
    const channel = supabase
      .channel(`gen-${row.id}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'generations', filter: `id=eq.${row.id}` },
        (payload) => {
          const next = payload.new as Initial
          setRow((prev) => ({ ...prev, ...next }))
        },
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [row.id, row.status])

  const onRetry = async () => {
    setRetrying(true)
    try {
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
          className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
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

      <ResultCanvas row={row} title={trend.title} />

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
        />
      )}

      {pushHint && (
        <p className="rounded-full bg-muted px-4 py-2 text-center text-xs text-muted-foreground">
          {pushHint}
        </p>
      )}
    </section>
  )
}

interface ResultCanvasProps {
  row: Initial
  title: string
}

function ResultCanvas({ row, title }: ResultCanvasProps) {
  if (row.status === 'completed' && row.output_image_url) {
    return (
      <figure className="relative overflow-hidden rounded-3xl border border-border/60 bg-card shadow-pop animate-pop-in">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={row.output_image_url}
          alt={title}
          className="aspect-square w-full object-cover"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -inset-6 -z-10 bg-gradient-hero opacity-50 blur-3xl"
        />
      </figure>
    )
  }
  if (row.status === 'failed') {
    return (
      <div className="relative overflow-hidden rounded-3xl border border-destructive/30 bg-destructive/5 p-12 text-center">
        <p className="text-2xl font-bold text-destructive">Generation failed</p>
        {row.error_message && (
          <p className="mt-2 text-sm text-muted-foreground">{row.error_message}</p>
        )}
        <p className="mt-4 text-sm text-muted-foreground">
          Don&apos;t worry — your quota was refunded. Try again or pick a different trend.
        </p>
      </div>
    )
  }
  // pending, processing, failed_retryable
  const subline =
    row.status === 'processing'
      ? 'Rendering pixels — usually 8 seconds…'
      : row.status === 'failed_retryable'
        ? `Auto-retrying… attempt ${row.attempts}`
        : 'Queued — starting in a moment…'
  return (
    <div className="relative overflow-hidden rounded-3xl border border-border/60 bg-card">
      <div className="aspect-square w-full bg-gradient-hero opacity-25" />
      <div className="absolute inset-0 animate-shimmer" />
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-center">
        <div className="size-12 animate-spin rounded-full border-4 border-white/60 border-t-white" />
        <p className="text-sm font-medium text-white drop-shadow-md">{subline}</p>
      </div>
    </div>
  )
}

function StatusBadge({ status, attempts }: { status: Status; attempts: number }) {
  const map: Record<Status, { label: string; cls: string }> = {
    pending: {
      label: 'Queued',
      cls: 'bg-muted text-foreground/70',
    },
    processing: {
      label: 'Generating',
      cls: 'bg-[var(--brand-cyan)]/15 text-[color:oklch(0.45_0.16_215)] dark:text-[var(--brand-cyan)] animate-pulse',
    },
    completed: {
      label: 'Done',
      cls: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
    },
    failed_retryable: {
      label: `Retrying ${attempts}/3`,
      cls: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
    },
    failed: {
      label: 'Failed',
      cls: 'bg-destructive/15 text-destructive',
    },
  }
  const { label, cls } = map[status]
  return <Badge className={`rounded-full px-3 py-1 text-xs font-semibold ${cls}`}>{label}</Badge>
}

interface ShareBurstProps {
  trendSlug: string
  trendTitle: string
  outputImageUrl: string
}

function ShareBurst({ trendSlug, trendTitle, outputImageUrl }: ShareBurstProps) {
  const [copied, setCopied] = useState(false)
  const [sharing, setSharing] = useState(false)

  // Use the env-pinned site URL so SSR and CSR agree (window.location.origin
  // is undefined on the server, which causes a hydration mismatch).
  const origin = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'
  const siteUrl = `${origin}/trend/${trendSlug}`
  const text = `I tried the ${trendTitle} trend — check it out`

  const fireTrack = (channel: ShareChannel) => {
    analytics.track(EVENTS.SHARE_CLICKED, { trend_slug: trendSlug, channel })
  }

  const onNativeShare = async () => {
    setSharing(true)
    try {
      let imageBlob: Blob | undefined
      try {
        const res = await fetch(outputImageUrl)
        if (res.ok) imageBlob = await res.blob()
      } catch {
        // Network blip — proceed without file attachment.
      }
      const result = await shareNative({
        title: trendTitle,
        text,
        url: siteUrl,
        imageBlob,
        imageFilename: `trend-${trendSlug}.jpg`,
      })
      if (result.ok) fireTrack('web_share')
    } finally {
      setSharing(false)
    }
  }

  const onCopyLink = async () => {
    const result = await copyToClipboard(siteUrl)
    if (result.ok) {
      fireTrack('copy_link')
      setCopied(true)
      toast.success('Link copied — ready to paste anywhere.')
      setTimeout(() => setCopied(false), 1800)
    }
  }

  const showNative = typeof window !== 'undefined' && isWebShareSupported()

  return (
    <div className="rounded-3xl border border-border/60 bg-card/80 p-6 backdrop-blur">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Share
          </p>
          <p className="mt-0.5 text-base font-bold">Drop it on the feed</p>
        </div>
        <Share2 className="size-5 text-muted-foreground" />
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-5">
        {showNative && (
          <ShareTile
            onClick={onNativeShare}
            disabled={sharing}
            label="Share"
            sub={sharing ? 'Opening…' : 'Native'}
            tone="gradient"
          />
        )}
        <ShareTile
          href={buildTwitterShareUrl(text, siteUrl)}
          onClick={() => fireTrack('twitter')}
          label="X / Twitter"
          sub="Tweet"
          tone="outline"
        />
        <ShareTile
          href={buildWhatsappShareUrl(text, siteUrl)}
          onClick={() => fireTrack('whatsapp')}
          label="WhatsApp"
          sub="DM friends"
          tone="outline"
        />
        <ShareTile
          href={`https://www.instagram.com/`}
          onClick={() => fireTrack('instagram')}
          label="Instagram"
          sub="Save first"
          tone="outline"
        />
        <ShareTile
          onClick={onCopyLink}
          label={copied ? 'Copied!' : 'Copy link'}
          sub="Anywhere"
          tone="outline"
          icon={<Copy className="size-4" />}
        />
      </div>
    </div>
  )
}

interface ShareTileProps {
  href?: string
  onClick?: () => void
  disabled?: boolean
  label: string
  sub: string
  tone: 'gradient' | 'outline'
  icon?: React.ReactNode
}

function ShareTile({ href, onClick, disabled, label, sub, tone, icon }: ShareTileProps) {
  const cls =
    tone === 'gradient'
      ? 'bg-gradient-hero text-white shadow-glow-pink hover:scale-[1.02]'
      : 'border border-border bg-background hover:bg-muted'
  const inner = (
    <span className="flex flex-col items-start">
      <span className="flex items-center gap-1.5 text-sm font-semibold">
        {icon}
        {label}
      </span>
      <span className="text-[10px] uppercase tracking-wider opacity-70">{sub}</span>
    </span>
  )
  const baseCls = `flex flex-col items-start rounded-2xl px-4 py-3 text-left transition-all ${cls}`
  if (href) {
    return (
      <a href={href} target="_blank" rel="noreferrer" onClick={onClick} className={baseCls}>
        {inner}
      </a>
    )
  }
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`${baseCls} disabled:opacity-60`}
    >
      {inner}
    </button>
  )
}
