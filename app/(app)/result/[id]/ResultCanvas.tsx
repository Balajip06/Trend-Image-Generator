'use client'

import Image from 'next/image'
import { useState } from 'react'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import type { Status } from './StatusBadge'

interface ResultCanvasProps {
  status: Status
  outputImageUrl: string | null
  errorMessage: string | null
  attempts: number
  title: string
}

export function ResultCanvas({
  status,
  outputImageUrl,
  errorMessage,
  attempts,
  title,
}: ResultCanvasProps) {
  const [zoomed, setZoomed] = useState(false)

  if (status === 'completed' && outputImageUrl) {
    return (
      <div className="mx-auto w-full max-w-md">
        <button
          type="button"
          onClick={() => setZoomed(true)}
          aria-label="View full size"
          className="group focus-visible:ring-ring block w-full cursor-zoom-in rounded-3xl focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
        >
          <figure className="border-border/60 bg-card shadow-pop animate-pop-in relative aspect-square overflow-hidden rounded-3xl border">
            <Image
              src={outputImageUrl}
              alt={title}
              fill
              priority
              quality={95}
              sizes="(max-width: 480px) 100vw, 480px"
              className="object-cover transition-transform duration-300 group-hover:scale-[1.02]"
            />
            <div
              aria-hidden
              className="bg-gradient-hero pointer-events-none absolute -inset-6 -z-10 opacity-50 blur-3xl"
            />
          </figure>
        </button>

        <Dialog open={zoomed} onOpenChange={setZoomed}>
          <DialogContent className="sm:max-w-3xl">
            <DialogTitle className="sr-only">{title} — full size</DialogTitle>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={outputImageUrl} alt={title} className="w-full rounded-lg" />
          </DialogContent>
        </Dialog>
      </div>
    )
  }
  if (status === 'failed') {
    return (
      <div className="border-destructive/30 bg-destructive/5 relative mx-auto w-full max-w-md overflow-hidden rounded-3xl border p-12 text-center">
        <p className="text-destructive text-2xl font-bold">Generation failed</p>
        {errorMessage && <p className="text-muted-foreground mt-2 text-sm">{errorMessage}</p>}
        <p className="text-muted-foreground mt-4 text-sm">
          Don&apos;t worry — your quota was refunded. Try again or pick a different trend.
        </p>
      </div>
    )
  }
  // pending, processing, failed_retryable
  const subline =
    status === 'processing'
      ? 'Rendering pixels — usually 8 seconds…'
      : status === 'failed_retryable'
        ? `Auto-retrying… attempt ${attempts}`
        : 'Queued — starting in a moment…'
  return (
    <div className="border-border/60 bg-card relative mx-auto w-full max-w-md overflow-hidden rounded-3xl border">
      <div className="bg-gradient-hero aspect-square w-full opacity-25" />
      <div className="animate-shimmer absolute inset-0" />
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-center">
        <div className="size-12 animate-spin rounded-full border-4 border-white/60 border-t-white" />
        <p className="text-sm font-medium text-white drop-shadow-md">{subline}</p>
      </div>
    </div>
  )
}
