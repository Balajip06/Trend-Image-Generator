/**
 * Dev fixtures for /admin/referrals. Mirrors the shape of the live join
 * (referrals × profiles) so the admin view renders the same surface in mock
 * mode as it will when real Supabase data lands.
 *
 * Deterministic — no time-based randomness — so screenshot diffs stay stable.
 */

export type ReferralStatus = 'pending' | 'rewarded'

export interface MockReferrer {
  id: string
  email: string
  referral_code: string
  referrals_total: number
  referrals_rewarded: number
  bonus_credits_earned: number
  joined_at: string
}

export interface MockReferralEvent {
  id: string
  referrer_email: string
  referred_email: string
  status: ReferralStatus
  created_at: string
  rewarded_at: string | null
}

const ONE_DAY = 86_400_000
const TODAY = new Date('2026-05-29T00:00:00Z').getTime()

function isoDaysAgo(n: number): string {
  return new Date(TODAY - n * ONE_DAY).toISOString()
}

export const MOCK_REFERRERS: MockReferrer[] = [
  {
    id: '00000000-0000-4000-8000-000000000101',
    email: 'maya@trendly.dev',
    referral_code: 'a1b2c3d4e5f6',
    referrals_total: 14,
    referrals_rewarded: 11,
    bonus_credits_earned: 50,
    joined_at: isoDaysAgo(28),
  },
  {
    id: '00000000-0000-4000-8000-000000000102',
    email: 'jordan@trendly.dev',
    referral_code: 'b2c3d4e5f6a1',
    referrals_total: 9,
    referrals_rewarded: 7,
    bonus_credits_earned: 50,
    joined_at: isoDaysAgo(24),
  },
  {
    id: '00000000-0000-4000-8000-000000000103',
    email: 'sam@trendly.dev',
    referral_code: 'c3d4e5f6a1b2',
    referrals_total: 6,
    referrals_rewarded: 4,
    bonus_credits_earned: 40,
    joined_at: isoDaysAgo(19),
  },
  {
    id: '00000000-0000-4000-8000-000000000104',
    email: 'priya@trendly.dev',
    referral_code: 'd4e5f6a1b2c3',
    referrals_total: 5,
    referrals_rewarded: 5,
    bonus_credits_earned: 50,
    joined_at: isoDaysAgo(15),
  },
  {
    id: '00000000-0000-4000-8000-000000000105',
    email: 'alex@trendly.dev',
    referral_code: 'e5f6a1b2c3d4',
    referrals_total: 4,
    referrals_rewarded: 2,
    bonus_credits_earned: 20,
    joined_at: isoDaysAgo(12),
  },
  {
    id: '00000000-0000-4000-8000-000000000106',
    email: 'noah@trendly.dev',
    referral_code: 'f6a1b2c3d4e5',
    referrals_total: 3,
    referrals_rewarded: 2,
    bonus_credits_earned: 20,
    joined_at: isoDaysAgo(8),
  },
  {
    id: '00000000-0000-4000-8000-000000000107',
    email: 'leila@trendly.dev',
    referral_code: '6f5e4d3c2b1a',
    referrals_total: 2,
    referrals_rewarded: 1,
    bonus_credits_earned: 10,
    joined_at: isoDaysAgo(5),
  },
  {
    id: '00000000-0000-4000-8000-000000000108',
    email: 'kai@trendly.dev',
    referral_code: '1a2b3c4d5e6f',
    referrals_total: 1,
    referrals_rewarded: 0,
    bonus_credits_earned: 0,
    joined_at: isoDaysAgo(3),
  },
]

export const MOCK_REFERRAL_EVENTS: MockReferralEvent[] = [
  {
    id: 'mock-ref-001',
    referrer_email: 'maya@trendly.dev',
    referred_email: 'taylor@example.com',
    status: 'rewarded',
    created_at: isoDaysAgo(1),
    rewarded_at: isoDaysAgo(0),
  },
  {
    id: 'mock-ref-002',
    referrer_email: 'jordan@trendly.dev',
    referred_email: 'casey@example.com',
    status: 'rewarded',
    created_at: isoDaysAgo(1),
    rewarded_at: isoDaysAgo(1),
  },
  {
    id: 'mock-ref-003',
    referrer_email: 'priya@trendly.dev',
    referred_email: 'avery@example.com',
    status: 'pending',
    created_at: isoDaysAgo(2),
    rewarded_at: null,
  },
  {
    id: 'mock-ref-004',
    referrer_email: 'maya@trendly.dev',
    referred_email: 'morgan@example.com',
    status: 'rewarded',
    created_at: isoDaysAgo(3),
    rewarded_at: isoDaysAgo(2),
  },
  {
    id: 'mock-ref-005',
    referrer_email: 'sam@trendly.dev',
    referred_email: 'sky@example.com',
    status: 'pending',
    created_at: isoDaysAgo(3),
    rewarded_at: null,
  },
  {
    id: 'mock-ref-006',
    referrer_email: 'noah@trendly.dev',
    referred_email: 'jess@example.com',
    status: 'rewarded',
    created_at: isoDaysAgo(4),
    rewarded_at: isoDaysAgo(3),
  },
  {
    id: 'mock-ref-007',
    referrer_email: 'leila@trendly.dev',
    referred_email: 'rowan@example.com',
    status: 'pending',
    created_at: isoDaysAgo(5),
    rewarded_at: null,
  },
  {
    id: 'mock-ref-008',
    referrer_email: 'jordan@trendly.dev',
    referred_email: 'remi@example.com',
    status: 'rewarded',
    created_at: isoDaysAgo(6),
    rewarded_at: isoDaysAgo(5),
  },
  {
    id: 'mock-ref-009',
    referrer_email: 'alex@trendly.dev',
    referred_email: 'quinn@example.com',
    status: 'rewarded',
    created_at: isoDaysAgo(7),
    rewarded_at: isoDaysAgo(6),
  },
  {
    id: 'mock-ref-010',
    referrer_email: 'kai@trendly.dev',
    referred_email: 'devon@example.com',
    status: 'pending',
    created_at: isoDaysAgo(8),
    rewarded_at: null,
  },
]

export function mockReferralTotals(): {
  total: number
  pending: number
  rewarded: number
  bonusCredited: number
} {
  let pending = 0
  let rewarded = 0
  for (const r of MOCK_REFERRERS) {
    pending += r.referrals_total - r.referrals_rewarded
    rewarded += r.referrals_rewarded
  }
  const bonusCredited = MOCK_REFERRERS.reduce((n, r) => n + r.bonus_credits_earned, 0)
  return {
    total: pending + rewarded,
    pending,
    rewarded,
    bonusCredited,
  }
}
