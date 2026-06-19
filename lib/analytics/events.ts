/**
 * PostHog event catalog. Single source of truth for event names + payload shapes
 * so producers (client/server) and consumers (PostHog Insights, anomaly queries)
 * stay aligned.
 *
 * Conventions per amended plan §"Phase 4":
 *   - snake_case names, action_object form
 *   - All events include `trend_slug` when scoped to a trend so funnel UIs filter cleanly
 *   - PII-free: never log raw image URLs, emails, IPs
 */

export const EVENTS = {
  TREND_VIEW: 'trend_view',
  UPLOAD_STARTED: 'upload_started',
  GENERATE_CLICKED: 'generate_clicked',
  GENERATE_COMPLETED: 'generate_completed',
  GENERATE_FAILED: 'generate_failed',
  SHARE_CLICKED: 'share_clicked',
  DOWNLOAD_CLICKED: 'download_clicked',
  REFERRAL_REDEEMED: 'referral_redeemed',
  PUSH_PERMISSION_REQUESTED: 'push_permission_requested',
  PUSH_PERMISSION_GRANTED: 'push_permission_granted',
  PUSH_PERMISSION_DENIED: 'push_permission_denied',
  CHECKOUT_STARTED: 'checkout_started',
  CHECKOUT_COMPLETED: 'checkout_completed',
  SIGNUP_COMPLETED: 'signup_completed',
  ACCOUNT_DELETED: 'account_deleted',
  DATA_EXPORTED: 'data_exported',
  SUBSCRIPTION_STARTED: 'subscription_started',
  SUBSCRIPTION_RENEWED: 'subscription_renewed',
  SUBSCRIPTION_FAILED: 'subscription_failed',
  SUBSCRIPTION_CANCELED: 'subscription_canceled',
  UNLIMITED_GRANTED: 'unlimited_granted',
  UNLIMITED_REVOKED: 'unlimited_revoked',
  MODEL_PROVIDER_SWITCHED: 'model_provider_switched',
  GENERATE_PROVIDER_FAILED: 'generate_provider_failed',
  SSO_FAILED: 'sso_failed',
  STATUS_API_FAILED: 'status_api_failed',
} as const

export type EventName = (typeof EVENTS)[keyof typeof EVENTS]

export interface BasePayload {
  trend_slug?: string
  trend_id?: string
  source?: 'web' | 'mobile_web' | 'pwa'
}

export interface GenerateClickedPayload extends BasePayload {
  trend_slug: string
  model: 'nano-banana' | 'nano-banana-pro' | 'gpt-image'
  is_anonymous: boolean
}

export interface GenerateCompletedPayload extends BasePayload {
  trend_slug: string
  duration_ms: number
  cost_usd: number
  attempts: number
}

export interface GenerateFailedPayload extends BasePayload {
  trend_slug: string
  reason: 'safety' | 'timeout' | 'transient' | 'invalid'
  attempts: number
}

export interface ShareClickedPayload extends BasePayload {
  trend_slug: string
  channel: 'instagram' | 'tiktok' | 'twitter' | 'whatsapp' | 'web_share' | 'copy_link'
}

export interface ReferralRedeemedPayload {
  referrer_id_hash: string
  bonus_credits: number
  total_bonus_earned: number
}

export interface PayloadByEvent {
  [EVENTS.TREND_VIEW]: BasePayload & { trend_slug: string }
  [EVENTS.UPLOAD_STARTED]: BasePayload & { trend_slug: string; file_count: number }
  [EVENTS.GENERATE_CLICKED]: GenerateClickedPayload
  [EVENTS.GENERATE_COMPLETED]: GenerateCompletedPayload
  [EVENTS.GENERATE_FAILED]: GenerateFailedPayload
  [EVENTS.SHARE_CLICKED]: ShareClickedPayload
  [EVENTS.DOWNLOAD_CLICKED]: BasePayload & { trend_slug: string; watermarked: boolean }
  [EVENTS.REFERRAL_REDEEMED]: ReferralRedeemedPayload
  [EVENTS.PUSH_PERMISSION_REQUESTED]: BasePayload
  [EVENTS.PUSH_PERMISSION_GRANTED]: BasePayload
  [EVENTS.PUSH_PERMISSION_DENIED]: BasePayload
  [EVENTS.CHECKOUT_STARTED]: BasePayload & { credit_pack: '50' | '200' | '600'; price_usd: number }
  [EVENTS.CHECKOUT_COMPLETED]: BasePayload & {
    credit_pack: '50' | '200' | '600'
    price_usd: number
  }
  [EVENTS.SIGNUP_COMPLETED]: BasePayload & { method: 'google' | 'magic_link'; referred: boolean }
  [EVENTS.ACCOUNT_DELETED]: BasePayload
  [EVENTS.DATA_EXPORTED]: BasePayload & { generation_count: number }
  [EVENTS.SUBSCRIPTION_STARTED]: BasePayload & {
    plan: string
    method: 'new' | 'upgrade' | 'downgrade'
  }
  [EVENTS.SUBSCRIPTION_RENEWED]: BasePayload & { plan: string; allotment: number }
  [EVENTS.SUBSCRIPTION_FAILED]: BasePayload & { plan: string; reason: string }
  [EVENTS.SUBSCRIPTION_CANCELED]: BasePayload & { plan: string }
  [EVENTS.UNLIMITED_GRANTED]: BasePayload & { grant_source: 'oidc' | 'status_api' | 'allowlist' }
  [EVENTS.UNLIMITED_REVOKED]: BasePayload & { reason: 'churn' | 'allowlist_deactivated' }
  [EVENTS.MODEL_PROVIDER_SWITCHED]: BasePayload & {
    from: string
    to: string
    affected_trends: number
  }
  [EVENTS.GENERATE_PROVIDER_FAILED]: BasePayload & {
    provider: 'gemini' | 'openai'
    reason: string
    trend_slug: string
  }
  [EVENTS.SSO_FAILED]: BasePayload & { provider: 'kimp360' | 'google'; step: string }
  [EVENTS.STATUS_API_FAILED]: BasePayload & { checked: number; error: string }
}

/**
 * Typed wrapper for posthog.capture; ensures payload shape matches the event.
 * Caller passes their PostHog instance to avoid a hard dependency here.
 */
export interface PosthogLike {
  capture: (event: string, properties?: Record<string, unknown>) => void
}

export function track<E extends EventName>(
  posthog: PosthogLike | null | undefined,
  event: E,
  payload: PayloadByEvent[E]
): void {
  if (!posthog) return
  posthog.capture(event, payload as Record<string, unknown>)
}
