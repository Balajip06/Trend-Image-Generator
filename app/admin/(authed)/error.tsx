'use client'

import * as Sentry from '@sentry/nextjs'
import { RefreshCw, TriangleAlert } from 'lucide-react'
import Link from 'next/link'
import { useEffect } from 'react'

interface AdminErrorBoundaryProps {
  error: Error & { digest?: string }
  reset: () => void
}

/**
 * Error boundary for the authed admin console.
 *
 * Without it, a render throw in any admin page escaped to `app/error.tsx` and
 * rendered the consumer-facing "Something went wrong" screen — losing the
 * AdminShell nav and, more importantly, the error message. Admin pages now
 * throw on failed reads (see `lib/admin/read.ts` and the trend detail pages),
 * so this boundary is what makes those failures actionable.
 *
 * Unlike the consumer boundary, this one shows the raw message: the audience is
 * an operator who needs to know whether it was RLS, a missing column, or an
 * outage.
 */
export default function AdminErrorBoundary({ error, reset }: AdminErrorBoundaryProps) {
  useEffect(() => {
    Sentry.captureException(error, { tags: { area: 'admin' } })
  }, [error])

  return (
    <section className="flex flex-col items-center gap-5 py-16 text-center">
      <span className="bg-destructive/10 text-destructive grid size-14 place-items-center rounded-full">
        <TriangleAlert className="size-6" aria-hidden="true" />
      </span>
      <div className="flex flex-col gap-2">
        <p className="text-muted-foreground text-xs font-semibold tracking-[0.2em] uppercase">
          Admin console
        </p>
        <h1 className="text-2xl font-bold tracking-tight">This page failed to load</h1>
        <p className="text-muted-foreground mx-auto max-w-md text-sm">
          The error was reported to Sentry. Retry, or head back to the dashboard.
        </p>
      </div>

      <div className="border-border/60 bg-muted/40 mx-auto max-w-xl rounded-xl border p-3 text-left">
        <p className="text-foreground font-mono text-xs break-words">{error.message}</p>
        {error.digest && (
          <p className="text-muted-foreground/80 mt-1 font-mono text-[11px]">
            ref: {error.digest}
          </p>
        )}
      </div>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => reset()}
          className="bg-foreground text-background inline-flex h-10 items-center gap-2 rounded-md px-4 text-sm font-medium transition-colors hover:opacity-90"
        >
          <RefreshCw className="size-4" aria-hidden="true" />
          Try again
        </button>
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
