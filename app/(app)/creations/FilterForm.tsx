'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { useRef, useTransition } from 'react'
import { Input } from '@/components/ui/input'

interface TrendOption {
  id: string
  title: string
}

interface FilterFormProps {
  rawQ: string
  trendFilter: string
  range: string
  view: 'all' | 'favorites'
  trendOptions: TrendOption[]
  isFiltered: boolean
}

export function FilterForm({
  rawQ,
  trendFilter,
  range,
  view,
  trendOptions,
  isFiltered,
}: FilterFormProps) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const formRef = useRef<HTMLFormElement>(null)

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const data = new FormData(e.currentTarget)
    const params = new URLSearchParams()
    for (const key of ['q', 'trend', 'range']) {
      const value = data.get(key)
      if (typeof value === 'string' && value) params.set(key, value)
    }
    if (view !== 'all') params.set('view', view)
    const qs = params.toString()
    startTransition(() => {
      router.push(qs ? `/creations?${qs}` : '/creations')
    })
  }

  return (
    <form
      ref={formRef}
      onSubmit={onSubmit}
      className="border-border/60 bg-card/40 flex flex-col gap-3 rounded-2xl border p-4 sm:flex-row sm:items-end"
    >
      <label className="flex-1">
        <span className="text-muted-foreground mb-1 block text-xs font-medium">Search</span>
        <Input
          name="q"
          defaultValue={rawQ}
          maxLength={100}
          placeholder="Search prompts, trends…"
        />
      </label>
      <label className="sm:w-44">
        <span className="text-muted-foreground mb-1 block text-xs font-medium">Trend</span>
        <select
          name="trend"
          defaultValue={trendFilter}
          className="border-input focus-visible:border-ring focus-visible:ring-ring/50 bg-background text-foreground h-9 w-full rounded-md border px-3 text-sm shadow-xs outline-none focus-visible:ring-[3px]"
        >
          <option value="">All trends</option>
          {trendOptions.map((t) => (
            <option key={t.id} value={t.id}>
              {t.title}
            </option>
          ))}
        </select>
      </label>
      <label className="sm:w-32">
        <span className="text-muted-foreground mb-1 block text-xs font-medium">Range</span>
        <select
          name="range"
          defaultValue={range}
          className="border-input focus-visible:border-ring focus-visible:ring-ring/50 bg-background text-foreground h-9 w-full rounded-md border px-3 text-sm shadow-xs outline-none focus-visible:ring-[3px]"
        >
          <option value="all">All time</option>
          <option value="24h">Last 24h</option>
          <option value="7d">Last 7 days</option>
          <option value="30d">Last 30 days</option>
        </select>
      </label>
      <div className="flex gap-2 sm:items-end">
        <button
          type="submit"
          disabled={pending}
          className="border-border bg-foreground text-background flex h-9 items-center gap-1.5 rounded-md border px-4 text-sm font-semibold transition-opacity hover:opacity-90 disabled:opacity-60"
        >
          {pending && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
          {pending ? 'Filtering…' : 'Filter'}
        </button>
        {isFiltered ? (
          <Link
            href="/creations"
            className="border-border text-muted-foreground hover:text-foreground grid h-9 place-items-center rounded-md border px-3 text-sm"
          >
            Reset
          </Link>
        ) : null}
      </div>
    </form>
  )
}
