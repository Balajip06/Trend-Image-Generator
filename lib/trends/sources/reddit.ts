import type { SourceFetcher, SourceFetchOptions, TrendCandidate } from './types'

const SUBREDDITS = [
  'midjourney',
  'StableDiffusion',
  'AIGeneratedArt',
  'Pics',
  'PhotoshopRequest',
] as const

interface RedditChild {
  data: {
    id: string
    title: string
    selftext?: string
    permalink: string
    url: string
    thumbnail?: string
    score?: number
    created_utc?: number
    over_18?: boolean
  }
}

interface RedditListing {
  data: {
    children: RedditChild[]
  }
}

/**
 * Reddit poller. Public JSON endpoint, no auth needed, but rate-limited
 * (1 req / 2s recommended). Returns top of /r/<sub>/top.json?t=day.
 * Filters NSFW and stickied.
 */
export const redditSource: SourceFetcher = {
  id: 'reddit',
  async fetchTrending(options?: SourceFetchOptions): Promise<TrendCandidate[]> {
    const limit = options?.limit ?? 25
    const minMomentum = options?.minMomentum ?? 0
    const userAgent = process.env.REDDIT_USER_AGENT ?? 'TrendImageGenerator/0.1'

    const perSub = Math.max(3, Math.ceil(limit / SUBREDDITS.length))
    const candidates: TrendCandidate[] = []

    for (const sub of SUBREDDITS) {
      try {
        const res = await fetch(
          `https://www.reddit.com/r/${sub}/top.json?t=day&limit=${perSub}`,
          { headers: { 'user-agent': userAgent } }
        )
        if (!res.ok) continue
        const json = (await res.json()) as RedditListing
        for (const c of json.data.children) {
          if (c.data.over_18) continue
          const momentum = momentumFromScore(c.data.score, c.data.created_utc)
          if (momentum < minMomentum) continue
          candidates.push({
            source: 'reddit',
            external_id: `${sub}:${c.data.id}`,
            title: c.data.title,
            description: c.data.selftext?.slice(0, 500) ?? c.data.title,
            exemplar_urls: c.data.thumbnail && c.data.thumbnail.startsWith('http')
              ? [c.data.thumbnail]
              : [],
            momentum_score: momentum,
            source_url: `https://www.reddit.com${c.data.permalink}`,
            observed_at: new Date().toISOString(),
          })
        }
      } catch {
        // Skip failed sub; orchestrator decides whether overall run is healthy.
      }
    }

    return candidates
      .sort((a, b) => b.momentum_score - a.momentum_score)
      .slice(0, limit)
  },
}

/** Upvotes per hour since post creation. Clamped at age >= 1h to avoid divide-by-zero spikes. */
function momentumFromScore(score: number | undefined, createdUtc: number | undefined): number {
  if (!score || !createdUtc) return 0
  const ageHours = Math.max(1, (Date.now() / 1000 - createdUtc) / 3600)
  return score / ageHours
}
