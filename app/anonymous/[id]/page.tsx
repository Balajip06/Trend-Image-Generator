import { Clock, Loader2, Sparkles } from 'lucide-react'
import type { Metadata } from 'next'
import Image from 'next/image'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { GradientButton } from '@/components/brand/GradientButton'
import { Badge } from '@/components/ui/badge'
import { findMockAnonymousGeneration } from '@/lib/dev/mock-anonymous'
import { MOCK_TRENDS_ENABLED } from '@/lib/dev/mock-data'
import { createServiceClient } from '@/lib/supabase/server'
import { AnonymousStatusPoller } from './AnonymousStatusPoller'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Your free try — Trendly',
  description: 'A one-off generation from the no-signup trial flow.',
  robots: { index: false, follow: false },
}

interface PageProps {
  params: Promise<{ id: string }>
}

interface AnonymousRow {
  id: string
  trend_id: string
  output_image_url: string | null
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'failed_retryable'
  created_at: string
  expires_at: string
}

interface ResolvedGeneration {
  id: string
  trend_slug: string
  trend_title: string
  output_image_url: string | null
  status: AnonymousRow['status']
  expires_at: string
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function hoursLeft(expiresAtIso: string): number {
  const ms = new Date(expiresAtIso).getTime() - Date.now()
  if (ms <= 0) return 0
  return Math.ceil(ms / 3_600_000)
}

function isExpired(expiresAtIso: string): boolean {
  return new Date(expiresAtIso).getTime() <= Date.now()
}

async function loadGeneration(id: string): Promise<ResolvedGeneration | null> {
  // Mock branch — used in `pnpm dev` w/ MOCK_TRENDS=true so the UI is
  // reviewable without provisioning Supabase. The mock fixture also keeps
  // the `?` query in the URL bar resolving to a working surface for screenshots.
  if (MOCK_TRENDS_ENABLED) {
    const mock = findMockAnonymousGeneration(id)
    if (!mock) return null
    return {
      id: mock.id,
      trend_slug: mock.trend_slug,
      trend_title: mock.trend_title,
      output_image_url: mock.output_image_url,
      status: 'completed',
      expires_at: mock.expires_at,
    }
  }

  // Anonymous attempts are service-role only (no auth.uid context). The page
  // intentionally has `robots: noindex` so the URL acts as the capability —
  // anyone with the link can view, no fingerprint cookie required. This
  // matches the share-out UX described in the amended plan §3.
  if (!UUID_REGEX.test(id)) return null

  const supabase = createServiceClient()
  const { data: rowData } = await supabase
    .from('anonymous_attempts')
    .select('id, trend_id, output_image_url, status, created_at, expires_at')
    .eq('id', id)
    .maybeSingle()

  const row = rowData ?? null
  if (!row) return null

  const { data: trendData } = await supabase
    .from('trends')
    .select('slug, title')
    .eq('id', row.trend_id)
    .maybeSingle()

  const trend = trendData ?? null
  if (!trend) return null

  return {
    id: row.id,
    trend_slug: trend.slug,
    trend_title: trend.title,
    output_image_url: row.output_image_url,
    status: row.status,
    expires_at: row.expires_at,
  }
}

export default async function AnonymousResultPage({ params }: PageProps) {
  const { id } = await params
  const loaded = await loadGeneration(id)
  if (!loaded) notFound()

  const expired = isExpired(loaded.expires_at)
  // Red-team M3: anonymous trial outputs are short-lived capability URLs.
  // When the trial has expired we never render the <Image>, but the raw
  // `output_image_url` still rides along in the RSC payload that
  // hydrates the client — leaving an expired-but-still-fetchable signed
  // URL in the page source. Strip it before any render branch sees it.
  const gen: ResolvedGeneration = expired ? { ...loaded, output_image_url: null } : loaded

  const remaining = hoursLeft(gen.expires_at)
  const ready = gen.status === 'completed' && gen.output_image_url !== null
  const failed = gen.status === 'failed' || gen.status === 'failed_retryable'
  const pending = !ready && !failed && !expired

  return (
    <div className="relative">
      <div
        aria-hidden
        className="bg-gradient-spotlight pointer-events-none absolute inset-x-0 top-0 -z-10 h-[520px] opacity-25 blur-3xl"
      />

      <main className="mx-auto flex max-w-3xl flex-col gap-8 px-6 pt-10 pb-20">
        <header className="flex flex-col gap-2">
          {ready && (
            <Badge
              variant="outline"
              className="w-fit rounded-full border-amber-400/40 bg-amber-400/10 text-amber-700 dark:text-amber-300"
            >
              <Clock className="size-3" /> Free trial · expires in {remaining}h
            </Badge>
          )}
          {expired && (
            <Badge
              variant="outline"
              className="w-fit rounded-full border-zinc-400/40 bg-zinc-400/10 text-zinc-700 dark:text-zinc-300"
            >
              <Clock className="size-3" /> Trial expired
            </Badge>
          )}
          {pending && (
            <Badge
              variant="outline"
              className="w-fit rounded-full border-blue-400/40 bg-blue-400/10 text-blue-700 dark:text-blue-300"
            >
              <Loader2 className="size-3 animate-spin" /> Generating
            </Badge>
          )}
          {failed && (
            <Badge
              variant="outline"
              className="w-fit rounded-full border-rose-400/40 bg-rose-400/10 text-rose-700 dark:text-rose-300"
            >
              Generation failed
            </Badge>
          )}
          <h1 className="text-4xl font-extrabold tracking-tight">
            Your <span className="text-gradient-hero">{gen.trend_title}</span>
          </h1>
          {ready && (
            <p className="text-muted-foreground text-sm">
              One-off generation from the no-signup trial. Anything you don&apos;t save in the next{' '}
              {remaining} hours gets purged.
            </p>
          )}
          {expired && (
            <p className="text-muted-foreground text-sm">
              This free trial has expired and the image has been purged. Sign up to keep your future
              creations forever.
            </p>
          )}
          {pending && (
            <p className="text-muted-foreground text-sm">
              We&apos;re still generating your image. Refresh in a few seconds — most takes under
              30s.
            </p>
          )}
          {failed && (
            <p className="text-muted-foreground text-sm">
              The model couldn&apos;t finish this one. Anonymous trials don&apos;t get retries —
              sign up to try again with a fresh attempt.
            </p>
          )}
        </header>

        {ready && gen.output_image_url && (
          <figure className="border-border/60 shadow-pop relative aspect-square overflow-hidden rounded-3xl border">
            <Image
              src={gen.output_image_url}
              alt={`Generated ${gen.trend_title}`}
              fill
              priority
              sizes="(max-width: 768px) 100vw, 720px"
              className="object-cover"
            />
          </figure>
        )}

        {pending && (
          <>
            <AnonymousStatusPoller id={gen.id} />
            <figure
              aria-label="Image still generating"
              className="border-border/60 bg-muted/30 text-muted-foreground flex aspect-square items-center justify-center rounded-3xl border border-dashed"
            >
              <div className="flex flex-col items-center gap-3">
                <Loader2 className="size-8 animate-spin" />
                <p className="text-sm">Working on it…</p>
              </div>
            </figure>
          </>
        )}

        <section className="border-border/60 bg-card rounded-3xl border p-6 sm:p-8">
          <div className="flex items-center gap-2">
            <Sparkles className="size-5 text-[var(--brand-grad-1)]" />
            <h2 className="text-xl font-extrabold tracking-tight">Save it forever</h2>
          </div>
          <p className="text-muted-foreground mt-2 text-sm">
            Sign up to keep this result, share without watermark, and unlock 5 free generations per
            week.
          </p>
          <div className="mt-5 flex flex-wrap items-center gap-3">
            <GradientButton size="lg" asChild>
              <Link href={`/login?next=/anonymous/${gen.id}`}>Sign up to save</Link>
            </GradientButton>
            <Link
              href={`/trend/${gen.trend_slug}`}
              className="border-border hover:bg-muted rounded-full border px-5 py-3 text-sm font-medium"
            >
              Try another trend
            </Link>
          </div>
        </section>

        <p className="text-muted-foreground text-center text-xs">
          Want to try a different photo? You get one free trial per device. Sign up for more.
        </p>
      </main>
    </div>
  )
}
