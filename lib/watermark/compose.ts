/**
 * Server-side watermark composer.
 * Applied to free-tier downloads only; Pro (credits_balance > 0) gets clean output.
 *
 * The corner tag is the virality engine — IG/TikTok shares of free outputs
 * carry attribution back to the app. Mounted bottom-right with a slight
 * shadow so it stays legible on any background.
 */

import sharp from 'sharp'

const DEFAULT_WORDMARK = 'trendimage.com'
const FONT_FAMILY = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif'

export interface WatermarkOptions {
  /** Override the default wordmark — e.g. once domain is finalised. */
  wordmark?: string
  /** 0–1 — tag opacity, default 0.85. */
  opacity?: number
}

/**
 * Composes a bottom-right tag over the input PNG/JPEG buffer and returns a PNG buffer.
 * Auto-scales font size to the input image's longest side so a 1024px output
 * and a 4096px output both get visually consistent tagging.
 */
export async function applyWatermark(
  inputBuffer: Buffer | Uint8Array,
  options: WatermarkOptions = {}
): Promise<Buffer> {
  const wordmark = options.wordmark ?? DEFAULT_WORDMARK
  const opacity = options.opacity ?? 0.85

  const buf = Buffer.isBuffer(inputBuffer) ? inputBuffer : Buffer.from(inputBuffer)
  const image = sharp(buf)
  const meta = await image.metadata()
  const width = meta.width ?? 1024
  const height = meta.height ?? 1024

  const longestSide = Math.max(width, height)
  const fontSize = Math.max(14, Math.round(longestSide * 0.022))
  const padX = Math.round(fontSize * 0.9)
  const padY = Math.round(fontSize * 0.6)
  const textPad = Math.round(fontSize * 0.5)

  const tagSvg = buildTagSvg({ wordmark, fontSize, opacity, padX, padY, textPad })
  const tagBuffer = Buffer.from(tagSvg)

  return image
    .composite([{ input: tagBuffer, gravity: 'southeast' }])
    .png()
    .toBuffer()
}

interface BuildTagArgs {
  wordmark: string
  fontSize: number
  opacity: number
  padX: number
  padY: number
  textPad: number
}

function buildTagSvg(args: BuildTagArgs): string {
  const { wordmark, fontSize, opacity, padX, padY, textPad } = args
  // Generous width budget; SVG itself is masked by text bounding rect.
  const tagW = Math.round(wordmark.length * fontSize * 0.62) + textPad * 2
  const tagH = fontSize + textPad * 2

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${tagW + padX}" height="${tagH + padY}">
  <g transform="translate(${padX / 2}, ${padY / 2})">
    <rect x="0" y="0" width="${tagW}" height="${tagH}" rx="${Math.round(tagH / 2)}" fill="black" fill-opacity="0.55"/>
    <text
      x="${tagW / 2}"
      y="${tagH / 2}"
      font-family='${FONT_FAMILY}'
      font-size="${fontSize}"
      font-weight="600"
      fill="white"
      fill-opacity="${opacity}"
      text-anchor="middle"
      dominant-baseline="central"
    >${escapeXml(wordmark)}</text>
  </g>
</svg>`
}

function escapeXml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => {
    switch (c) {
      case '&':
        return '&amp;'
      case '<':
        return '&lt;'
      case '>':
        return '&gt;'
      case '"':
        return '&quot;'
      case "'":
        return '&apos;'
      default:
        return c
    }
  })
}
