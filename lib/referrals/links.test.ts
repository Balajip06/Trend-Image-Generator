import { describe, expect, it } from 'vitest'
import {
  buildReferralUrl,
  parseReferralFromCookie,
  parseReferralFromUrl,
  REFERRAL_COOKIE_MAX_AGE_SECONDS,
} from './links'

describe('buildReferralUrl', () => {
  it('appends ?ref=<code> to site URL', () => {
    const url = buildReferralUrl('https://example.com', 'abcdef012345')
    expect(url).toBe('https://example.com/?ref=abcdef012345')
  })

  it('respects custom path', () => {
    const url = buildReferralUrl('https://example.com', 'abcdef012345', '/trend/ghibli')
    expect(url).toBe('https://example.com/trend/ghibli?ref=abcdef012345')
  })

  it('throws on malformed code', () => {
    expect(() => buildReferralUrl('https://example.com', 'BAD')).toThrow(/Invalid/)
  })
})

describe('parseReferralFromUrl', () => {
  it('returns lowercased code from valid URL', () => {
    expect(parseReferralFromUrl('https://example.com/?ref=ABCDEF012345')).toBe('abcdef012345')
  })

  it('returns null when ref missing', () => {
    expect(parseReferralFromUrl('https://example.com/')).toBeNull()
  })

  it('returns null when ref malformed', () => {
    expect(parseReferralFromUrl('https://example.com/?ref=NOPE')).toBeNull()
  })

  it('returns null on invalid URL', () => {
    expect(parseReferralFromUrl('not a url')).toBeNull()
  })
})

describe('parseReferralFromCookie', () => {
  it('returns lowercased code when valid', () => {
    expect(parseReferralFromCookie('ABCDEF012345')).toBe('abcdef012345')
  })

  it('returns null for nullish/empty', () => {
    expect(parseReferralFromCookie(null)).toBeNull()
    expect(parseReferralFromCookie(undefined)).toBeNull()
    expect(parseReferralFromCookie('')).toBeNull()
  })

  it('rejects malformed code', () => {
    expect(parseReferralFromCookie('zzzz')).toBeNull()
  })
})

describe('REFERRAL_COOKIE_MAX_AGE_SECONDS', () => {
  it('is 30 days', () => {
    expect(REFERRAL_COOKIE_MAX_AGE_SECONDS).toBe(60 * 60 * 24 * 30)
  })
})
