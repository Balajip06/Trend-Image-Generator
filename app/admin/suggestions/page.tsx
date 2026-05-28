import { Check, ExternalLink, Inbox, X } from 'lucide-react'
import { redirect } from 'next/navigation'
import { FlashToasts } from '@/components/admin/FlashToasts'
import { SourceBadge } from '@/components/admin/StatusBadges'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
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
  await searchParams // consumed by FlashToasts

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
      <FlashToasts
        flashes={[
          { key: 'error', level: 'error' },
          { key: 'rejected', level: 'info', message: 'Suggestion rejected.' },
        ]}
      />

      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
            Inbox
          </p>
          <h1 className="text-3xl font-extrabold tracking-tight">Trend suggestions</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {suggestions.length} pending · auto-detected + community submissions.
          </p>
        </div>
      </header>

      {suggestions.length === 0 ? (
        <EmptyInbox />
      ) : (
        <ul className="flex flex-col gap-4">
          {suggestions.map((s) => (
            <SuggestionCard key={s.id} suggestion={s} />
          ))}
        </ul>
      )}
    </section>
  )
}

function EmptyInbox() {
  return (
    <div className="flex flex-col items-center gap-4 rounded-3xl border border-dashed border-border/60 bg-card/40 p-16 text-center">
      <div className="grid size-14 place-items-center rounded-full bg-muted text-foreground">
        <Inbox className="size-6" />
      </div>
      <div>
        <p className="text-lg font-bold">Inbox empty</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Run the detector or wait for new submissions.
        </p>
      </div>
    </div>
  )
}

function SuggestionCard({ suggestion }: { suggestion: ParsedSuggestion }) {
  async function boundApprove(): Promise<void> {
    'use server'
    await approveAutoSuggestion(suggestion.id)
  }
  async function boundReject(): Promise<void> {
    'use server'
    await rejectSuggestion(suggestion.id)
  }
  const canAutoApprove = suggestion.source === 'auto' && suggestion.payload?.type === 'auto'

  return (
    <Card className="gap-4 py-5">
      <CardHeader className="flex flex-row items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <SourceBadge source={suggestion.source} />
            <time className="text-xs text-muted-foreground" dateTime={suggestion.created_at}>
              {new Date(suggestion.created_at).toLocaleString()}
            </time>
          </div>
          {suggestion.payload?.type === 'auto' && (
            <CardTitle className="text-lg">
              {suggestion.payload.proposal.suggested_title}
            </CardTitle>
          )}
          {suggestion.payload?.type === 'user' && (
            <CardTitle className="text-lg">{suggestion.payload.title}</CardTitle>
          )}
        </div>
      </CardHeader>

      <CardContent className="flex flex-col gap-3">
        {suggestion.payload?.type === 'auto' && (
          <>
            <CardDescription>{suggestion.payload.proposal.suggested_description}</CardDescription>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-4">
              <Meta label="slug" value={<code>{suggestion.payload.proposal.suggested_slug}</code>} />
              <Meta label="model" value={suggestion.payload.proposal.model} />
              <Meta label="confidence" value={suggestion.payload.proposal.confidence.toFixed(2)} />
              <Meta label="momentum" value={suggestion.payload.candidate.momentum_score.toFixed(1)} />
            </dl>
            <a
              href={suggestion.payload.candidate.source_url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex w-fit items-center gap-1 text-xs font-semibold text-[var(--brand-cyan)] hover:underline"
            >
              View source <ExternalLink className="size-3" />
            </a>
          </>
        )}
        {suggestion.payload?.type === 'user' && (
          <>
            <CardDescription>{suggestion.payload.description}</CardDescription>
            <p className="text-xs text-muted-foreground">
              User suggestions need manual trend creation — review then reject.
            </p>
          </>
        )}
        {!suggestion.payload && (
          <p className="text-xs text-destructive">
            Payload failed schema validation — admin attention required.
          </p>
        )}
      </CardContent>

      <CardFooter className="gap-2">
        <form action={boundApprove}>
          <Button
            type="submit"
            size="sm"
            disabled={!canAutoApprove}
            title={
              !canAutoApprove
                ? 'Only auto suggestions with a valid proposal can be drafted automatically'
                : undefined
            }
          >
            <Check className="size-4" /> Approve → draft trend
          </Button>
        </form>
        <form action={boundReject}>
          <Button type="submit" size="sm" variant="outline">
            <X className="size-4" /> Reject
          </Button>
        </form>
      </CardFooter>
    </Card>
  )
}

function Meta({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col">
      <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="font-mono text-xs text-foreground">{value}</dd>
    </div>
  )
}
