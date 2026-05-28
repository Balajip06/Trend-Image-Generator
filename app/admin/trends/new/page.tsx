import Link from 'next/link'
import { FlashToasts } from '@/components/admin/FlashToasts'
import { Button } from '@/components/ui/button'
import { createTrend } from '../actions'
import { TrendForm } from '../TrendForm'

interface NewTrendPageProps {
  searchParams: Promise<{ error?: string }>
}

export default async function NewTrendPage({ searchParams }: NewTrendPageProps) {
  await searchParams // consumed by FlashToasts via useSearchParams

  return (
    <section className="flex flex-col gap-6">
      <FlashToasts flashes={[{ key: 'error', level: 'error' }]} />

      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
            Catalogue
          </p>
          <h1 className="text-3xl font-extrabold tracking-tight">New trend</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Drafts start inactive. Activate from the Edit page once eval passes.
          </p>
        </div>
        <Button asChild variant="ghost" size="sm">
          <Link href="/admin/trends">← Back to trends</Link>
        </Button>
      </header>

      <TrendForm action={createTrend} submitLabel="Create draft" />
    </section>
  )
}
