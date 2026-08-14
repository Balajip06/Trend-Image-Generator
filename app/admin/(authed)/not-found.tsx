import { FileQuestion } from 'lucide-react'
import Link from 'next/link'

/**
 * 404 for the authed admin console.
 *
 * `notFound()` on the trend detail pages previously fell through to the root
 * `app/not-found.tsx`, which renders the consumer 404 outside AdminShell — so
 * a mistyped trend id dumped the admin out of the console entirely.
 */
export default function AdminNotFound() {
  return (
    <section className="flex flex-col items-center gap-5 py-16 text-center">
      <span className="bg-muted text-muted-foreground grid size-14 place-items-center rounded-full">
        <FileQuestion className="size-6" aria-hidden="true" />
      </span>
      <div className="flex flex-col gap-2">
        <p className="text-muted-foreground text-xs font-semibold tracking-[0.2em] uppercase">
          Admin console
        </p>
        <h1 className="text-2xl font-bold tracking-tight">Not found</h1>
        <p className="text-muted-foreground mx-auto max-w-md text-sm">
          That record does not exist, or it was deleted. If you expected it to be here, check the
          audit log.
        </p>
      </div>
      <div className="flex items-center gap-3">
        <Link
          href="/admin/trends"
          className="bg-foreground text-background inline-flex h-10 items-center rounded-md px-4 text-sm font-medium transition-colors hover:opacity-90"
        >
          All trends
        </Link>
        <Link
          href="/admin"
          className="border-border bg-background text-foreground hover:bg-muted inline-flex h-10 items-center rounded-md border px-4 text-sm font-medium transition-colors"
        >
          Dashboard
        </Link>
      </div>
    </section>
  )
}
