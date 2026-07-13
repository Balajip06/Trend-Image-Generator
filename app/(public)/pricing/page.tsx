import type { Metadata } from 'next'
import Link from 'next/link'
import { Check, Sparkles } from 'lucide-react'
import { GradientButton } from '@/components/brand/GradientButton'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'
import { Badge } from '@/components/ui/badge'
import { CREDIT_PACKS, type PackId } from '@/lib/payments/packs'

export const dynamic = 'force-static'
export const revalidate = 3600

export async function generateMetadata(): Promise<Metadata> {
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'
  const title = 'Pricing — Trendly'
  const description =
    'Pay once, never expire. Three simple credit packs from $4.99 — no subscription, no auto-renew, refund-on-failure built in.'
  return {
    title,
    description,
    alternates: { canonical: `${siteUrl}/pricing` },
    openGraph: {
      title,
      description,
      type: 'website',
      url: `${siteUrl}/pricing`,
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
    },
  }
}

interface PackCopy {
  bestFor: string
  highlight?: boolean
}

const PACK_COPY: Record<PackId, PackCopy> = {
  small: { bestFor: 'Best for trying a few premium trends.' },
  medium: { bestFor: 'Best value — what most creators pick.', highlight: true },
  large: { bestFor: 'Best for heavy creators and content batches.' },
}

