'use client'

import { ExternalLink } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'

// Local types until database.types.ts is regenerated (Task 7)
type SubscriptionPlan = 'starter50' | 'pro200' | 'studio600'
type SubscriptionStatus = 'active' | 'past_due' | 'canceled' | 'incomplete' | 'trialing'

export interface SubscriptionRow {
  plan: SubscriptionPlan
  status: SubscriptionStatus
  cancel_at_period_end: boolean
  current_period_end: string | null
  monthly_credit_allotment: number
}

interface SubscriptionClientProps {
  subscription: SubscriptionRow | null
}

const PLAN_LABELS: Record<SubscriptionPlan, string> = {
  starter50: 'Starter — 50 credits/mo',
  pro200: 'Pro — 200 credits/mo',
  studio600: 'Studio — 600 credits/mo',
}

export function SubscriptionClient({ subscription }: SubscriptionClientProps) {
  const [loading, setLoading] = useState(false)

  const openPortal = async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/stripe/portal', { method: 'POST' })
      const json = (await res.json()) as { url?: string; error?: string }
      if (!res.ok || !json.url) throw new Error(json.error ?? 'Portal unavailable')
      window.location.href = json.url
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not open billing portal')
      setLoading(false)
    }
  }

  if (!subscription) {
    return (
      <div className="flex flex-col gap-4">
        <p className="text-muted-foreground text-sm">No active subscription. Choose a plan below.</p>
        <div className="grid gap-3 sm:grid-cols-3">
          {(['starter50', 'pro200', 'studio600'] as const).map((id) => (
            <PlanCard key={id} planId={id} />
          ))}
        </div>
      </div>
    )
  }

  const periodEnd = subscription.current_period_end
    ? new Date(subscription.current_period_end).toLocaleDateString()
    : null

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3 flex-wrap">
        <Badge
          variant={subscription.status === 'active' ? 'default' : 'destructive'}
          className="rounded-full"
        >
          {subscription.status}
        </Badge>
        <span className="text-sm font-medium">{PLAN_LABELS[subscription.plan]}</span>
      </div>
      {subscription.cancel_at_period_end && periodEnd && (
        <p className="text-muted-foreground text-xs">
          Cancels on {periodEnd} — credits stop then.
        </p>
      )}
      {!subscription.cancel_at_period_end && periodEnd && (
        <p className="text-muted-foreground text-xs">
          Renews {periodEnd} · {subscription.monthly_credit_allotment} credits/mo
        </p>
      )}
      <Button
        variant="outline"
        size="sm"
        onClick={openPortal}
        disabled={loading}
        className="w-fit rounded-full gap-2"
      >
        <ExternalLink className="size-3.5" />
        {loading ? 'Opening…' : 'Manage subscription'}
      </Button>
    </div>
  )
}

function PlanCard({ planId }: { planId: SubscriptionPlan }) {
  const [loading, setLoading] = useState(false)

  const PLAN_INFO: Record<SubscriptionPlan, { credits: number; price: string }> = {
    starter50: { credits: 50, price: '$4.99' },
    pro200: { credits: 200, price: '$14.99' },
    studio600: { credits: 600, price: '$39.99' },
  }
  const info = PLAN_INFO[planId]

  const subscribe = async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/stripe/checkout', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ plan_id: planId }),
      })
      const json = (await res.json()) as { checkout_url?: string; error?: string }
      if (!res.ok || !json.checkout_url) throw new Error(json.error ?? 'Checkout failed')
      window.location.href = json.checkout_url
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Checkout failed')
      setLoading(false)
    }
  }

  return (
    <div className="bg-card border-border/60 flex flex-col gap-3 rounded-2xl border p-4">
      <p className="text-sm font-bold">{info.credits} credits/mo</p>
      <p className="text-2xl font-extrabold">
        {info.price}
        <span className="text-muted-foreground text-xs font-normal">/mo</span>
      </p>
      <Button size="sm" onClick={subscribe} disabled={loading} className="w-full rounded-full">
        {loading ? 'Opening…' : 'Subscribe'}
      </Button>
    </div>
  )
}
