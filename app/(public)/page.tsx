import Link from 'next/link'
import { GradientButton } from '@/components/brand/GradientButton'
import { Badge } from '@/components/ui/badge'
import { listActiveTrends } from '@/lib/trends/repository'

export const revalidate = 600 // home grid refreshes every 10 minutes (ISR)

const ASPECT_LABEL: Record<string, string> = {
  '1:1': 'Square',
  '3:4': 'Portrait',
  '9:16': 'Story',
  '16:9': 'Wide',
}

export default async function HomePage() {
  const trends = await listActiveTrends()
  const heroTrend = trends[0]
  const restTrends = trends.slice(1)

  return (
    <div className="relative">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[640px] bg-gradient-spotlight opacity-30 blur-3xl"
      />

      <main className="mx-auto flex max-w-6xl flex-col gap-16 px-6 pt-16 pb-24">
        {/* Hero */}
        <section className="grid items-center gap-12 lg:grid-cols-[1.1fr_1fr]">
          <div className="flex flex-col gap-6 animate-fade-up">
            <Badge
              variant="secondary"
              className="w-fit rounded-full bg-foreground/5 px-3 py-1 text-xs font-medium uppercase tracking-wide text-foreground/70"
            >
              New trend drops weekly
            </Badge>
            <h1 className="text-5xl font-extrabold leading-[1.05] tracking-tight sm:text-6xl lg:text-7xl">
              Make the trend{' '}
              <span className="text-gradient-hero">everyone</span> is making.
            </h1>
            <p className="max-w-xl text-lg text-muted-foreground">
              Pick a viral look. Upload your photo. We render the moment in seconds — ready to drop on your feed.
            </p>
            <div className="flex flex-wrap items-center gap-3">
              {heroTrend ? (
                <GradientButton size="lg" asChild>
                  <Link href={`/trend/${heroTrend.slug}`}>
                    Try {heroTrend.title.split(' ')[0]}
                  </Link>
                </GradientButton>
              ) : (
                <GradientButton size="lg" asChild>
                  <Link href="/login">Get early access</Link>
                </GradientButton>
              )}
              <Link
                href="#trends"
                className="rounded-full border border-border px-6 py-3 text-sm font-medium hover:bg-muted"
              >
                Browse all trends
              </Link>
            </div>
            <div className="flex items-center gap-6 pt-2 text-sm text-muted-foreground">
              <span className="flex items-center gap-2">
                <span className="size-2 rounded-full bg-emerald-500" />
                Free try, no signup
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
              className="group relative block aspect-[4/5] overflow-hidden rounded-3xl border border-border/60 shadow-pop animate-pop-in"
            >
              {heroTrend.sample_after_url || heroTrend.thumbnail_url ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={(heroTrend.sample_after_url ?? heroTrend.thumbnail_url)!}
                  alt={heroTrend.title}
                  className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-105"
                />
              ) : (
                <div className="h-full w-full bg-gradient-hero" />
              )}
              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent p-6 text-white">
                <p className="text-xs font-medium uppercase tracking-wider text-white/70">Featured</p>
                <h2 className="mt-1 text-2xl font-extrabold">{heroTrend.title}</h2>
                {heroTrend.description && (
                  <p className="mt-1 line-clamp-2 text-sm text-white/80">{heroTrend.description}</p>
                )}
              </div>
              <div className="absolute right-4 top-4 rounded-full bg-white/15 px-3 py-1 text-xs font-medium text-white backdrop-blur-md">
                {ASPECT_LABEL[heroTrend.aspect_ratio] ?? heroTrend.aspect_ratio}
              </div>
            </Link>
          )}
        </section>

        {/* Trend grid */}
        <section id="trends" className="flex flex-col gap-6">
          <div className="flex items-baseline justify-between">
            <h2 className="text-2xl font-extrabold tracking-tight">Browse trends</h2>
            <p className="text-sm text-muted-foreground">
              {trends.length} trend{trends.length === 1 ? '' : 's'} live now
            </p>
          </div>

          {trends.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border bg-card/40 p-12 text-center text-sm text-muted-foreground">
              No active trends yet. Check back soon — new drops every week.
            </div>
          ) : (
            <ul className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {restTrends.map((t, idx) => (
                <li key={t.id} style={{ animationDelay: `${idx * 60}ms` }} className="animate-fade-up">
                  <Link
                    href={`/trend/${t.slug}`}
                    className="group relative block overflow-hidden rounded-3xl border border-border/60 bg-card transition-transform hover:-translate-y-1 hover:shadow-pop"
                  >
                    <div className="relative aspect-square overflow-hidden">
                      {t.thumbnail_url || t.sample_after_url ? (
                        /* eslint-disable-next-line @next/next/no-img-element */
                        <img
                          src={(t.thumbnail_url ?? t.sample_after_url)!}
                          alt={t.title}
                          className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-105"
                        />
                      ) : (
                        <div className="h-full w-full bg-gradient-hero" />
                      )}
                      <div className="absolute right-3 top-3 rounded-full bg-black/30 px-2.5 py-1 text-[10px] font-medium uppercase tracking-wider text-white backdrop-blur-md">
                        {ASPECT_LABEL[t.aspect_ratio] ?? t.aspect_ratio}
                      </div>
                    </div>
                    <div className="flex items-start justify-between gap-3 p-5">
                      <div>
                        <h3 className="text-lg font-bold tracking-tight">{t.title}</h3>
                        {t.description && (
                          <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{t.description}</p>
                        )}
                      </div>
                      <div className="grid size-9 shrink-0 place-items-center rounded-full bg-foreground text-background transition-transform group-hover:translate-x-1">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
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
        <section className="rounded-3xl border border-border/60 bg-card/60 p-10 backdrop-blur">
          <h2 className="text-2xl font-extrabold tracking-tight">3 taps to a trend</h2>
          <ol className="mt-6 grid gap-6 sm:grid-cols-3">
            {[
              { n: '01', title: 'Pick a trend', body: 'Browse what is going viral this week.' },
              { n: '02', title: 'Upload your photo', body: 'Selfie or full body — clear lighting works best.' },
              { n: '03', title: 'Share it', body: 'Native Instagram + TikTok share, or download a clean PNG.' },
            ].map((step) => (
              <li key={step.n} className="rounded-2xl bg-background p-6">
                <div className="text-3xl font-extrabold text-gradient-hero">{step.n}</div>
                <h3 className="mt-3 text-lg font-bold">{step.title}</h3>
                <p className="mt-1 text-sm text-muted-foreground">{step.body}</p>
              </li>
            ))}
          </ol>
        </section>
      </main>
    </div>
  )
}
