import Image from 'next/image'
import Link from 'next/link'
import { GradientButton } from '@/components/brand/GradientButton'
import { Badge } from '@/components/ui/badge'
import { getSocialProof } from '@/lib/analytics/social-proof'
import { createServiceClient } from '@/lib/supabase/server'
import { listActiveTrends } from '@/lib/trends/repository'

export const revalidate = 600 // home grid refreshes every 10 minutes (ISR)

const ASPECT_LABEL: Record<string, string> = {
  '1:1': 'Square',
  '3:4': 'Portrait',
  '9:16': 'Story',
  '16:9': 'Wide',
}

function fmt(n: number): string {
  return new Intl.NumberFormat('en-US').format(n)
}

export default async function HomePage() {
  const trends = await listActiveTrends()
  // Service-role client is safe here — getSocialProof + the banner-trend
  // lookup only read aggregate/config data, never row-level user data.
  // Avoids reading auth cookies, which would otherwise force `/` from ISR
  // to fully-dynamic.
  const service = createServiceClient()
  const proof = await getSocialProof(service)

  const { data: bannerSetting } = await service
    .from('app_settings')
    .select('value')
    .eq('key', 'banner_trend_id')
    .maybeSingle()
  const bannerTrendId = (bannerSetting?.value as string | null) ?? null
  const bannerIdx = bannerTrendId ? trends.findIndex((t) => t.id === bannerTrendId) : -1

  // Admin-pinned banner trend takes priority over display_order if it's
  // still active; otherwise fall back to the normal lowest-display_order trend.
  const heroTrend = bannerIdx >= 0 ? trends[bannerIdx] : trends[0]
  const restTrends = bannerIdx >= 0 ? trends.filter((_, i) => i !== bannerIdx) : trends.slice(1)

  return (
    <div className="relative">
      {/* JS-disabled fallback — the home grid below is RSC so it renders without
          JS, but anchor-only nav matters for screen-readers + Lynx + curl. */}
      <noscript>
        <div className="mx-auto max-w-6xl px-6 py-8 text-sm">
          <p className="font-semibold">Trends</p>
          <ul className="mt-2 grid gap-1">
            {trends.map((t) => (
              <li key={t.id}>
                <a href={`/trend/${t.slug}`} className="underline">
                  {t.title}
                </a>
              </li>
            ))}
            <li>
              <a href="/login" className="underline">
                Sign in
              </a>
            </li>
          </ul>
        </div>
      </noscript>

      <div
        aria-hidden
        className="bg-gradient-spotlight pointer-events-none absolute inset-x-0 top-0 -z-10 h-[640px] opacity-30 blur-3xl"
      />

      <main className="mx-auto flex max-w-6xl flex-col gap-16 px-6 pt-16 pb-24">
        {/* Hero */}
        <section className="grid items-center gap-12 lg:grid-cols-[1.1fr_1fr]">
          <div className="animate-fade-up flex flex-col gap-6">
            <Badge
              variant="secondary"
              className="bg-foreground/5 text-foreground/70 w-fit rounded-full px-3 py-1 text-xs font-medium tracking-wide uppercase"
            >
              New trend drops weekly
            </Badge>
            <h1 className="text-5xl leading-[1.05] font-extrabold tracking-tight sm:text-6xl lg:text-7xl">
              Make the trend <span className="text-gradient-hero">everyone</span> is making.
            </h1>
            <p className="text-muted-foreground max-w-xl text-lg">
              Pick a viral look. Upload your photo. We render the moment in seconds — ready to drop
              on your feed.
            </p>
            <div className="flex flex-wrap items-center gap-3">
              {heroTrend ? (
                <GradientButton size="lg" asChild>
                  <Link href={`/trend/${heroTrend.slug}`}>Try {heroTrend.title.split(' ')[0]}</Link>
                </GradientButton>
              ) : (
                <GradientButton size="lg" asChild>
                  <Link href="/login">Get early access</Link>
                </GradientButton>
              )}
              <Link
                href="/anonymous/demo"
                className="border-border hover:bg-muted rounded-full border px-6 py-3 text-sm font-medium"
              >
                Try one free, no signup →
              </Link>
            </div>
            <div className="text-muted-foreground flex flex-wrap items-center gap-x-6 gap-y-2 pt-2 text-sm">
              <span className="flex items-center gap-2">
                <span className="size-2 rounded-full bg-emerald-500" />
                <strong className="text-foreground font-semibold">{fmt(proof.shippedToday)}</strong>
                shipped today
              </span>
              <span className="flex items-center gap-2">
                <span className="size-2 rounded-full bg-[var(--brand-grad-1)]" />
                <strong className="text-foreground font-semibold">{fmt(proof.shippedTotal)}</strong>
                total
              </span>
              <span className="flex items-center gap-2">
                <span className="size-2 rounded-full bg-[var(--brand-cyan)]" />
                8s average render
              </span>
            </div>
          </div>
          {heroTrend && (
            <Link
              href={`/trend/${heroTrend.slug}`}
              className="group border-border/60 shadow-pop animate-pop-in relative block aspect-[4/5] overflow-hidden rounded-3xl border"
            >
              {heroTrend.sample_after_url || heroTrend.thumbnail_url ? (
                <Image
                  src={(heroTrend.sample_after_url ?? heroTrend.thumbnail_url)!}
                  alt={heroTrend.title}
                  fill
                  priority
                  unoptimized
                  sizes="(max-width: 1024px) 100vw, 540px"
                  className="object-cover transition-transform duration-700 group-hover:scale-105"
                />
              ) : (
                <div className="bg-gradient-hero h-full w-full" />
              )}
              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent p-6 text-white">
                <p className="text-xs font-medium tracking-wider text-white/70 uppercase">
                  Featured
                </p>
                <h2 className="mt-1 text-2xl font-extrabold">{heroTrend.title}</h2>
                {heroTrend.description && (
                  <p className="mt-1 line-clamp-2 text-sm text-white/80">{heroTrend.description}</p>
                )}
              </div>
              <div className="absolute top-4 right-4 rounded-full bg-white/15 px-3 py-1 text-xs font-medium text-white backdrop-blur-md">
                {ASPECT_LABEL[heroTrend.aspect_ratio] ?? heroTrend.aspect_ratio}
              </div>
            </Link>
          )}
        </section>

        {/* Trend grid */}
        <section id="trends" className="flex flex-col gap-6">
          <div className="flex items-baseline justify-between">
            <h2 className="text-2xl font-extrabold tracking-tight">Browse trends</h2>
            <p className="text-muted-foreground text-sm">
              {trends.length} trend{trends.length === 1 ? '' : 's'} live now
            </p>
          </div>

          {trends.length === 0 ? (
            <div className="border-border bg-card/40 text-muted-foreground rounded-2xl border border-dashed p-12 text-center text-sm">
              No active trends yet. Check back soon — new drops every week.
            </div>
          ) : (
            <ul className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {restTrends.map((t, idx) => (
                <li
                  key={t.id}
                  style={{ animationDelay: `${idx * 60}ms` }}
                  className="animate-fade-up"
                >
                  <Link
                    href={`/trend/${t.slug}`}
                    className="group border-border/60 bg-card hover:shadow-pop relative block overflow-hidden rounded-3xl border transition-transform hover:-translate-y-1"
                  >
                    <div className="relative aspect-square overflow-hidden">
                      {t.thumbnail_url || t.sample_after_url ? (
                        <Image
                          src={(t.thumbnail_url ?? t.sample_after_url)!}
                          alt={t.title}
                          fill
                          unoptimized
                          sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
                          className="object-cover transition-transform duration-700 group-hover:scale-105"
                        />
                      ) : (
                        <div className="bg-gradient-hero h-full w-full" />
                      )}
                      <div className="absolute top-3 right-3 rounded-full bg-black/30 px-2.5 py-1 text-[10px] font-medium tracking-wider text-white uppercase backdrop-blur-md">
                        {ASPECT_LABEL[t.aspect_ratio] ?? t.aspect_ratio}
                      </div>
                    </div>
                    <div className="flex items-start justify-between gap-3 p-5">
                      <div>
                        <h3 className="text-lg font-bold tracking-tight">{t.title}</h3>
                        {t.description && (
                          <p className="text-muted-foreground mt-1 line-clamp-2 text-sm">
                            {t.description}
                          </p>
                        )}
                      </div>
                      <div className="bg-foreground text-background grid size-9 shrink-0 place-items-center rounded-full transition-transform group-hover:translate-x-1">
                        <svg
                          width="14"
                          height="14"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2.5"
                          strokeLinecap="round"
                        >
                          <path d="M5 12h14" />
                          <path d="M13 5l7 7-7 7" />
                        </svg>
                      </div>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* How it works */}
        <section className="border-border/60 bg-card/60 rounded-3xl border p-10 backdrop-blur">
          <h2 className="text-2xl font-extrabold tracking-tight">3 taps to a trend</h2>
          <ol className="mt-6 grid gap-6 sm:grid-cols-3">
            {[
              { n: '01', title: 'Pick a trend', body: 'Browse what is going viral this week.' },
              {
                n: '02',
                title: 'Upload your photo',
                body: 'Selfie or full body — clear lighting works best.',
              },
              {
                n: '03',
                title: 'Share it',
                body: 'Native Instagram + TikTok share, or download a clean PNG.',
              },
            ].map((step) => (
              <li key={step.n} className="bg-background rounded-2xl p-6">
                <div className="text-gradient-hero text-3xl font-extrabold">{step.n}</div>
                <h3 className="mt-3 text-lg font-bold">{step.title}</h3>
                <p className="text-muted-foreground mt-1 text-sm">{step.body}</p>
              </li>
            ))}
          </ol>
        </section>
      </main>
    </div>
  )
}
