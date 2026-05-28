import type { SourceFetcher, TrendCandidate } from './types'

/**
 * TikTok poller stub. Production implementation will use either the official
 * TikTok Creative Center API (requires business account) or a Discover-page
 * scrape via Playwright + rotating residential proxies.
 *
 * For Phase 6 prep, fetchTrending returns [] when no integration is wired,
 * so the orchestrator can be exercised end-to-end without external calls.
 */
export const tiktokSource: SourceFetcher = {
  id: 'tiktok',
  async fetchTrending(): Promise<TrendCandidate[]> {
    const key = process.env.TIKTOK_CREATIVE_CENTER_KEY
    if (!key) return []
    // TODO Phase 6 impl: GET https://business-api.tiktok.com/open_api/v1.3/cc/trend/hashtag/...
    return []
  },
}
