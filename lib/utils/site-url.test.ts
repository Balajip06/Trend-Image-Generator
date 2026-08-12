import { afterEach, describe, expect, it } from 'vitest'
import { siteOrigin, siteUrl } from './site-url'

const ORIGINAL = process.env.NEXT_PUBLIC_SITE_URL

afterEach(() => {
  process.env.NEXT_PUBLIC_SITE_URL = ORIGINAL
})

describe('siteOrigin', () => {
  it('strips a trailing slash', () => {
    process.env.NEXT_PUBLIC_SITE_URL = 'https://trendly-gamma.vercel.app/'
    expect(siteOrigin()).toBe('https://trendly-gamma.vercel.app')
  })

  it('leaves a slashless origin untouched', () => {
    process.env.NEXT_PUBLIC_SITE_URL = 'https://trendly-gamma.vercel.app'
    expect(siteOrigin()).toBe('https://trendly-gamma.vercel.app')
  })

  it('strips repeated trailing slashes', () => {
    process.env.NEXT_PUBLIC_SITE_URL = 'https://trendly-gamma.vercel.app///'
    expect(siteOrigin()).toBe('https://trendly-gamma.vercel.app')
  })

  it('falls back to localhost when unset', () => {
    delete process.env.NEXT_PUBLIC_SITE_URL
    expect(siteOrigin()).toBe('http://localhost:3000')
  })
})

describe('siteUrl', () => {
  // The regression this module exists for: a trailing-slash env value used to
  // produce `https://host//auth/callback`, which fails Supabase's exact-match
  // Redirect URL allowlist. new URL() does not collapse it.
  it('never emits a double slash when the env value has a trailing slash', () => {
    process.env.NEXT_PUBLIC_SITE_URL = 'https://trendly-gamma.vercel.app/'
    expect(siteUrl('/auth/callback')).toBe('https://trendly-gamma.vercel.app/auth/callback')
    expect(new URL(siteUrl('/auth/callback')).pathname).toBe('/auth/callback')
  })

  it('accepts a path without a leading slash', () => {
    process.env.NEXT_PUBLIC_SITE_URL = 'https://trendly-gamma.vercel.app'
    expect(siteUrl('auth/callback')).toBe('https://trendly-gamma.vercel.app/auth/callback')
  })

  it('preserves query strings', () => {
    process.env.NEXT_PUBLIC_SITE_URL = 'https://trendly-gamma.vercel.app/'
    expect(siteUrl('/auth/callback?next=%2Fstudio')).toBe(
      'https://trendly-gamma.vercel.app/auth/callback?next=%2Fstudio'
    )
  })

  it('returns the bare origin with a single slash for the root path', () => {
    process.env.NEXT_PUBLIC_SITE_URL = 'https://trendly-gamma.vercel.app/'
    expect(siteUrl('/')).toBe('https://trendly-gamma.vercel.app/')
    expect(siteUrl()).toBe('https://trendly-gamma.vercel.app/')
  })
})
