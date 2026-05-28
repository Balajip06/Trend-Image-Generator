/**
 * Common shape returned by each social-source poller.
 * Sources differ in feed structure but share these signals — momentum
 * (delta per hour/day), exemplar links + thumbnails, and a free-form
 * description that goes into the LLM proposer.
 */

export type SourceId = 'tiktok' | 'instagram' | 'reddit'

export interface TrendCandidate {
  source: SourceId
  /** Stable id per source — used to dedupe across poller runs. */
  external_id: string
  /** Display title for the admin inbox (e.g. hashtag, sound name, subreddit post title). */
  title: string
  /** Short text the LLM proposer uses to draft prompt_template + input_schema. */
  description: string
  /** Sample exemplar URLs for admin review (thumbnails preferred over full videos). */
  exemplar_urls: string[]
  /**
   * Momentum signal. Each source defines its own metric:
   *   - TikTok: 7-day video count delta
   *   - Instagram: 24h hashtag impressions estimate
   *   - Reddit: post upvote velocity (upvotes / hour since post)
   */
  momentum_score: number
  /** Original post URL for click-through verification by admins. */
  source_url: string
  /** ISO timestamp when candidate was observed (used to filter stale rows). */
  observed_at: string
}

export interface SourceFetchOptions {
  /** Soft cap; sources may return fewer. Default 25. */
  limit?: number
  /** Skip candidates with momentum below this threshold. Default 0 (no filter). */
  minMomentum?: number
}

export interface SourceFetcher {
  id: SourceId
  fetchTrending(options?: SourceFetchOptions): Promise<TrendCandidate[]>
}
