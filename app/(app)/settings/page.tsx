import { FileDown, Gift, Sparkles, Trash2 } from 'lucide-react'
import { redirect } from 'next/navigation'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { EVENTS, flushServer, trackServer } from '@/lib/analytics/server'
import { MOCK_PROFILE, MOCK_TRENDS_ENABLED } from '@/lib/dev/mock-data'
import { CREDIT_PACKS } from '@/lib/payments/packs'
import { buildReferralUrl } from '@/lib/referrals/links'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { getAccountTier } from '@/lib/account/tier'
import { CreditPacksClient } from './CreditPacksClient'
import { DataExportButton } from './DataExportButton'
import { ReferralCopyButton } from './ReferralCopyButton'
import { type SubscriptionRow, SubscriptionClient } from './SubscriptionClient'

export const dynamic = 'force-dynamic'

const FREE_QUOTA_WEEKLY = 5
const BONUS_CAP = 50

interface ProfileRow {
  email: string
  credits_balance: number | null
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
  const update = { deleted_at: new Date().toISOString() }
  await supabase.from('profiles').update(update).eq('id', user.id)

  trackServer(user.id, EVENTS.ACCOUNT_DELETED, {})
  await flushServer()

  await supabase.auth.signOut()
  redirect('/')
}

interface SettingsPageProps {
  searchParams: Promise<{ purchase?: string; pack?: string; subscription?: string }>
}

