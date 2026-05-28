'use client'

import { useState } from 'react'
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
  const [error, setError] = useState<string | null>(null)

  const onBuy = async (packId: string) => {
    setPendingId(packId)
    setError(null)
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
      window.location.href = json.checkout_url
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Checkout failed')
      setPendingId(null)
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <ul className="grid gap-3 sm:grid-cols-3">
        {packs.map((pack) => {
          const dollars = (pack.priceCents / 100).toFixed(2)
          const perCredit = (pack.perCreditCents / 100).toFixed(3)
          const pending = pendingId === pack.id
          return (
            <li
              key={pack.id}
              className="flex flex-col gap-3 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900"
            >
              <div>
                <h3 className="text-sm font-medium text-zinc-900 dark:text-zinc-50">
                  {pack.label}
                </h3>
                <p className="mt-0.5 text-xs text-zinc-500">${perCredit} / credit</p>
              </div>
              <div className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
                ${dollars}
              </div>
              <button
                type="button"
                onClick={() => onBuy(pack.id)}
                disabled={pendingId !== null}
                className="h-9 rounded-md bg-zinc-900 px-3 text-xs font-medium text-zinc-50 hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
              >
                {pending ? 'Opening…' : `Buy ${pack.credits} credits`}
              </button>
            </li>
          )
        })}
      </ul>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  )
}
