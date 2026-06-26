/**
 * Subscription plans — monthly credits via Stripe.
 * Structure mirrors lib/payments/packs.ts exactly.
 * Allotment is resolved HERE from the Stripe price_id — never from event amounts.
 */

export type PlanId = 'starter50' | 'pro200' | 'studio600'

export interface SubscriptionPlan {
  id: PlanId
  label: string
  monthlyCredits: number
  priceIdEnv: string
  priceCentsMonthly: number // for display only
}

export const SUBSCRIPTION_PLANS: ReadonlyArray<SubscriptionPlan> = [
  {
    id: 'starter50',
    label: 'Starter — 50 credits/mo',
    monthlyCredits: 50,
    priceIdEnv: 'STRIPE_PRICE_ID_SUB_STARTER',
    priceCentsMonthly: 499,
  },
  {
    id: 'pro200',
    label: 'Pro — 200 credits/mo',
    monthlyCredits: 200,
    priceIdEnv: 'STRIPE_PRICE_ID_SUB_PRO',
    priceCentsMonthly: 1499,
  },
  {
    id: 'studio600',
    label: 'Studio — 600 credits/mo',
    monthlyCredits: 600,
    priceIdEnv: 'STRIPE_PRICE_ID_SUB_STUDIO',
    priceCentsMonthly: 3999,
  },
]

export function findPlan(id: PlanId | string): SubscriptionPlan | null {
  return SUBSCRIPTION_PLANS.find((p) => p.id === id) ?? null
}

export function isPlanId(value: unknown): value is PlanId {
  return value === 'starter50' || value === 'pro200' || value === 'studio600'
}

/**
 * Resolve plan by Stripe price_id (used in webhook to derive allotment).
 * This is the authoritative allotment source — never use invoice amounts.
 */
export function findPlanByPriceId(priceId: string): SubscriptionPlan | null {
  for (const plan of SUBSCRIPTION_PLANS) {
    const envId = process.env[plan.priceIdEnv]
    if (envId && envId === priceId) return plan
  }
  return null
}

export function requirePlanPriceId(plan: SubscriptionPlan): string {
  const id = process.env[plan.priceIdEnv]
  if (!id)
    throw new Error(`${plan.priceIdEnv} is not set — create the Stripe price for "${plan.label}"`)
  return id
}
