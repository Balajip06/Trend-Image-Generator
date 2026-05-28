import { FileDown, Gift, Sparkles, Trash2 } from 'lucide-react'
import { redirect } from 'next/navigation'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { EVENTS, flushServer, trackServer } from '@/lib/analytics/server'
import { MOCK_PROFILE, MOCK_TRENDS_ENABLED } from '@/lib/dev/mock-data'
import { CREDIT_PACKS } from '@/lib/payments/packs'
import { buildReferralUrl } from '@/lib/referrals/links'
import { createClient } from '@/lib/supabase/server'
import { CreditPacksClient } from './CreditPacksClient'
import { DataExportButton } from './DataExportButton'
import { ReferralCopyButton } from './ReferralCopyButton'

export const dynamic = 'force-dynamic'

const FREE_QUOTA_WEEKLY = 5
const BONUS_CAP = 50

interface ProfileRow {
  email: string
  credits_balance: number
  free_used_this_week: number
  referral_code: string
  bonus_credits_earned: number
}

async function softDeleteAccount(): Promise<void> {
  'use server'
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  // Cast required until `pnpm supabase:types` regenerates strict Database types.
  const update = { deleted_at: new Date().toISOString() } as never
  await supabase.from('profiles').update(update).eq('id', user.id)

  trackServer(user.id, EVENTS.ACCOUNT_DELETED, {})
  await flushServer()

  await supabase.auth.signOut()
  redirect('/')
}

interface SettingsPageProps {
  searchParams: Promise<{ purchase?: string; pack?: string }>
}

export default async function SettingsPage({ searchParams }: SettingsPageProps) {
  const { purchase, pack } = await searchParams

  let profile: ProfileRow | null

  if (MOCK_TRENDS_ENABLED) {
    profile = MOCK_PROFILE
  } else {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) redirect('/login?next=/me/settings')

    const { data: profileRow } = await supabase
      .from('profiles')
      .select('email, credits_balance, free_used_this_week, referral_code, bonus_credits_earned')
      .eq('id', user.id)
      .maybeSingle()

    profile = (profileRow as unknown as ProfileRow | null) ?? null
  }

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'
  const referralUrl = profile ? buildReferralUrl(siteUrl, profile.referral_code) : null

  const packs = CREDIT_PACKS.map((p) => ({
    id: p.id,
    label: p.label,
    credits: p.credits,
    priceCents: p.priceCents,
    perCreditCents: p.perCreditCents,
  }))

  return (
    <section className="flex flex-col gap-10">
      <header className="flex flex-col gap-2">
        <h1 className="text-4xl font-extrabold tracking-tight">
          <span className="text-gradient-hero">Settings</span>
        </h1>
        {profile && <p className="text-sm text-muted-foreground">Signed in as {profile.email}</p>}
      </header>

      {purchase === 'success' && (
        <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-700 dark:text-emerald-300">
          Purchase complete{pack ? ` — ${pack} pack credited` : ''}. Credits should appear in a moment.
        </div>
      )}
      {purchase === 'cancelled' && (
        <div className="rounded-2xl border border-border bg-muted px-4 py-3 text-sm text-muted-foreground">
          Checkout cancelled — no charge made.
        </div>
      )}

      {profile && (
        <>
          {/* Quota dashboard */}
          <div className="rounded-3xl border border-border/60 bg-card p-6 sm:p-8">
            <h2 className="text-2xl font-extrabold tracking-tight">Your quota</h2>
            <div className="mt-6 grid gap-6 sm:grid-cols-3">
              <QuotaMeter
                label="Free this week"
                used={profile.free_used_this_week}
                cap={FREE_QUOTA_WEEKLY}
                accent="pink"
              />
              <QuotaMeter
                label="Credits"
                used={profile.credits_balance}
                cap={Math.max(profile.credits_balance, 100)}
                accent="cyan"
                showAsBalance
              />
              <QuotaMeter
                label="Bonus earned"
                used={profile.bonus_credits_earned}
                cap={BONUS_CAP}
                accent="gold"
              />
            </div>
          </div>

          {/* Buy credits */}
          <div className="rounded-3xl border border-border/60 bg-card p-6 sm:p-8">
            <div className="flex items-baseline justify-between">
              <h2 className="text-2xl font-extrabold tracking-tight">Buy credits</h2>
              <Badge variant="outline" className="rounded-full text-xs">
                <Sparkles className="size-3" /> No watermark on Pro
              </Badge>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              Credits never expire. While you have credits: no watermark, generations saved forever, premium support.
            </p>
            <div className="mt-6">
              <CreditPacksClient packs={packs} />
            </div>
          </div>

          {/* Referral */}
          {referralUrl && (
            <div className="rounded-3xl border border-border/60 bg-gradient-spotlight/20 p-6 sm:p-8">
              <div className="flex items-center gap-2">
                <Gift className="size-5 text-[var(--brand-grad-1)]" />
                <h2 className="text-2xl font-extrabold tracking-tight">Invite friends</h2>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                +10 credits per friend that finishes their first generation. Max {BONUS_CAP} bonus credits.
              </p>
              <div className="mt-5 flex items-center gap-2 rounded-2xl border border-border bg-card p-2">
                <code className="flex-1 truncate px-3 py-2 font-mono text-xs">{referralUrl}</code>
                <ReferralCopyButton url={referralUrl} />
              </div>
            </div>
          )}
        </>
      )}

      {/* Your data — GDPR Article 15 right-of-access */}
      <div className="rounded-3xl border border-border/60 bg-card p-6 sm:p-8">
        <div className="flex items-center gap-2">
          <FileDown className="size-5 text-[var(--brand-grad-2)]" />
          <h2 className="text-2xl font-extrabold tracking-tight">Your data</h2>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          Download everything we store about you — profile + generation history + signed URLs valid for 1 hour (GDPR Article 15).
        </p>
        <div className="mt-5">
          <DataExportButton />
        </div>
      </div>

      {/* Danger zone */}
      <div className="rounded-3xl border border-destructive/30 bg-destructive/5 p-6 sm:p-8">
        <div className="flex items-center gap-2">
          <Trash2 className="size-5 text-destructive" />
          <h2 className="text-xl font-extrabold tracking-tight text-destructive">Danger zone</h2>
        </div>
        <p className="mt-2 text-sm text-muted-foreground">
          Soft-deletes your account. Profile marked deleted immediately and purged after 30 days (GDPR).
        </p>
        <form action={softDeleteAccount} className="mt-4">
          <Button
            type="submit"
            variant="destructive"
            size="lg"
            className="rounded-full"
          >
            Delete my account
          </Button>
        </form>
      </div>
    </section>
  )
}

