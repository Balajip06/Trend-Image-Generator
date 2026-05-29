'use client'

import { Copy, Share2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { analytics, EVENTS } from '@/lib/analytics/client'
import {
  buildTwitterShareUrl,
  buildWhatsappShareUrl,
  copyToClipboard,
  isWebShareSupported,
  shareNative,
  type ShareChannel,
} from '@/lib/share/web-share'

interface ShareBurstProps {
  trendSlug: string
  trendTitle: string
  outputImageUrl: string
}

export function ShareBurst({ trendSlug, trendTitle, outputImageUrl }: ShareBurstProps) {
  const [copied, setCopied] = useState(false)
  const [sharing, setSharing] = useState(false)
  // Defer feature-detected tiles until after hydration. isWebShareSupported()
  // is false on the server (no `navigator`) but true on capable clients —
  // gating on `mounted` keeps the first client render structurally identical
  // to SSR, then reveals extra tiles post-mount. setState-in-effect is the
  // canonical pattern for this hydration gate.
  const [mounted, setMounted] = useState(false)
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setMounted(true), [])

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

  const showNative = mounted && isWebShareSupported()

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
