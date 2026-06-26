import { Ratelimit } from '@upstash/ratelimit'
import { Redis } from '@upstash/redis'

type Limiter = {
  limit: (
    identifier: string
  ) => Promise<{ success: boolean; limit: number; remaining: number; reset: number }>
}

const passThroughLimiter: Limiter = {
  async limit() {
    return { success: true, limit: Infinity, remaining: Infinity, reset: 0 }
  },
}

let cachedRedis: Redis | null = null
function getRedis(): Redis | null {
  if (cachedRedis) return cachedRedis
  const url = process.env.UPSTASH_REDIS_REST_URL
  const token = process.env.UPSTASH_REDIS_REST_TOKEN
  if (!url || !token) return null
  cachedRedis = new Redis({ url, token })
  return cachedRedis
}

function createLimiter(
  prefix: string,
  requests: number,
  window: `${number} ${'s' | 'm' | 'h' | 'd'}`
): Limiter {
  const redis = getRedis()
  if (!redis) return passThroughLimiter
  return new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(requests, window),
    prefix,
    analytics: true,
  })
}

// 20 generations / hour / IP — per amended plan §"Non-Negotiables"
export const generationIpLimiter = createLimiter('rl:gen:ip', 20, '1 h')

// Per-user rate limiter: 30/hr. Applied to ALL tiers including unlimited.
// Defeats IP-rotation abuse on shared accounts (H-C1, Risk #1).
export const generationUserLimiter = createLimiter('rl:gen:user', 30, '1 h')

// 5 anonymous attempts / day / fingerprint — extra guard beyond DB unique
export const anonymousFingerprintLimiter = createLimiter('rl:anon:fp', 5, '1 d')

// 5 GDPR exports / hour / user — bounds Storage signed-URL bursts + analytics
export const exportUserLimiter = createLimiter('rl:export:user', 5, '1 h')

// 60 trend-event POSTs / minute / IP — covers genuine browse traffic (one
// impression per card view + maybe one click) while killing the analytics
// inflation surface flagged in red-team M1. /api/track stays unauthenticated
// by design (we want pre-signup impressions) but unbounded writes let any
// attacker rewrite the "viral" leaderboard.
export const trackIpLimiter = createLimiter('rl:track:ip', 60, '1 m')
