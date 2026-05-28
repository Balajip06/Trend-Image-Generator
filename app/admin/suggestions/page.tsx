import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { TrendSuggestionPayloadSchema, type TrendSuggestionPayload } from '@/lib/trends/suggestions/payload'
import { approveAutoSuggestion, rejectSuggestion } from './actions'

export const dynamic = 'force-dynamic'

interface SuggestionRow {
  id: string
  source: 'auto' | 'user'
  payload: unknown
  status: 'pending' | 'approved' | 'rejected'
  created_at: string
}

interface ParsedSuggestion {
  id: string
  source: 'auto' | 'user'
  status: 'pending' | 'approved' | 'rejected'
  created_at: string
  payload: TrendSuggestionPayload | null
}

interface AdminSuggestionsPageProps {
  searchParams: Promise<{ error?: string; rejected?: string }>
}

export default async function AdminSuggestionsPage({ searchParams }: AdminSuggestionsPageProps) {
  const flash = await searchParams

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login?next=/admin/suggestions')

  const { data: rows } = await supabase
    .from('trend_suggestions')
    .select('id, source, payload, status, created_at')
    .eq('status', 'pending')
    .order('created_at', { ascending: false })
    .limit(100)

  const suggestions: ParsedSuggestion[] = ((rows as SuggestionRow[] | null) ?? []).map((row) => {
    const parsed = TrendSuggestionPayloadSchema.safeParse(row.payload)
    return {
      id: row.id,
      source: row.source,
      status: row.status,
      created_at: row.created_at,
      payload: parsed.success ? parsed.data : null,
    }
  })

  return (
    <section className="flex flex-col gap-6">
      <header className="flex items-baseline justify-between">
        <h1 className="text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          Trend suggestions
        </h1>
        <p className="text-sm text-zinc-500">
          {suggestions.length} pending — auto-detected + community submissions.
        </p>
      </header>

      {flash.error && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
          {decodeURIComponent(flash.error)}
        </p>
      )}
      {flash.rejected && (
        <p className="rounded-md bg-zinc-100 px-3 py-2 text-sm text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
          Suggestion rejected.
        </p>
      )}

      {suggestions.length === 0 ? (
        <div className="rounded-lg border border-dashed border-zinc-300 p-12 text-center text-sm text-zinc-500 dark:border-zinc-700">
          Inbox empty. Run the detector or wait for new submissions.
        </div>
      ) : (
        <ul className="flex flex-col gap-4">
          {suggestions.map((s) => {
            async function boundApprove(): Promise<void> {
              'use server'
              await approveAutoSuggestion(s.id)
            }
            async function boundReject(): Promise<void> {
              'use server'
              await rejectSuggestion(s.id)
            }
            const canAutoApprove = s.source === 'auto' && s.payload?.type === 'auto'

            return (
              <li
                key={s.id}
                className="rounded-lg border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900"
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
                    {s.source}
                  </span>
                  <time className="text-xs text-zinc-500" dateTime={s.created_at}>
                    {new Date(s.created_at).toLocaleString()}
                  </time>
                </div>
                {s.payload && s.payload.type === 'auto' && (
                  <div className="mt-3 flex flex-col gap-2">
                    <h2 className="text-lg font-medium text-zinc-900 dark:text-zinc-50">
                      {s.payload.proposal.suggested_title}
                    </h2>
                    <p className="text-sm text-zinc-600 dark:text-zinc-400">
                      {s.payload.proposal.suggested_description}
                    </p>
                    <div className="flex flex-wrap gap-3 text-xs text-zinc-500">
                      <span>slug: <code>{s.payload.proposal.suggested_slug}</code></span>
                      <span>model: {s.payload.proposal.model}</span>
                      <span>conf: {s.payload.proposal.confidence.toFixed(2)}</span>
                      <span>momentum: {s.payload.candidate.momentum_score.toFixed(1)}</span>
                      <a
                        href={s.payload.candidate.source_url}
                        target="_blank"
                        rel="noreferrer"
                        className="underline-offset-2 hover:underline"
                      >
                        source ↗
                      </a>
                    </div>
                  </div>
                )}
                {s.payload && s.payload.type === 'user' && (
                  <div className="mt-3 flex flex-col gap-2">
                    <h2 className="text-lg font-medium text-zinc-900 dark:text-zinc-50">
                      {s.payload.title}
                    </h2>
                    <p className="text-sm text-zinc-600 dark:text-zinc-400">{s.payload.description}</p>
                    <p className="text-xs text-zinc-500">
                      User suggestions need manual trend creation — review then reject.
                    </p>
                  </div>
                )}
                {!s.payload && (
                  <p className="mt-3 text-xs text-red-600">
                    Payload failed schema validation — admin attention required.
                  </p>
                )}
                <div className="mt-4 flex gap-2">
                  <form action={boundApprove}>
                    <button
                      type="submit"
                      disabled={!canAutoApprove}
                      title={
                        !canAutoApprove
                          ? 'Only auto suggestions with a valid proposal can be drafted automatically'
                          : undefined
                      }
                      className="h-9 rounded-md bg-zinc-900 px-3 text-xs font-medium text-zinc-50 hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200"
                    >
                      Approve → draft trend
                    </button>
                  </form>
                  <form action={boundReject}>
                    <button
                      type="submit"
                      className="h-9 rounded-md border border-zinc-200 px-3 text-xs font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                    >
                      Reject
                    </button>
                  </form>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
