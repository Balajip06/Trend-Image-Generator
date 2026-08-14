import { Search, TriangleAlert } from 'lucide-react'
import Link from 'next/link'
import { FlashToasts } from '@/components/admin/FlashToasts'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { adminRead } from '@/lib/admin/read'
import { createServiceClient } from '@/lib/supabase/server'
import { RefundForm } from './RefundForm'

export const dynamic = 'force-dynamic'

interface RefundsPageProps {
  searchParams: Promise<{ error?: string; issued?: string; q?: string; uid?: string }>
}

interface ProfileSearchRow {
  id: string
  email: string
  credits_balance: number
}

interface AuditGrantRow {
  id: string
  admin_id: string | null
  target_id: string | null
  after: { source?: string; source_ref?: string; amount?: number } | null
  created_at: string
}

const SEARCH_LIMIT = 5
const GRANTS_LIMIT = 20

function parseSourceRef(ref: string | undefined): { category: string; notes: string } {
  if (!ref) return { category: '', notes: '' }
  const split = ref.indexOf(':')
  if (split === -1) return { category: '', notes: ref }
  return {
    category: ref.slice(0, split).trim(),
    notes: ref.slice(split + 1).trim(),
  }
}

export default async function AdminRefundsPage({ searchParams }: RefundsPageProps) {
  const sp = await searchParams
  const q = (sp.q ?? '').trim()
  const preselectId = (sp.uid ?? '').trim()

  const service = createServiceClient()

  // ─── User search ────────────────────────────────────────────────────────
  let searchResults: ProfileSearchRow[] = []
  let searchError: string | null = null
  if (q.length > 0) {
    // UUID-like exact match OR partial email match. `handle` column is not
    // yet live (Phase 7 migration) so we don't include it here. When it
    // ships, add `,handle.ilike.%${esc}%` to the OR clause.
    const esc = q.replace(/[%_,]/g, (m) => `\\${m}`)
    const isUuid = /^[0-9a-f-]{8,}$/i.test(q)
    const orClause = isUuid ? `email.ilike.%${esc}%,id.eq.${q}` : `email.ilike.%${esc}%`
    const { data, error } = await service
      .from('profiles')
      .select('id, email, credits_balance')
      .or(orClause)
      .limit(SEARCH_LIMIT)
    if (error) {
      searchError = error.message
    } else {
      searchResults = (data as ProfileSearchRow[] | null) ?? []
    }
  }

  // Pre-fill the form when a search result was selected via ?uid=.
  let preselected: ProfileSearchRow | null = null
  if (preselectId) {
    const { data } = await service
      .from('profiles')
      .select('id, email, credits_balance')
      .eq('id', preselectId)
      .maybeSingle()
    preselected = (data as ProfileSearchRow | null) ?? null
  }

  // ─── Recent credit grants ──────────────────────────────────────────────
  // Compliance surface: an unchecked read here rendered "No grants yet",
  // i.e. "nothing happened", when the query had actually failed.
  const grantsRead = await adminRead(
    'refunds.grants',
    service
      .from('admin_audit_log')
      .select('id, admin_id, target_id, after, created_at')
      .eq('action', 'credit_grant')
      .order('created_at', { ascending: false })
      .limit(GRANTS_LIMIT)
  )
  // `after` is jsonb, typed as `Json` by the generated types; AuditGrantRow
  // narrows it to the shape grant_credits() actually writes.
  const grants = grantsRead.rows as unknown as AuditGrantRow[]
  const grantsError = grantsRead.error

  const profileIds = Array.from(
    new Set([
      ...grants.map((r) => r.admin_id).filter(Boolean),
      ...grants.map((r) => r.target_id).filter(Boolean),
    ] as string[])
  )
  const emailById = new Map<string, string>()
  if (profileIds.length > 0) {
    const { rows: profileRows } = await adminRead<{ id: string; email: string }>(
      'refunds.profiles',
      service.from('profiles').select('id, email').in('id', profileIds)
    )
    for (const p of profileRows) {
      emailById.set(p.id, p.email)
    }
  }

  return (
    <section className="flex flex-col gap-8">
      <FlashToasts
        flashes={[
          { key: 'error', level: 'error' },
          { key: 'issued', level: 'info' },
        ]}
      />

      <header className="flex flex-col gap-2">
        <p className="text-muted-foreground text-xs font-semibold tracking-[0.2em] uppercase">
          Support
        </p>
        <h1 className="text-3xl font-extrabold tracking-tight">
          Issue <span className="text-gradient-hero">refund credits</span>
        </h1>
        <p className="text-muted-foreground text-sm">
          Manual credit grant. Writes a row to{' '}
          <code className="font-mono text-xs">admin_audit_log</code> with{' '}
          <code className="font-mono text-xs">source=support</code> for compliance.
        </p>
      </header>

      <Card className="gap-4 py-6">
        <CardHeader className="px-6 pb-0">
          <CardTitle className="text-lg font-bold">Find user</CardTitle>
        </CardHeader>
        <CardContent className="px-6">
          <form method="get" className="flex flex-col gap-3">
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search className="text-muted-foreground absolute top-1/2 left-3 size-4 -translate-y-1/2" />
                <Input
                  name="q"
                  defaultValue={q}
                  placeholder="Search by email or user ID"
                  className="h-11 rounded-xl pl-9"
                />
              </div>
              <Button type="submit" variant="outline" className="h-11 rounded-xl">
                Search
              </Button>
            </div>
            {q.length === 0 ? (
              <p className="text-muted-foreground text-xs">
                Search for a user above, or use the manual form below.
              </p>
            ) : null}
            {searchError ? (
              <p className="text-destructive text-xs">Search failed: {searchError}</p>
            ) : null}
          </form>

          {searchResults.length > 0 ? (
            <ul className="mt-4 flex flex-col gap-2">
              {searchResults.map((r) => (
                <li
                  key={r.id}
                  className="border-border/60 bg-card/40 flex flex-col gap-2 rounded-2xl border p-4 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="flex flex-col gap-1">
                    <span className="text-sm font-semibold">{r.email}</span>
                    <span className="text-muted-foreground font-mono text-[11px]">{r.id}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <Badge variant="outline" className="rounded-full">
                      {r.credits_balance} credits
                    </Badge>
                    <Button asChild size="sm" variant="outline" className="rounded-full">
                      <Link
                        href={`/admin/refunds?q=${encodeURIComponent(q)}&uid=${encodeURIComponent(r.id)}`}
                      >
                        Use this user
                      </Link>
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          ) : q.length > 0 && !searchError ? (
            <p className="text-muted-foreground mt-3 text-xs">No matches.</p>
          ) : null}
        </CardContent>
      </Card>

      <Card className="gap-4 py-6">
        <CardHeader className="px-6 pb-0">
          <CardTitle className="text-lg font-bold">
            New grant
            {preselected ? (
              <span className="text-muted-foreground ml-2 text-xs font-normal">
                for {preselected.email}
              </span>
            ) : null}
          </CardTitle>
        </CardHeader>
        <CardContent className="px-6">
          <RefundForm defaultEmail={preselected?.email} defaultUserId={preselected?.id} />
        </CardContent>
      </Card>

      <Card className="gap-4 py-6">
        <CardHeader className="px-6 pb-0">
          <CardTitle className="text-lg font-bold">Recent grants</CardTitle>
        </CardHeader>
        <CardContent className="px-6">
          {grantsError ? (
            <div className="border-destructive/40 bg-destructive/5 flex items-start gap-3 rounded-xl border border-dashed p-3">
              <TriangleAlert className="text-destructive mt-0.5 size-4 shrink-0" />
              <div>
                <p className="text-sm font-semibold">Could not load grants</p>
                <p className="text-muted-foreground mt-0.5 font-mono text-xs">{grantsError}</p>
              </div>
            </div>
          ) : grants.length === 0 ? (
            <p className="text-muted-foreground text-sm">No grants yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
                  <tr>
                    <th className="py-2 pr-3">When</th>
                    <th className="py-2 pr-3">Who</th>
                    <th className="py-2 pr-3">Amount</th>
                    <th className="py-2 pr-3">Reason</th>
                    <th className="py-2 pr-3">Notes</th>
                    <th className="py-2 pr-3">Admin</th>
                  </tr>
                </thead>
                <tbody>
                  {grants.map((row) => {
                    const ref = parseSourceRef(row.after?.source_ref)
                    const targetEmail = row.target_id ? emailById.get(row.target_id) : null
                    const adminEmail = row.admin_id ? emailById.get(row.admin_id) : null
                    return (
                      <tr key={row.id} className="border-border/40 border-t">
                        <td className="text-muted-foreground py-2 pr-3 text-xs">
                          {new Date(row.created_at).toLocaleString()}
                        </td>
                        <td className="py-2 pr-3">
                          {targetEmail ?? (
                            <span className="text-muted-foreground font-mono text-[11px]">
                              {row.target_id?.slice(0, 8) ?? '—'}
                            </span>
                          )}
                        </td>
                        <td className="py-2 pr-3 font-semibold">+{row.after?.amount ?? '?'}</td>
                        <td className="py-2 pr-3">
                          {ref.category ? (
                            <Badge variant="outline" className="rounded-full text-[10px]">
                              {ref.category}
                            </Badge>
                          ) : (
                            <span className="text-muted-foreground text-xs">—</span>
                          )}
                        </td>
                        <td className="text-muted-foreground py-2 pr-3 text-xs">
                          {ref.notes && ref.notes !== '<no notes>' ? ref.notes : '—'}
                        </td>
                        <td className="py-2 pr-3 text-xs">
                          {adminEmail ?? (
                            <span className="text-muted-foreground font-mono">system</span>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </section>
  )
}