function formatUsd(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`
}

function formatPerCredit(cents: number): string {
  // perCreditCents is a fractional number of cents per credit (e.g. 7.495).
  // Display in cents with 1 decimal place to avoid implying false precision.
  return `${cents.toFixed(1)}¢ / credit`
}

const VALUE_ROWS: Array<{ title: string; body: string }> = [
  {
    title: 'Nano Banana Pro on every credit',
    body: 'Google’s newest image model — same quality whether you bought 50 credits or 600.',
  },
  {
    title: 'No watermark on Pro tier',
    body: 'Free tier downloads carry a subtle Trendly watermark. Paid downloads are clean.',
  },
  {
    title: 'Save your generations forever',
    body: 'Free generations purge after 30 days. Pro generations stay until you delete them.',
  },
  {
    title: 'Fast renders — 8s median',
    body: 'Most images are ready before you’d finish typing the caption.',
  },
  {
    title: 'Refund-on-failure built in',
    body: 'Safety reject? Upstream timeout? Credits return to your balance automatically.',
  },
  {
    title: 'Fair-use guarantee',
    body: 'No surprise rate limits. Generate at the pace your creativity sets.',
  },
]

// TODO: replace with real numbers once W7+ accrual hits — currently placeholder
// data so the surface is reviewable before launch traffic exists.
const TRUST_TILES: Array<{ stat: string; label: string }> = [
  { stat: '12K+', label: 'generations shipped' },
  { stat: '4.9★', label: 'on Trustpilot' },
  { stat: '8s', label: 'median render time' },
  { stat: '0', label: 'subscriptions to cancel' },
]

const FAQ: Array<{ q: string; a: string }> = [
  {
    q: 'Why credits and not a monthly subscription?',
    a: 'Subscriptions punish people who only want to try one trend. Credits stay in your account until you use them — no auto-renew, no cancellation flow, no surprise charges.',
  },
  {
    q: 'Do credits expire?',
    a: 'No. Once you buy a pack, the credits sit in your account forever. If we ever change that policy, your existing balance is grandfathered.',
  },
  {
    q: 'Can I refund unused credits?',
    a: 'Yes — within 14 days of purchase, as long as you haven’t spent the pack. Email support@trendly.example and we’ll process it within 2 business days.',
  },
  {
    q: 'What if the AI generates a bad image?',
    a: 'If the model fails or its safety filter rejects your output, the credit is automatically returned to your balance. You only pay for images you actually receive.',
  },
  {
    q: 'Can I use these commercially?',
    a: 'Outputs you generate are yours to use commercially, with the carve-out that style references (e.g. Ghibli, Pixar, branded IP) remain the property of their respective owners — see our Terms of Service for the full details.',
  },
  {
    q: 'Is my photo data kept private?',
    a: 'Source photos are stored only as long as needed to generate your image. We never train any AI model on your uploads, and you can request full deletion of your account and data at any time.',
  },
]

export default function PricingPage() {
  return (
    <div className="relative">
      <div
        aria-hidden
        className="bg-gradient-spotlight pointer-events-none absolute inset-x-0 top-0 -z-10 h-[520px] opacity-30 blur-3xl"
      />

      <main className="mx-auto flex max-w-5xl flex-col gap-20 px-6 pt-16 pb-24">
        {/* Hero */}
        <section className="flex flex-col items-center gap-5 text-center">
          <Badge
            variant="secondary"
            className="bg-foreground/5 text-foreground/70 rounded-full px-3 py-1 text-xs font-medium tracking-wide uppercase"
          >
            One-time credit packs
          </Badge>
          <h1 className="text-4xl font-extrabold tracking-tight sm:text-5xl">
            <span className="text-gradient-hero">Simple credit-pack pricing</span>
          </h1>
          <p className="text-muted-foreground max-w-2xl text-lg">
            Pay once, never expire. No subscription.
          </p>
        </section>

        {/* Pack comparison */}
        <section className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {CREDIT_PACKS.map((pack) => {
            const copy = PACK_COPY[pack.id]
            const isHighlight = copy.highlight === true
            return (
              <article
                key={pack.id}
                className={
                  isHighlight
                    ? 'bg-card shadow-pop relative flex flex-col gap-5 rounded-3xl border-2 border-[var(--brand-grad-1)] p-6 sm:p-8'
                    : 'border-border/60 bg-card relative flex flex-col gap-5 rounded-3xl border p-6 sm:p-8'
                }
              >
                {isHighlight && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                    <span className="brand-grad inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold text-white shadow-sm">
                      <Sparkles className="size-3" />
                      Most popular
                    </span>
                  </div>
                )}
                <header className="flex flex-col gap-1">
                  <h2 className="text-lg font-bold tracking-tight">{pack.label.split(' — ')[0]}</h2>
                  <p className="text-muted-foreground text-sm">{copy.bestFor}</p>
                </header>
                <div className="flex flex-col gap-1">
                  <p className="text-4xl font-extrabold tracking-tight">
                    {formatUsd(pack.priceCents)}
                  </p>
                  <p className="text-muted-foreground text-sm">
                    {pack.credits} credits · {formatPerCredit(pack.perCreditCents)}
                  </p>
                </div>
                <ul className="flex flex-col gap-2 text-sm">
                  <li className="flex items-start gap-2">
                    <Check className="mt-0.5 size-4 shrink-0 text-emerald-500" />
                    <span>Credits never expire</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <Check className="mt-0.5 size-4 shrink-0 text-emerald-500" />
                    <span>Watermark-free downloads</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <Check className="mt-0.5 size-4 shrink-0 text-emerald-500" />
                    <span>Refund-on-failure</span>
                  </li>
                </ul>
                <div className="mt-auto">
                  {isHighlight ? (
                    <GradientButton size="lg" asChild className="w-full">
                      <Link href={`/settings?pack=${pack.id}`}>Buy {pack.credits} credits</Link>
                    </GradientButton>
                  ) : (
                    <Link
                      href={`/settings?pack=${pack.id}`}
                      className="border-border hover:bg-muted inline-flex w-full items-center justify-center rounded-full border px-6 py-3 text-sm font-semibold transition-colors"
                    >
                      Buy {pack.credits} credits
                    </Link>
                  )}
                </div>
              </article>
            )
          })}
        </section>

        {/* Value rows */}
        <section className="flex flex-col gap-6">
          <h2 className="text-2xl font-bold tracking-tight">What you get with every credit</h2>
          <ul className="grid gap-4 sm:grid-cols-2">
            {VALUE_ROWS.map((row) => (
              <li
                key={row.title}
                className="border-border/60 bg-card/60 flex gap-3 rounded-2xl border p-5"
              >
                <div className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-full bg-emerald-500/10 text-emerald-500">
                  <Check className="size-4" />
                </div>
                <div>
                  <h3 className="text-base font-semibold">{row.title}</h3>
                  <p className="text-muted-foreground mt-1 text-sm">{row.body}</p>
                </div>
              </li>
            ))}
          </ul>
        </section>

        {/* Trust signals */}
        <section className="border-border/60 bg-card/60 rounded-3xl border p-8 backdrop-blur">
          <ul className="grid grid-cols-2 gap-6 sm:grid-cols-4">
            {TRUST_TILES.map((tile) => (
              <li key={tile.label} className="flex flex-col items-center text-center">
                <p className="text-gradient-hero text-3xl font-extrabold">{tile.stat}</p>
                <p className="text-muted-foreground mt-1 text-xs tracking-wide uppercase">
                  {tile.label}
                </p>
              </li>
            ))}
          </ul>
        </section>

        {/* FAQ */}
        <section className="flex flex-col gap-6">
          <h2 className="text-2xl font-bold tracking-tight">Frequently asked</h2>
          <Accordion
            type="single"
            collapsible
            className="border-border/60 bg-card/40 rounded-2xl border px-5"
          >
            {FAQ.map((item, idx) => (
              <AccordionItem key={item.q} value={`faq-${idx}`}>
                <AccordionTrigger className="text-base">{item.q}</AccordionTrigger>
                <AccordionContent className="text-muted-foreground text-sm">
                  {item.a}
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </section>

        {/* Bottom CTA */}
        <section className="border-border/60 bg-gradient-spotlight/40 flex flex-col items-center gap-4 rounded-3xl border p-10 text-center">
          <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">
            Ready to make your trend?
          </h2>
          <p className="text-muted-foreground max-w-xl text-sm">
            Pick a viral look, upload a photo, and ship it in seconds.
          </p>
          <GradientButton size="lg" asChild>
            <Link href="/">See trends</Link>
          </GradientButton>
        </section>
      </main>
    </div>
  )
}
