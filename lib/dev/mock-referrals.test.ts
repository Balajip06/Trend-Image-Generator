import { describe, expect, it } from 'vitest'
import {
  MOCK_REFERRAL_EVENTS,
  MOCK_REFERRERS,
  mockReferralTotals,
} from './mock-referrals'

describe('MOCK_REFERRERS', () => {
  it('has at least 8 deterministic rows', () => {
    expect(MOCK_REFERRERS.length).toBeGreaterThanOrEqual(8)
  })

  it('every referrer has a 12-hex referral_code', () => {
    const re = /^[a-f0-9]{12}$/
    for (const r of MOCK_REFERRERS) {
      expect(r.referral_code).toMatch(re)
    }
  })

  it('referrals_rewarded never exceeds referrals_total', () => {
    for (const r of MOCK_REFERRERS) {
      expect(r.referrals_rewarded).toBeLessThanOrEqual(r.referrals_total)
    }
  })

  it('bonus_credits_earned respects the 50-credit cap', () => {
    for (const r of MOCK_REFERRERS) {
      expect(r.bonus_credits_earned).toBeLessThanOrEqual(50)
    }
  })

  it('bonus_credits_earned == min(rewarded * 10, 50)', () => {
    for (const r of MOCK_REFERRERS) {
      expect(r.bonus_credits_earned).toBe(Math.min(50, r.referrals_rewarded * 10))
    }
  })
})

describe('MOCK_REFERRAL_EVENTS', () => {
  it('has at least 10 events', () => {
    expect(MOCK_REFERRAL_EVENTS.length).toBeGreaterThanOrEqual(10)
  })

  it('rewarded events have a rewarded_at timestamp', () => {
    for (const e of MOCK_REFERRAL_EVENTS) {
      if (e.status === 'rewarded') {
        expect(e.rewarded_at).not.toBeNull()
      }
    }
  })

  it('pending events have a null rewarded_at', () => {
    for (const e of MOCK_REFERRAL_EVENTS) {
      if (e.status === 'pending') {
        expect(e.rewarded_at).toBeNull()
      }
    }
  })

  it('every event has a unique id', () => {
    const ids = MOCK_REFERRAL_EVENTS.map((e) => e.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe('mockReferralTotals', () => {
  it('returns finite non-negative numbers across all fields', () => {
    const t = mockReferralTotals()
    for (const v of [t.total, t.pending, t.rewarded, t.bonusCredited]) {
      expect(Number.isFinite(v)).toBe(true)
      expect(v).toBeGreaterThanOrEqual(0)
    }
  })

  it('total == pending + rewarded', () => {
    const t = mockReferralTotals()
    expect(t.total).toBe(t.pending + t.rewarded)
  })

  it('bonusCredited matches the sum across referrers', () => {
    const t = mockReferralTotals()
    const expected = MOCK_REFERRERS.reduce((n, r) => n + r.bonus_credits_earned, 0)
    expect(t.bonusCredited).toBe(expected)
  })
})
