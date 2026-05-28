import { redirect } from 'next/navigation'
import { EVENTS, flushServer, trackServer } from '@/lib/analytics/server'
import { MOCK_PROFILE, MOCK_TRENDS_ENABLED } from '@/lib/dev/mock-data'
import { CREDIT_PACKS } from '@/lib/payments/packs'
import { buildReferralUrl } from '@/lib/referrals/links'
import { createClient } from '@/lib/supabase/server'
import { CreditPacksClient } from './CreditPacksClient'

export const dynamic = 'force-dynamic'

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
    <section className="flex max-w-2xl flex-col gap-10">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">Settings</h1>
      </header>

      {purchase === 'success' && (
        <p className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
          Purchase complete{pack ? ` — ${pack} pack credited` : ''}. Credits should appear in a moment.
        </p>
      )}
      {purchase === 'cancelled' && (
        <p className="rounded-md bg-zinc-100 px-3 py-2 text-sm text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
          Checkout cancelled — no charge made.
        </p>
      )}

      {profile && (
        <>
          <div className="flex flex-col gap-3 rounded-lg border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
            <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Quota</h2>
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <dt className="text-zinc-500">Free this week</dt>
              <dd className="text-zinc-900 dark:text-zinc-50">{profile.free_used_this_week} / 5</dd>
              <dt className="text-zinc-500">Credits</dt>
              <dd className="text-zinc-900 dark:text-zinc-50">{profile.credits_balance}</dd>
              <dt className="text-zinc-500">Bonus earned</dt>
              <dd className="text-zinc-900 dark:text-zinc-50">{profile.bonus_credits_earned} / 50</dd>
            </dl>
          </div>

          <div className="flex flex-col gap-3 rounded-lg border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
            <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Buy credits</h2>
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              Credits never expire. Pro perks while you have credits: no watermark, generations saved forever, premium support.
            </p>
            <CreditPacksClient packs={packs} />
          </div>

          <div className="flex flex-col gap-3 rounded-lg border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-900">
            <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">Invite friends</h2>
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              You get +10 credits when an invitee completes their first generation. Max 50 bonus credits total.
            </p>
            <code className="block break-all rounded bg-zinc-100 p-3 text-xs dark:bg-zinc-800">
              {referralUrl}
            </code>
          </div>
        </>
      )}

      <div className="flex flex-col gap-3 rounded-lg border border-red-200 bg-red-50 p-6 dark:border-red-950 dark:bg-red-950/40">
        <h2 className="text-lg font-semibold text-red-900 dark:text-red-200">Danger zone</h2>
        <p className="text-sm text-red-800 dark:text-red-300">
          Soft-deletes your account. Your profile is marked deleted immediately and purged after 30 days (GDPR).
        </p>
        <form action={softDeleteAccount}>
          <button
            type="submit"
            className="h-10 rounded-md bg-red-600 px-4 text-sm font-medium text-white hover:bg-red-700"
          >
            Delete my account
          </button>
        </form>
      </div>
    </section>
  )
}
