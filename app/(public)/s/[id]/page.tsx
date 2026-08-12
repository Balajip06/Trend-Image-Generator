import { Sparkles } from 'lucide-react'
import type { Metadata } from 'next'
import Image from 'next/image'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { GradientButton } from '@/components/brand/GradientButton'
import { createClient } from '@/lib/supabase/server'
import { siteUrl } from '@/lib/utils/site-url'

// Never cached: is_public can be revoked at any moment, and a cached copy
// would keep serving a generation the owner has since unshared.
export const dynamic = 'force-dynamic'

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

interface PageProps {
  params: Promise<{ id: string }>
}

interface SharedGeneration {
  id: string
  trendSlug: string
  trendTitle: string
  outputImageUrl: string
}

/**
 * Load a generation for public display.
 *
 * Uses the request-scoped (anon) client on purpose. The
 * `generations_public_gallery_read` RLS policy already restricts anonymous
 * selects to `is_public = true AND status = 'completed'`, so an unshared or
 * unfinished row is invisible at the database layer rather than filtered in
 * application code. A service client here would silently defeat that.
 */
async function loadShared(id: string): Promise<SharedGeneration | null> {
  if (!UUID_REGEX.test(id)) return null

  const supabase = await createClient()

  const { data: row } = await supabase
    .from('generations')
    .select('id, trend_id, output_image_url, is_public, status')
    .eq('id', id)
    .maybeSingle()

  if (!row || !row.is_public || row.status !== 'completed' || !row.output_image_url) return null

  const { data: trend } = await supabase
    .from('trends')
    .select('slug, title')
    .eq('id', row.trend_id)
    .maybeSingle()

  if (!trend) return null

  return {
    id: row.id,
    trendSlug: trend.slug,
    trendTitle: trend.title,
    outputImageUrl: row.output_image_url,
  }
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id } = await params
  const shared = await loadShared(id)
  if (!shared) return { title: 'Not found — Trendly', robots: { index: false, follow: false } }

  const title = `${shared.trendTitle} — made with Trendly`
  const description = `Someone made their own ${shared.trendTitle}. Make yours in seconds.`

  return {
    title,
    description,
    alternates: { canonical: siteUrl(`/s/${shared.id}`) },
    openGraph: {
      title,
      description,
      url: siteUrl(`/s/${shared.id}`),
      images: [{ url: shared.outputImageUrl }],
      type: 'article',
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: [shared.outputImageUrl],
    },
  }
}

export default async function SharedResultPage({ params }: PageProps) {
  const { id } = await params
  const shared = await loadShared(id)
  if (!shared) notFound()

  return (
    <div className="relative">
      <div
        aria-hidden
        className="bg-gradient-spotlight pointer-events-none absolute inset-x-0 top-0 -z-10 h-[520px] opacity-25 blur-3xl"
      />

      <main className="mx-auto flex max-w-3xl flex-col gap-8 px-6 pt-10 pb-20">
        <header className="flex flex-col gap-2">
          <h1 className="text-4xl font-extrabold tracking-tight">
            <span className="text-gradient-hero">{shared.trendTitle}</span>
          </h1>
          <p className="text-muted-foreground text-sm">Made with Trendly. Yours takes seconds.</p>
        </header>

        <figure className="border-border/60 shadow-pop relative overflow-hidden rounded-3xl border">
          <Image
            src={shared.outputImageUrl}
            alt={`A ${shared.trendTitle} made with Trendly`}
            width={1024}
            height={1024}
            priority
            unoptimized
            sizes="(max-width: 768px) 100vw, 720px"
            className="h-auto w-full object-contain"
          />
        </figure>

        <section className="border-border/60 bg-card rounded-3xl border p-6 sm:p-8">
          <div className="flex items-center gap-2">
            <Sparkles className="size-5 text-[var(--brand-grad-1)]" />
            <h2 className="text-xl font-extrabold tracking-tight">Make your own</h2>
          </div>
          <p className="text-muted-foreground mt-2 text-sm">
            Upload a photo and get your own {shared.trendTitle} in seconds — 5 free every week.
          </p>
          <div className="mt-5 flex flex-wrap items-center gap-3">
            <GradientButton size="lg" asChild>
              <Link href={`/trend/${shared.trendSlug}`}>Try {shared.trendTitle}</Link>
            </GradientButton>
            <Link
              href="/"
              className="border-border hover:bg-muted rounded-full border px-5 py-3 text-sm font-medium"
            >
              Browse Trends
            </Link>
          </div>
        </section>
      </main>
    </div>
  )
}
