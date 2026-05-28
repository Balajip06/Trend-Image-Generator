import type { SourceFetcher, SourceFetchOptions, TrendCandidate } from './types'

/**
 * Instagram poller stub. No public trending API; production will likely
 * scrape Explore + hashtag aggregation pages via Playwright + ig_login_cookie
 * (acceptable-use grey area — see plan §"Risks"). Backup: oEmbed + manual
 * curator pipeline.
 */
export const instagramSource: SourceFetcher = {
  id: 'instagram',
  async fetchTrending(_options?: SourceFetchOptions): Promise<TrendCandidate[]> {
    const cookie = process.env.INSTAGRAM_SESSION_COOKIE
    if (!cookie) return []
    // TODO Phase 6 impl: scrape explore page; rate-limit + rotating proxy required.
    return []
  },
}