interface QuotaMeterProps {
  label: string
  used: number
  cap: number
  accent: 'pink' | 'cyan' | 'gold'
  /** When true, the big number shows `used` as a raw balance not "used / cap". */
  showAsBalance?: boolean
}

function QuotaMeter({ label, used, cap, accent, showAsBalance }: QuotaMeterProps) {
  const RADIUS = 42
  const CIRC = 2 * Math.PI * RADIUS
  const pct = cap > 0 ? Math.min(1, used / cap) : 0
  const dash = CIRC * pct
  const stroke = ACCENT_STROKE[accent]
  return (
    <div className="flex items-center gap-4">
      <div className="relative grid size-24 shrink-0 place-items-center">
        <svg width="96" height="96" viewBox="0 0 100 100" className="-rotate-90">
          <circle
            cx="50"
            cy="50"
            r={RADIUS}
            fill="none"
            className="stroke-border"
            strokeWidth="10"
          />
          <circle
            cx="50"
            cy="50"
            r={RADIUS}
            fill="none"
            stroke={stroke}
            strokeWidth="10"
            strokeLinecap="round"
            strokeDasharray={CIRC}
            strokeDashoffset={CIRC - dash}
          />
        </svg>
        <div className="absolute flex flex-col items-center text-center">
          <span className="text-xl font-extrabold leading-none">{used}</span>
          {!showAsBalance && <span className="text-[10px] uppercase tracking-wider text-muted-foreground">of {cap}</span>}
        </div>
      </div>
      <div className="flex flex-col gap-1">
        <p className="text-sm font-semibold">{label}</p>
        {showAsBalance ? (
          <p className="text-xs text-muted-foreground">credits in wallet</p>
        ) : (
          <p className="text-xs text-muted-foreground">{cap - used} remaining</p>
        )}
      </div>
    </div>
  )
}

const ACCENT_STROKE: Record<'pink' | 'cyan' | 'gold', string> = {
  pink: '#ff2e63',
  cyan: '#00d4ff',
  gold: '#ffd93d',
}
