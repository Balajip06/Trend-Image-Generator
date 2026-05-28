import Link from 'next/link'
import { redirect } from 'next/navigation'
import { MOCK_GENERATIONS, MOCK_TRENDS_ENABLED } from '@/lib/dev/mock-data'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

interface CreationRow {
  id: string
  trend_id: string
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'failed_retryable'
  output_image_url: string | null
  created_at: string
  purge_at: string | null
}

export default async function CreationsPage() {
  let creations: CreationRow[]

  if (MOCK_TRENDS_ENABLED) {
    creations = MOCK_GENERATIONS.map((g) => ({
      id: g.id,
      trend_id: g.trend_id,
      status: g.status,
      output_image_url: g.output_image_url,
      created_at: g.created_at,
      purge_at: g.purge_at,
    }))
  } else {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) redirect('/login?next=/me/creations')

    const { data: rows } = await supabase
      .from('generations')
      .select('id, trend_id, status, output_image_url, created_at, purge_at')
      .order('created_at', { ascending: false })
      .limit(60)

    creations = ((rows as unknown as CreationRow[]) ?? []).filter(Boolean)
  }

  return (
    <section className="flex flex-col gap-6">
      <header className="flex items-baseline justify-between">
        <h1 className="text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          My creations
        </h1>
        <p className="text-sm text-zinc-500">Free-tier results auto-delete 30 days after creation.</p>
      </header>

      {creations.length === 0 ? (
        <div className="rounded-lg border border-dashed border-zinc-300 bg-white p-12 text-center dark:border-zinc-700 dark:bg-zinc-900">
          <p className="text-sm text-zinc-600 dark:text-zinc-400">No creations yet.</p>
          <Link
            href="/"
            className="mt-3 inline-block text-sm font-medium text-zinc-900 underline-offset-4 hover:underline dark:text-zinc-50"
          >
            Pick a trend →
          </Link>
        </div>
      ) : (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
          {creations.map((c) => (
            <li
              key={c.id}
              className="overflow-hidden rounded-md border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900"
            >
              <Link href={`/result/${c.id}`} className="block aspect-square">
                {c.output_image_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={c.output_image_url}
                    alt="Creation"
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center bg-zinc-100 text-xs text-zinc-500 dark:bg-zinc-800">
                    {c.status}
                  </div>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
