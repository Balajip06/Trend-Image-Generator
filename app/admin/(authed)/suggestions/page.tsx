import { Check, ExternalLink, Inbox, Search } from 'lucide-react'
import { ConfirmDestructiveButton } from '@/components/admin/ConfirmDestructiveButton'
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
import { createServiceClient } from '@/lib/supabase/server'
import {
  TrendSuggestionPayloadSchema,
  type TrendSuggestionPayload,
} from '@/lib/trends/suggestions/payload'
import { approveAutoSuggestion, rejectSuggestion, runScan } from './actions'

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
  searchParams: Promise<{
    error?: string
    rejected?: string
    scanned?: string
    scan_error?: string
  }>
}

export default async function AdminSuggestionsPage({ searchParams }: AdminSuggestionsPageProps) {
  await searchParams // consumed by FlashToasts

  // Auth + admin-role gating happens in proxy.ts (/admin/* route matcher).
  // trend_suggestions has RLS enabled with no SELECT policy (deny-all to the
  // authed client) — rows are written by the service-role orchestrator/cron.
  // Read via service-role so the admin inbox can see them; proxy is the gate.
  const supabase = createServiceClient()
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
          { key: 'scanned', level: 'info' },
          { key: 'scan_error', level: 'error' },
        ]}
      />

      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-muted-foreground text-xs font-semibold tracking-[0.2em] uppercase">
            Inbox
          </p>
          <h1 className="text-3xl font-extrabold tracking-tight">Trend suggestions</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            {suggestions.length} pending · auto-detected + community submissions.
          </p>
        </div>
        <form action={runScan}>
          <Button type="submit" variant="outline" size="sm" className="rounded-full">
            <Search className="size-4" /> Scan for trends
          </Button>
        </form>
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
    <div className="border-border/60 bg-card/40 flex flex-col items-center gap-4 rounded-3xl border border-dashed p-16 text-center">
      <div className="bg-muted text-foreground grid size-14 place-items-center rounded-full">
        <Inbox className="size-6" />
      </div>
      <div>
        <p className="text-lg font-bold">Inbox empty</p>
        <p className="text-muted-foreground mt-1 text-sm">
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
            <time className="text-muted-foreground text-xs" dateTime={suggestion.created_at}>
              {new Date(suggestion.created_at).toLocaleString()}
            </time>
          </div>
          {suggestion.payload?.type === 'auto' && (
            <CardTitle className="text-lg">{suggestion.payload.proposal.suggested_title}</CardTitle>
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
              <Meta
                label="slug"
                value={<code>{suggestion.payload.proposal.suggested_slug}</code>}
              />
              <Meta label="model" value={suggestion.payload.proposal.model} />
              <Meta label="confidence" value={suggestion.payload.proposal.confidence.toFixed(2)} />
              <Meta
                label="momentum"
                value={suggestion.payload.candidate.momentum_score.toFixed(1)}
              />
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
            <p className="text-muted-foreground text-xs">
              User suggestions need manual trend creation — review then reject.
            </p>
          </>
        )}
        {!suggestion.payload && (
          <p className="text-destructive text-xs">
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
        <ConfirmDestructiveButton
          formAction={boundReject}
          triggerLabel="Reject"
          triggerSize="sm"
          triggerVariant="outline"
          title="Reject this suggestion?"
          description="It will be marked rejected and removed from the inbox. You can't un-reject from this UI — the row stays in the database for auditing."
          confirmLabel="Yes, reject"
        />
      </CardFooter>
    </Card>
  )
}

function Meta({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col">
      <dt className="text-muted-foreground text-[10px] tracking-wide uppercase">{label}</dt>
      <dd className="text-foreground font-mono text-xs">{value}</dd>
    </div>
  )
}
