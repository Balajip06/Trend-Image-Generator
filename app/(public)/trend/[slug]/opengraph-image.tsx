/**
 * Trend-page OG card. 1200×630.
 *
 * Visual: pink → orange → gold diagonal gradient backdrop (matches
 * --brand-grad-1/2/3 tokens — hex-literal because ImageResponse does not
 * resolve CSS vars). Sample image inset top-right (≈55% area) with a dark
 * scrim for text legibility. Trendly wordmark + gradient glyph top-left.
 * Title + description bottom-left.
 *
 * Image fetch caveat (Next 16 / @vercel/og): the sample is fetched at build
 * time by next/og's image loader; mock SVGs served from /public work fine,
 * Supabase public PNGs work if the bucket allows anonymous GET. If the fetch
 * fails the card falls back to the gradient backdrop alone.
 */

import { ImageResponse } from 'next/og'
import { getActiveTrendBySlug } from '@/lib/trends/repository'

export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'
export const alt = 'Trendly — viral image trends with your photo'

interface OgProps {
  params: Promise<{ slug: string }>
}

const BRAND_PINK = '#ff2e63'
const BRAND_ORANGE = '#ff8c42'
const BRAND_GOLD = '#ffd93d'

export default async function OpengraphImage({ params }: OgProps) {
  const { slug } = await params
  const trend = await getActiveTrendBySlug(slug)
  const title = trend?.title ?? 'Trend Image Generator'
  const description = trend?.description ?? 'Viral image trends with your photo.'
  const sample = trend?.sample_after_url ?? null

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          position: 'relative',
          background: `linear-gradient(135deg, ${BRAND_PINK} 0%, ${BRAND_ORANGE} 50%, ${BRAND_GOLD} 100%)`,
          fontFamily: 'sans-serif',
          color: '#ffffff',
        }}
      >
        {/* Sample image inset — top-right ≈55% area */}
        {sample && (
          <div
            style={{
              position: 'absolute',
              top: 48,
              right: 48,
              width: 540,
              height: 540,
              borderRadius: 36,
              overflow: 'hidden',
              display: 'flex',
              boxShadow: '0 24px 60px -16px rgba(0, 0, 0, 0.45)',
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={sample}
              alt=""
              width={540}
              height={540}
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            />
            {/* Dark scrim for text legibility against any sample */}
            <div
              style={{
                position: 'absolute',
                inset: 0,
                background:
                  'linear-gradient(180deg, rgba(0,0,0,0) 40%, rgba(0,0,0,0.35) 100%)',
              }}
            />
          </div>
        )}

        {/* Wordmark top-left */}
        <div
          style={{
            position: 'absolute',
            top: 56,
            left: 64,
            display: 'flex',
            alignItems: 'center',
            gap: 16,
          }}
        >
          <svg width="56" height="56" viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <linearGradient id="og-glyph" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor={BRAND_PINK} />
                <stop offset="50%" stopColor={BRAND_ORANGE} />
                <stop offset="100%" stopColor={BRAND_GOLD} />
              </linearGradient>
            </defs>
            <rect width="48" height="48" rx="14" fill="#ffffff" />
            <path
              d="M 14 32 Q 24 14 34 32"
              fill="none"
              stroke="url(#og-glyph)"
              strokeWidth="4"
              strokeLinecap="round"
            />
            <circle cx="24" cy="22" r="3.5" fill="url(#og-glyph)" />
          </svg>
          <div style={{ fontSize: 34, fontWeight: 800, letterSpacing: '-0.02em' }}>Trendly</div>
        </div>

        {/* Title + description bottom-left */}
        <div
          style={{
            position: 'absolute',
            bottom: 64,
            left: 64,
            display: 'flex',
            flexDirection: 'column',
            gap: 18,
            maxWidth: 580,
          }}
        >
          <div
            style={{
              fontSize: 72,
              fontWeight: 800,
              lineHeight: 1.02,
              letterSpacing: '-0.035em',
              textShadow: '0 4px 24px rgba(0, 0, 0, 0.25)',
            }}
          >
            {title}
          </div>
          <div
            style={{
              fontSize: 28,
              fontWeight: 500,
              lineHeight: 1.3,
              opacity: 0.92,
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
              textShadow: '0 2px 12px rgba(0, 0, 0, 0.2)',
            }}
          >
            {description}
          </div>
        </div>
      </div>
    ),
    size
  )
}
