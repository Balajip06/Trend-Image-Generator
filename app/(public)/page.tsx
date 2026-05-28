import Link from 'next/link'
import { listActiveTrends } from '@/lib/trends/repository'

export const revalidate = 600 // home grid refreshes every 10 minutes (ISR)

export default async function HomePage() {
  const trends = await listActiveTrends()

  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-10 px-6 py-12">
      <header className="flex flex-col gap-3">
        <h1 className="text-4xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50 sm:text-5xl">
          Trend Image Generator
        </h1>
        <p className="max-w-xl text-lg text-zinc-600 dark:text-zinc-400">
          Pick a viral trend. Upload your photo. Get a stylized output in seconds.
        </p>
      </header>

      {trends.length === 0 ? (
        <div className="rounded-lg border border-dashed border-zinc-300 bg-white p-12 text-center text-sm text-zinc-500 dark:border-zinc-700 dark:bg-zinc-900">
          No active trends yet. Check back soon.
        </div>
      ) : (
        <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {trends.map((t) => (
            <li key={t.id}>
              <Link
                href={`/trend/${t.slug}`}
                className="group block overflow-hidden rounded-xl border border-zinc-200 bg-white transition-colors hover:border-zinc-300 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-700"
              >
                <div className="aspect-square overflow-hidden bg-zinc-100 dark:bg-zinc-800">
                  {t.thumbnail_url ?? t.sample_after_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={(t.thumbnail_url ?? t.sample_after_url)!}
                      alt={t.title}
                      className="h-full w-full object-cover transition-transform group-hover:scale-105"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-xs text-zinc-400">
                      {t.title}
                    </div>
                  )}
                </div>
                <div className="p-3">
                  <h2 className="text-sm font-medium text-zinc-900 dark:text-zinc-50">{t.title}</h2>
                  {t.description && (
                    <p className="mt-1 line-clamp-2 text-xs text-zinc-500 dark:text-zinc-400">
                      {t.description}
                    </p>
                  )}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  )
}
