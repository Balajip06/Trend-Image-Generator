import Link from 'next/link'
import { createTrend } from '../actions'
import { TrendForm } from '../TrendForm'

interface NewTrendPageProps {
  searchParams: Promise<{ error?: string }>
}

export default async function NewTrendPage({ searchParams }: NewTrendPageProps) {
  const { error } = await searchParams

  return (
    <section className="flex flex-col gap-6">
      <header className="flex items-baseline justify-between">
        <h1 className="text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          New trend
        </h1>
        <Link
          href="/admin/trends"
          className="text-sm text-zinc-500 underline-offset-2 hover:underline"
        >
          ← Back
        </Link>
      </header>

      <TrendForm
        action={createTrend}
        submitLabel="Create draft"
        banner={
          error ? (
            <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
              {decodeURIComponent(error)}
            </p>
          ) : null
        }
      />

      <p className="text-xs text-zinc-500">
        New trends start as drafts. After saving, run the eval suite and mark{' '}
        <code className="rounded bg-zinc-100 px-1 dark:bg-zinc-800">eval_status=&apos;passed&apos;</code>
        {' '}before activating.
      </p>
    </section>
  )
}
