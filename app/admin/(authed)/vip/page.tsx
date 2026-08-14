import { Crown, Search } from 'lucide-react'
import { ConfirmDestructiveButton } from '@/components/admin/ConfirmDestructiveButton'
import { FlashToasts } from '@/components/admin/FlashToasts'
import { LoadErrorBanner } from '@/components/admin/LoadErrorBanner'
import { GradientButton } from '@/components/brand/GradientButton'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { adminRead, adminReadOne } from '@/lib/admin/read'
import { createServiceClient } from '@/lib/supabase/server'
import { findUserForVip, setVip } from './actions'

export const dynamic = 'force-dynamic'

interface VipPageProps {
  searchParams: Promise<{ email?: string; ok?: string; error?: string }>
}

export default async function AdminVipPage({ searchParams }: VipPageProps) {
  const params = await searchParams
  const targetEmail = params.email?.trim() || null

  const service = createServiceClient()

  // Optional: look up the target user (if an email was supplied).
  let target = null as {
    id: string
    email: string
    is_vip: boolean
    vip_reason: string | null
    vip_granted_at: string | null
  } | null
  let lookupError: string | null = null
  if (targetEmail) {
    const { row, error } = await adminReadOne<NonNullable<typeof target>>(
      'vip.lookup',
      service
        .from('profiles')
        .select('id, email, is_vip, vip_reason, vip_granted_at')
        .eq('email', targetEmail)
        .maybeSingle()
    )
    target = row
    lookupError = error
  }

  // List of current VIPs.
  const { rows: vips, error: listError } = await adminRead(
    'vip.list',
    service
      .from('profiles')
      .select('id, email, vip_reason, vip_granted_at')
      .eq('is_vip', true)
      .order('vip_granted_at', { ascending: false })
      .limit(100)
  )
  const loadError = lookupError ?? listError

  return (
    <section className="flex flex-col gap-8">
      <FlashToasts
        flashes={[
          { key: 'ok', level: 'success', message: 'VIP status updated' },
          { key: 'error', level: 'error' },
        ]}
      />
      <LoadErrorBanner error={loadError} label="VIP data" />

      <header className="flex flex-col gap-2">
        <p className="text-muted-foreground text-xs font-semibold tracking-[0.2em] uppercase">
          Operations
        </p>
        <h1 className="text-3xl font-extrabold tracking-tight">
          <span className="text-gradient-hero">VIP</span> grants
        </h1>
        <p className="text-muted-foreground text-sm">
          Toggle unlimited-generation access for influencers, creator partners, or early-access
          users. All grants are audited.
        </p>
      </header>

      <Card className="gap-4 py-6">
        <CardHeader className="px-6 pb-0">
          <CardTitle className="text-lg font-bold">Look up user</CardTitle>
        </CardHeader>
        <CardContent className="px-6">
          <form action={findUserForVip} className="flex flex-col gap-4 sm:flex-row sm:items-end">
            <div className="flex flex-1 flex-col gap-2">
              <Label htmlFor="email">User email</Label>
              <Input
                id="email"
                name="email"
                type="email"
                required
                defaultValue={targetEmail ?? ''}
                placeholder="creator@example.com"
                autoComplete="off"
              />
            </div>
            <GradientButton type="submit" size="md">
              <Search className="mr-1.5 size-4" />
              Find
            </GradientButton>
          </form>
        </CardContent>
      </Card>

      {target && (
        <Card className="gap-4 py-6">
          <CardHeader className="px-6 pb-0">
            <CardTitle className="flex items-center gap-2 text-lg font-bold">
              {target.email}
              {target.is_vip ? (
                <Badge className="rounded-full bg-amber-500/15 px-2.5 py-0.5 text-[10px] font-semibold text-amber-700 dark:text-amber-300">
                  VIP
                </Badge>
              ) : (
                <Badge variant="outline" className="rounded-full px-2.5 py-0.5 text-[10px]">
                  standard
                </Badge>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="px-6">
            {target.is_vip ? (
              <div className="flex flex-col gap-4">
                <p className="text-muted-foreground text-sm">
                  Granted{' '}
                  {target.vip_granted_at
                    ? new Date(target.vip_granted_at).toLocaleString()
                    : 'unknown'}
                  {target.vip_reason ? ` — ${target.vip_reason}` : ''}
                </p>
                <div>
                  <ConfirmDestructiveButton
                    formAction={setVip}
                    triggerLabel="Revoke VIP"
                    triggerVariant="outline"
                    title="Revoke VIP status?"
                    description={
                      <>
                        <strong>{target.email}</strong> will return to normal quota gates
                        immediately. Past audit entries are preserved.
                      </>
                    }
                    confirmLabel="Yes, revoke VIP"
                    hiddenFields={{
                      user_id: target.id,
                      email: target.email,
                      enable: '0',
                      reason: 'Revoked via admin UI',
                    }}
                  />
                </div>
              </div>
            ) : (
              <form action={setVip} className="flex flex-col gap-4">
                <input type="hidden" name="user_id" value={target.id} />
                <input type="hidden" name="email" value={target.email} />
                <input type="hidden" name="enable" value="1" />
                <div className="flex flex-col gap-2">
                  <Label htmlFor="reason">Reason</Label>
                  <Input
                    id="reason"
                    name="reason"
                    required
                    minLength={3}
                    maxLength={300}
                    placeholder="e.g. creator partnership — TikTok @handle (50k followers)"
                  />
                </div>
                <div>
                  <GradientButton type="submit" size="md">
                    <Crown className="mr-1.5 size-4" />
                    Grant VIP
                  </GradientButton>
                </div>
              </form>
            )}
          </CardContent>
        </Card>
      )}

      <section className="flex flex-col gap-3">
        <header className="flex items-baseline justify-between gap-3">
          <h2 className="text-lg font-bold">Current VIPs</h2>
          <span className="text-muted-foreground text-xs">{vips.length} active</span>
        </header>

        {vips.length === 0 ? (
          <div className="border-border/60 bg-card/40 text-muted-foreground rounded-2xl border border-dashed p-10 text-center text-sm">
            No VIPs yet. Grant access above to comp creator partners.
          </div>
        ) : (
          <div className="border-border/60 overflow-x-auto rounded-2xl border">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-muted-foreground text-left text-xs tracking-wider uppercase">
                <tr>
                  <th className="px-4 py-2 font-semibold">Email</th>
                  <th className="px-4 py-2 font-semibold">Reason</th>
                  <th className="px-4 py-2 font-semibold">Granted at</th>
                </tr>
              </thead>
              <tbody>
                {vips.map((v) => (
                  <tr key={v.id} className="border-border/60 border-t">
                    <td className="px-4 py-2 font-medium">{v.email}</td>
                    <td className="text-muted-foreground px-4 py-2">{v.vip_reason ?? '—'}</td>
                    <td className="text-muted-foreground px-4 py-2">
                      {v.vip_granted_at ? new Date(v.vip_granted_at).toLocaleString() : '—'}
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
