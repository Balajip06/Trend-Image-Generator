'use client'

import { Sparkles } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { GradientButton } from '@/components/brand/GradientButton'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils/cn'
import type { CreditPack } from '@/lib/payments/packs'

interface PackView {
  id: CreditPack['id']
  label: string
  credits: number
  priceCents: number
  perCreditCents: number
}

interface CreditPacksClientProps {
  packs: PackView[]
}

export function CreditPacksClient({ packs }: CreditPacksClientProps) {
  const [pendingId, setPendingId] = useState<string | null>(null)

  const onBuy = async (packId: string) => {
    setPendingId(packId)
    try {
      const res = await fetch('/api/stripe/checkout', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ pack_id: packId }),
      })
      const json = (await res.json()) as { checkout_url?: string; error?: string }
      if (!res.ok || !json.checkout_url) {
        throw new Error(json.error ?? `Checkout failed (${res.status})`)
      }
      // Hard nav to Stripe Checkout — intentional. router.push cannot leave the
      // origin and Stripe Checkout requires a full document navigation.
      // eslint-disable-next-line react-hooks/immutability
      window.location.href = json.checkout_url
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Checkout failed')
      setPendingId(null)
    }
  }

  return (
    <ul className="grid gap-3 sm:grid-cols-3">
      {packs.map((pack) => {
        const dollars = (pack.priceCents / 100).toFixed(2)
        const perCredit = (pack.perCreditCents / 100).toFixed(3)
        const pending = pendingId === pack.id
        const popular = pack.id === 'medium'
        return (
          <li
            key={pack.id}
            className={cn(
              'bg-card relative flex flex-col gap-4 rounded-2xl border p-5 transition-shadow',
              popular
                ? 'shadow-glow-pink border-[var(--brand-grad-1)]/40'
                : 'border-border/60 hover:shadow-soft'
            )}
          >
            {popular && (
              <Badge className="bg-gradient-hero absolute -top-2 left-5 rounded-full px-2.5 py-0.5 text-[10px] font-bold tracking-wider text-white uppercase">
                <Sparkles className="size-3" /> Most popular
              </Badge>
            )}
            <div className="flex flex-col gap-1">
              <h3 className="text-base font-bold">{pack.label}</h3>
              <p className="text-muted-foreground text-xs">${perCredit} / credit</p>
            </div>
            <div className="flex items-baseline gap-1">
              <span className="text-3xl font-extrabold">${dollars}</span>
              <span className="text-muted-foreground text-xs">USD</span>
            </div>
            <GradientButton
              size="sm"
              onClick={() => onBuy(pack.id)}
              disabled={pendingId !== null}
              className={cn(
                'w-full',
                !popular && 'bg-foreground text-background bg-none shadow-none'
              )}
            >
              {pending ? 'Opening…' : `Buy ${pack.credits} credits`}
            </GradientButton>
          </li>
        )
      })}
    </ul>
  )
}
