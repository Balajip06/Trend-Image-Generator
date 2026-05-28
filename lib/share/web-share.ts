/**
 * Web Share API helper with channel-specific fallback.
 * Used when virality vector = IG/TikTok per amended plan.
 *
 * Order of preference:
 *   1. navigator.share with files (Android Chrome, iOS Safari 17+) — best UX,
 *      lets user pick IG/TikTok/etc native sheet
 *   2. navigator.share with url+text — older mobile, no image attachment
 *   3. Deep links — instagram://, tiktok://, twitter intent, WhatsApp
 *   4. Clipboard copy-link
 */

export type ShareChannel = 'web_share' | 'instagram' | 'tiktok' | 'twitter' | 'whatsapp' | 'copy_link'

export interface ShareInput {
  title: string
  text: string
  url: string
  /** Optional output image to attach via navigator.share (when supported). */
  imageBlob?: Blob
  imageFilename?: string
}

export interface ShareResult {
  ok: boolean
  channel: ShareChannel
  error?: string
}

export function isWebShareSupported(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.share === 'function'
}

export function canShareFiles(): boolean {
  return (
    isWebShareSupported() && typeof (navigator as { canShare?: unknown }).canShare === 'function'
  )
}

export async function shareNative(input: ShareInput): Promise<ShareResult> {
  if (!isWebShareSupported()) {
    return { ok: false, channel: 'web_share', error: 'navigator.share unavailable' }
  }
  try {
    if (input.imageBlob && canShareFiles()) {
      const file = new File([input.imageBlob], input.imageFilename ?? 'trend-image.jpg', {
        type: input.imageBlob.type,
      })
      const nav = navigator as Navigator & { canShare: (data: ShareData) => boolean }
      if (nav.canShare({ files: [file] })) {
        await navigator.share({
          files: [file],
          title: input.title,
          text: input.text,
          url: input.url,
        })
        return { ok: true, channel: 'web_share' }
      }
    }
    await navigator.share({ title: input.title, text: input.text, url: input.url })
    return { ok: true, channel: 'web_share' }
  } catch (err: unknown) {
    if (err instanceof Error && err.name === 'AbortError') {
      return { ok: false, channel: 'web_share', error: 'cancelled' }
    }
    return {
      ok: false,
      channel: 'web_share',
      error: err instanceof Error ? err.message : 'unknown',
    }
  }
}

export function buildTwitterShareUrl(text: string, url: string): string {
  return `https://x.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`
}

export function buildWhatsappShareUrl(text: string, url: string): string {
  return `https://wa.me/?text=${encodeURIComponent(`${text} ${url}`)}`
}

/** IG + TikTok don't have shareable web intents — best UX is web-share-files. */
export const INSTAGRAM_DEEP_LINK = 'instagram://camera'
export const TIKTOK_DEEP_LINK = 'snssdk1233://'

export async function copyToClipboard(text: string): Promise<ShareResult> {
  try {
    if (typeof navigator === 'undefined' || !navigator.clipboard?.writeText) {
      return { ok: false, channel: 'copy_link', error: 'Clipboard API unavailable' }
    }
    await navigator.clipboard.writeText(text)
    return { ok: true, channel: 'copy_link' }
  } catch (err: unknown) {
    return {
      ok: false,
      channel: 'copy_link',
      error: err instanceof Error ? err.message : 'unknown',
    }
  }
}
