'use client'

import * as Sentry from '@sentry/nextjs'
import { useEffect } from 'react'

interface GlobalErrorProps {
  error: Error & { digest?: string }
  reset: () => void
}

/**
 * Catches errors that escape the route segment boundaries — including
 * failures inside the root layout, which is why this file owns its own
 * <html> / <body>. Sentry's nextjs SDK wires the report automatically.
 */
export default function GlobalError({ error, reset }: GlobalErrorProps) {
  useEffect(() => {
    Sentry.captureException(error)
  }, [error])

  return (
    <html lang="en">
      <body className="flex min-h-screen items-center justify-center bg-zinc-50 px-6 py-12 dark:bg-black">
        <div className="max-w-md text-center">
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            Something went wrong
          </h1>
          <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
            We logged the error and are looking into it.
          </p>
          {error.digest && (
            <p className="mt-3 font-mono text-xs text-zinc-400">ref: {error.digest}</p>
          )}
          <button
            type="button"
            onClick={() => reset()}
            className="mt-6 h-10 rounded-md bg-zinc-900 px-4 text-sm font-medium text-zinc-50 hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  )
}