export default async function SettingsPage({ searchParams }: SettingsPageProps) {
  const { purchase, pack, subscription } = await searchParams

  let profile: ProfileRow | null
  let isKimp = false
  let subscriptionRow: SubscriptionRow | null = null

  if (MOCK_TRENDS_ENABLED) {
    profile = MOCK_PROFILE
  } else {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) redirect('/login?next=/settings')

    const [profileResult, tier] = await Promise.all([
      supabase
        .from('profiles')
        .select('email, credits_balance, free_used_this_week, referral_code, bonus_credits_earned')
        .eq('id', user.id)
        .maybeSingle(),
      getAccountTier(user.id),
    ])

    profile = profileResult.data ?? null
    isKimp = tier === 'kimp'

    if (!isKimp) {
      const service = createServiceClient()
      const { data: sub } = await service
        .from('subscriptions')
        .select('plan, status, cancel_at_period_end, current_period_end, monthly_credit_allotment')
        .eq('user_id', user.id)
        .in('status', ['active', 'past_due', 'incomplete', 'trialing'])
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      subscriptionRow = sub ?? null
    }
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

  // Billing goes live only once Stripe is configured. Until then, show a
  // "coming soon" card rather than buy buttons that would 503 on click.
  const billingEnabled = Boolean(process.env.STRIPE_SECRET_KEY)

  return (
    <section className="flex flex-col gap-10">
      <header className="flex flex-col gap-2">
        <h1 className="text-4xl font-extrabold tracking-tight">
          <span className="text-gradient-hero">Settings</span>
        </h1>
        {profile && <p className="text-muted-foreground text-sm">Signed in as {profile.email}</p>}
      </header>

      {purchase === 'success' && (
        <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-700 dark:text-emerald-300">
          Purchase complete{pack ? ` — ${pack} pack credited` : ''}. Credits should appear in a
          moment.
        </div>
      )}
      {purchase === 'cancelled' && (
        <div className="border-border bg-muted text-muted-foreground rounded-2xl border px-4 py-3 text-sm">
          Checkout cancelled — no charge made.
        </div>
      )}
      {subscription === 'success' && (
        <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-700 dark:text-emerald-300">
          Subscription activated — monthly credits will arrive shortly.
        </div>
      )}

      {profile && (
        <>
          {/* Quota dashboard */}
          <div className="border-border/60 bg-card rounded-3xl border p-6 sm:p-8">
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
                used={profile.credits_balance ?? 0}
                cap={Math.max(profile.credits_balance ?? 0, 100)}
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

          {!isKimp && billingEnabled && (
            <>
              {/* Subscription plans */}
              <div className="border-border/60 bg-card rounded-3xl border p-6 sm:p-8">
                <h2 className="text-2xl font-extrabold tracking-tight">Subscription</h2>
                <p className="text-muted-foreground mt-1 text-sm">
                  Monthly credits, no watermark, and premium support while subscribed.
                </p>
                <div className="mt-6">
                  <SubscriptionClient subscription={subscriptionRow} />
                </div>
              </div>

              {/* Buy credits */}
              <div className="border-border/60 bg-card rounded-3xl border p-6 sm:p-8">
                <div className="flex items-baseline justify-between">
                  <h2 className="text-2xl font-extrabold tracking-tight">Buy credits</h2>
                  <Badge variant="outline" className="rounded-full text-xs">
                    <Sparkles className="size-3" /> No watermark on Pro
                  </Badge>
                </div>
                <p className="text-muted-foreground mt-1 text-sm">
                  Credits never expire. While you have credits: no watermark, generations saved
                  forever, premium support.
                </p>
                <div className="mt-6">
                  <CreditPacksClient packs={packs} />
                </div>
              </div>
            </>
          )}

          {!isKimp && !billingEnabled && (
            <div className="border-border/60 bg-card rounded-3xl border p-6 sm:p-8">
              <div className="flex items-baseline justify-between">
                <h2 className="text-2xl font-extrabold tracking-tight">Credits &amp; plans</h2>
                <Badge variant="outline" className="rounded-full text-xs">
                  Coming soon
                </Badge>
              </div>
              <p className="text-muted-foreground mt-1 text-sm">
                Paid credits and subscriptions are launching shortly. For now, enjoy your{' '}
                {FREE_QUOTA_WEEKLY} free generations each week — and invite friends below for bonus
                credits.
              </p>
            </div>
          )}

          {/* Referral */}
          {referralUrl && (
            <div className="border-border/60 bg-gradient-spotlight/20 rounded-3xl border p-6 sm:p-8">
              <div className="flex items-center gap-2">
                <Gift className="size-5 text-[var(--brand-grad-1)]" />
                <h2 className="text-2xl font-extrabold tracking-tight">Invite friends</h2>
              </div>
              <p className="text-muted-foreground mt-1 text-sm">
                +10 credits per friend that finishes their first generation. Max {BONUS_CAP} bonus
                credits.
              </p>
              <div className="border-border bg-card mt-5 flex items-center gap-2 rounded-2xl border p-2">
                <code className="flex-1 truncate px-3 py-2 font-mono text-xs">{referralUrl}</code>
                <ReferralCopyButton url={referralUrl} />
              </div>
            </div>
          )}
        </>
      )}

      {/* Your data — GDPR Article 15 right-of-access */}
      <div className="border-border/60 bg-card rounded-3xl border p-6 sm:p-8">
        <div className="flex items-center gap-2">
          <FileDown className="size-5 text-[var(--brand-grad-2)]" />
          <h2 className="text-2xl font-extrabold tracking-tight">Your data</h2>
        </div>
        <p className="text-muted-foreground mt-1 text-sm">
          Download everything we store about you — profile + generation history + signed URLs valid
          for 1 hour (GDPR Article 15).
        </p>
        <div className="mt-5">
          <DataExportButton />
        </div>
      </div>

      {/* Danger zone */}
      <div className="border-destructive/30 bg-destructive/5 rounded-3xl border p-6 sm:p-8">
        <div className="flex items-center gap-2">
          <Trash2 className="text-destructive size-5" />
          <h2 className="text-destructive text-xl font-extrabold tracking-tight">Danger zone</h2>
        </div>
        <p className="text-muted-foreground mt-2 text-sm">
          Soft-deletes your account. Profile marked deleted immediately and purged after 30 days
          (GDPR).
        </p>
        <form action={softDeleteAccount} className="mt-4">
          <Button type="submit" variant="destructive" size="lg" className="rounded-full">
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
          <span className="text-xl leading-none font-extrabold">{used}</span>
          {!showAsBalance && (
            <span className="text-muted-foreground text-[10px] tracking-wider uppercase">
              of {cap}
            </span>
          )}
        </div>
      </div>
      <div className="flex flex-col gap-1">
        <p className="text-sm font-semibold">{label}</p>
        {showAsBalance ? (
          <p className="text-muted-foreground text-xs">credits in wallet</p>
        ) : (
          <p className="text-muted-foreground text-xs">{cap - used} remaining</p>
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
