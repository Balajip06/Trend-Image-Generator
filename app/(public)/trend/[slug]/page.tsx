import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { buildFAQJsonLd, buildHowToJsonLd } from '@/lib/seo/json-ld'
import { getActiveTrendBySlug } from '@/lib/trends/repository'
import { TrendUpload } from './TrendUpload'

export const revalidate = 3600 // ISR — refresh hourly

interface TrendPageProps {
  params: Promise<{ slug: string }>
}

export async function generateMetadata({ params }: TrendPageProps): Promise<Metadata> {
  const { slug } = await params
  const trend = await getActiveTrendBySlug(slug)
  if (!trend) return { title: 'Trend not found' }

  const title = trend.seo_title ?? `${trend.title} — Trend Image Generator`
  const description = trend.seo_description ?? trend.description ?? `Try the ${trend.title} trend with your photo.`

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      type: 'website',
      images: trend.sample_after_url ? [{ url: trend.sample_after_url }] : undefined,
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: trend.sample_after_url ? [trend.sample_after_url] : undefined,
    },
  }
}

export default async function TrendPage({ params }: TrendPageProps) {
  const { slug } = await params
  const trend = await getActiveTrendBySlug(slug)
  if (!trend) notFound()

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'
  const canonicalUrl = `${siteUrl}/trend/${trend.slug}`

  const howTo = buildHowToJsonLd({
    name: trend.title,
    description: trend.description ?? `Try ${trend.title}.`,
    image: trend.sample_after_url ?? `${siteUrl}/og.png`,
    url: canonicalUrl,
    steps: [
      { name: 'Upload your photo', text: 'Pick a clear photo of your subject.' },
      { name: 'Generate', text: 'Tap generate and wait a few seconds.' },
      { name: 'Save or share', text: 'Download the result or share to Instagram or TikTok.' },
    ],
  })

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-10 px-6 py-12">
      <script
        type="application/ld+json"
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: JSON.stringify(howTo) }}
      />
      {trend.faq.length > 0 && (
        <script
          type="application/ld+json"
          // eslint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{ __html: JSON.stringify(buildFAQJsonLd(trend.faq)) }}
        />
      )}

      <header className="flex flex-col gap-3">
        <h1 className="text-4xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          {trend.title}
        </h1>
        {trend.description && (
          <p className="text-lg text-zinc-600 dark:text-zinc-400">{trend.description}</p>
        )}
      </header>

      {trend.sample_after_url && (
        <figure className="overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-800">
          {/* next/image used after generated types confirm Supabase Storage domain in next.config */}
          <img
            src={trend.sample_after_url}
            alt={`Sample output for ${trend.title}`}
            className="w-full"
          />
        </figure>
      )}

      <section className="flex flex-col gap-3">
        <h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">Try it</h2>
        <TrendUpload trendSlug={trend.slug} schema={trend.input_schema} />
      </section>

      {trend.faq.length > 0 && (
        <section className="flex flex-col gap-4">
          <h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">FAQ</h2>
          <dl className="flex flex-col gap-4">
            {trend.faq.map((item) => (
              <div key={item.question}>
                <dt className="font-medium text-zinc-900 dark:text-zinc-50">{item.question}</dt>
                <dd className="text-sm text-zinc-600 dark:text-zinc-400">{item.answer}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}
    </main>
  )
}
