import type { Metadata } from 'next'
import Image from 'next/image'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'
import { TrendImpressionBeacon } from '@/components/analytics/TrendImpressionBeacon'
import { Badge } from '@/components/ui/badge'
import { buildFAQJsonLd, buildHowToJsonLd } from '@/lib/seo/json-ld'
import { createClient } from '@/lib/supabase/server'
import { getActiveTrendBySlug } from '@/lib/trends/repository'
import { TrendUpload } from './TrendUpload'

// JSON.stringify alone does not escape '<', so untrusted strings containing
// '</script>' could break out of the JSON-LD script tag. Replace tag bytes
// with their unicode escape so the browser still parses the JSON but never
// sees a closing-tag sequence.
function safeJsonLd(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
}

export const revalidate = 3600

const ASPECT_LABEL: Record<string, string> = {
  '1:1': 'Square',
  '3:4': 'Portrait',
  '9:16': 'Story',
  '16:9': 'Wide',
}

interface TrendPageProps {
  params: Promise<{ slug: string }>
}

export async function generateMetadata({ params }: TrendPageProps): Promise<Metadata> {
  const { slug } = await params
  const trend = await getActiveTrendBySlug(slug)
  if (!trend) return { title: 'Trend not found' }

  const title = trend.seo_title ?? `${trend.title} — Trendly`
  const description =
    trend.seo_description ?? trend.description ?? `Try the ${trend.title} trend with your photo.`

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      type: 'website',
      images:
        (trend.sample_after_url ?? trend.thumbnail_url)
          ? [{ url: (trend.sample_after_url ?? trend.thumbnail_url)! }]
          : undefined,
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images:
        (trend.sample_after_url ?? trend.thumbnail_url)
          ? [(trend.sample_after_url ?? trend.thumbnail_url)!]
          : undefined,
    },
  }
}

export default async function TrendPage({ params }: TrendPageProps) {
  const { slug } = await params

  // Authed users go through the unified /me/studio dashboard with the trend
  // pre-selected. Anonymous users fall through to the SSR + SEO + anonymous-
  // trial flow below, which is what organic + social traffic lands on.
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (user) {
    redirect(`/me/studio?trend=${slug}`)
  }

  const trend = await getActiveTrendBySlug(slug)
  if (!trend) notFound()

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'
  const canonicalUrl = `${siteUrl}/trend/${trend.slug}`

  const howTo = buildHowToJsonLd({
    name: trend.title,
    description: trend.description ?? `Try ${trend.title}.`,
    image: trend.sample_after_url ?? trend.thumbnail_url ?? `${siteUrl}/og.png`,
    url: canonicalUrl,
    steps: [
      { name: 'Upload your photo', text: 'Pick a clear photo of your subject.' },
      { name: 'Generate', text: 'Tap generate and wait a few seconds.' },
      { name: 'Save or share', text: 'Download the result or share to Instagram or TikTok.' },
    ],
  })

  return (
    <>
      <TrendImpressionBeacon trendSlug={trend.slug} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: safeJsonLd(howTo) }} />
      {trend.faq.length > 0 && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: safeJsonLd(buildFAQJsonLd(trend.faq)) }}
        />
      )}

      <div className="relative">
        <div
          aria-hidden
          className="bg-gradient-spotlight pointer-events-none absolute inset-x-0 top-0 -z-10 h-[520px] opacity-25 blur-3xl"
        />

        <main className="mx-auto flex max-w-6xl flex-col gap-12 px-6 pt-10 pb-24">
          {/* Breadcrumb / back */}
          <Link
            href="/"
            className="text-muted-foreground hover:bg-muted hover:text-foreground inline-flex w-fit items-center gap-1.5 rounded-full px-3 py-1.5 text-sm"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
            >
              <path d="M19 12H5" />
              <path d="M11 5l-7 7 7 7" />
            </svg>
            All trends
          </Link>

          {/* Hero — sample + intro */}
          <section className="grid items-center gap-10 lg:grid-cols-[1.05fr_1fr]">
            <div className="animate-fade-up flex flex-col gap-5">
              <div className="flex flex-wrap items-center gap-2">
                <Badge className="bg-foreground/5 text-foreground/70 hover:bg-foreground/10 rounded-full">
                  Trending now
                </Badge>
                <Badge
                  variant="outline"
                  className="border-border/80 text-muted-foreground rounded-full"
                >
                  {ASPECT_LABEL[trend.aspect_ratio] ?? trend.aspect_ratio}
                </Badge>
                <Badge
                  variant="outline"
                  className="border-border/80 text-muted-foreground rounded-full"
                >
                  {trend.model === 'nano-banana-pro' ? 'Pro quality' : 'Quick render'}
                </Badge>
              </div>
              <h1 className="text-5xl leading-[1.05] font-extrabold tracking-tight sm:text-6xl">
                {trend.title}
              </h1>
              {trend.description && (
                <p className="text-muted-foreground text-lg">{trend.description}</p>
              )}
              <div className="text-muted-foreground flex items-center gap-4 text-sm">
                <span className="flex items-center gap-2">
                  <span className="size-2 rounded-full bg-emerald-500" /> Live
                </span>
                <span className="flex items-center gap-2">
                  <span className="size-2 rounded-full bg-[var(--brand-cyan)]" /> ~8s render
                </span>
              </div>
            </div>

            <figure className="border-border/60 shadow-pop animate-pop-in relative aspect-[4/5] overflow-hidden rounded-3xl border">
              {(trend.sample_after_url ?? trend.thumbnail_url) ? (
                <Image
                  src={(trend.sample_after_url ?? trend.thumbnail_url)!}
                  alt={`Sample output for ${trend.title}`}
                  fill
                  priority
                  unoptimized
                  sizes="(max-width: 1024px) 100vw, 540px"
                  className="object-cover"
                />
              ) : (
                <div className="bg-gradient-hero h-full w-full" />
              )}
            </figure>
          </section>

          {/* Upload + FAQ */}
          <section className="grid items-start gap-8 lg:grid-cols-[1.2fr_1fr]">
            <div className="border-border/60 bg-card shadow-soft rounded-3xl border p-6 sm:p-8">
              <header className="mb-6 flex flex-col gap-1.5">
                <h2 className="text-2xl font-extrabold tracking-tight">Make yours</h2>
                <p className="text-muted-foreground text-sm">
                  Drop a photo. We will do the rest in a few seconds.
                </p>
              </header>
              <TrendUpload trendSlug={trend.slug} schema={trend.input_schema} model={trend.model} />
            </div>

            {trend.faq.length > 0 ? (
              <aside className="border-border/60 bg-card/80 rounded-3xl border p-6 backdrop-blur sm:p-8">
                <h2 className="text-2xl font-extrabold tracking-tight">Questions</h2>
                <Accordion type="single" collapsible className="mt-2">
                  {trend.faq.map((item) => (
                    <AccordionItem key={item.question} value={item.question}>
                      <AccordionTrigger className="text-left text-base font-semibold">
                        {item.question}
                      </AccordionTrigger>
                      <AccordionContent className="text-muted-foreground text-sm">
                        {item.answer}
                      </AccordionContent>
                    </AccordionItem>
                  ))}
                </Accordion>
              </aside>
            ) : (
              <aside className="border-border/60 bg-card/40 text-muted-foreground rounded-3xl border border-dashed p-8 text-sm">
                Tips: bright lighting + face clearly visible = better results.
              </aside>
            )}
          </section>
        </main>
      </div>
    </>
  )
}
