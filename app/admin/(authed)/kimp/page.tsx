import { Shield } from 'lucide-react'
import { ConfirmDestructiveButton } from '@/components/admin/ConfirmDestructiveButton'
import { FlashToasts } from '@/components/admin/FlashToasts'
import { GradientButton } from '@/components/brand/GradientButton'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { createServiceClient } from '@/lib/supabase/server'
import { addAllowlistEntry, deactivateAllowlistEntry, reactivateAllowlistEntry } from './actions'

export const dynamic = 'force-dynamic'

interface AllowlistRow {
  id: string
  email: string
  kimp_subject_id: string | null
  is_active: boolean
  note: string | null
  created_at: string
  updated_at: string
}

export default async function AdminKimpPage() {
  const service = createServiceClient()

  const { data: rows } = await service
    .from('kimp_client_allowlist')
    .select('id, email, kimp_subject_id, is_active, note, created_at, updated_at')
    .order('created_at', { ascending: false })
    .limit(200)

  const entries = (rows ?? []) as AllowlistRow[]
  const activeCount = entries.filter((e) => e.is_active).length

  return (
    <section className="flex flex-col gap-8">
      <FlashToasts
        flashes={[
          { key: 'ok', level: 'success', message: 'Allowlist updated' },
          { key: 'error', level: 'error' },
        ]}
      />

      <header className="flex flex-col gap-2">
        <p className="text-muted-foreground text-xs font-semibold tracking-[0.2em] uppercase">
          Operations
        </p>
        <h1 className="text-3xl font-extrabold tracking-tight">
          <span className="text-gradient-hero">KIMP360</span> allowlist
        </h1>
        <p className="text-muted-foreground text-sm">
          Manage the email allowlist for KIMP360 client access. Nightly cron re-verifies linked
          accounts against the KIMP360 status API and revokes inactive ones after a 14-day grace
          period. All changes are audited.
        </p>
      </header>

      {/* Add entry form */}
      <Card className="gap-4 py-6">
        <CardHeader className="px-6 pb-0">
          <CardTitle className="text-lg font-bold">Add email to allowlist</CardTitle>
        </CardHeader>
        <CardContent className="px-6">
          <form action={addAllowlistEntry} className="flex flex-col gap-4">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
              <div className="flex flex-1 flex-col gap-2">
                <Label htmlFor="email">Client email</Label>
                <Input
                  id="email"
                  name="email"
                  type="email"
                  required
                  placeholder="client@kimp.xyz"
                  autoComplete="off"
                />
              </div>
              <GradientButton type="submit" size="md">
                <Shield className="mr-1.5 size-4" />
                Add
              </GradientButton>
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="note">Note (optional)</Label>
              <Input
                id="note"
                name="note"
                type="text"
                maxLength={500}
                placeholder="e.g. KIMP360 enterprise account — contact: name"
              />
            </div>
          </form>
        </CardContent>
      </Card>

      {/* Allowlist table */}
      <section className="flex flex-col gap-3">
        <header className="flex items-baseline justify-between gap-3">
          <h2 className="text-lg font-bold">Allowlist entries</h2>
          <span className="text-muted-foreground text-xs">
            {activeCount} active / {entries.length} total
          </span>
        </header>

        {entries.length === 0 ? (
          <div className="border-border/60 bg-card/40 text-muted-foreground rounded-2xl border border-dashed p-10 text-center text-sm">
            No allowlist entries yet. Add a client email above to grant KIMP360 unlimited access.
          </div>
        ) : (
          <div className="border-border/60 overflow-x-auto rounded-2xl border">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-muted-foreground text-left text-xs tracking-wider uppercase">
                <tr>
                  <th className="px-4 py-2 font-semibold">Email</th>
                  <th className="px-4 py-2 font-semibold">Status</th>
                  <th className="px-4 py-2 font-semibold">Note</th>
                  <th className="px-4 py-2 font-semibold">Added</th>
                  <th className="px-4 py-2 font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => (
                  <tr key={entry.id} className="border-border/60 border-t">
                    <td className="px-4 py-2 font-medium">
                      {entry.email}
                      {entry.kimp_subject_id && (
                        <span className="text-muted-foreground ml-2 text-[10px]">linked</span>
                      )}
                    </td>
                    <td className="px-4 py-2">
                      {entry.is_active ? (
                        <Badge className="rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-[10px] font-semibold text-emerald-700 dark:text-emerald-300">
                          active
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="rounded-full px-2.5 py-0.5 text-[10px]">
                          inactive
                        </Badge>
                      )}
                    </td>
                    <td className="text-muted-foreground px-4 py-2">{entry.note ?? '—'}</td>
                    <td className="text-muted-foreground px-4 py-2">
                      {new Date(entry.created_at).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-2">
                      {entry.is_active ? (
                        <ConfirmDestructiveButton
                          formAction={deactivateAllowlistEntry}
                          triggerLabel="Deactivate"
                          triggerVariant="outline"
                          title="Deactivate allowlist entry?"
                          description={
                            <>
                              <strong>{entry.email}</strong> will lose KIMP360 unlimited access. The
                              nightly cron will revoke their profile on the next run.
                            </>
                          }
                          confirmLabel="Yes, deactivate"
                          hiddenFields={{ email: entry.email }}
                        />
                      ) : (
                        <form action={reactivateAllowlistEntry}>
                          <input type="hidden" name="email" value={entry.email} />
                          <button
                            type="submit"
                            className="border-border/60 text-muted-foreground hover:text-foreground hover:bg-muted rounded-lg border px-3 py-1 text-xs transition-colors"
                          >
                            Reactivate
                          </button>
                        </form>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </section>
  )
}
