# Phase 3 — Stripe Subscriptions

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add monthly subscription plans (50/200/600 credits/mo) alongside existing one-time packs, with correct period-keyed idempotency, a billing portal, chargeback clawback, and KIMP-gated UI.

**Architecture:** Three new migrations add `subscriptions`, `monthly_credit_grants` (real period idempotency key), and `claw_back_credits` RPC. The webhook handler grows to cover subscription events; allotment always comes from the server-side `findPlanByPriceId` map, never from Stripe amounts. KIMP clients see no paid UI. Subscriptions co-exist with one-time packs; `monthly_credits` and `purchased_credits` remain separate buckets (Phase 0).

**Tech Stack:** Next.js 16 App Router, TypeScript strict, Supabase Postgres (PL/pgSQL), Stripe SDK, Vitest.

## Global Constraints

- Migration files: `20260604NNNNNN_<slug>.sql` sequential timestamps.
- All PL/pgSQL functions: `security definer set search_path = public`.
- Allotment resolved from `findPlanByPriceId(priceId)` map — NEVER from `invoice.amount_paid` or `session.metadata` amounts (H-C6).
- `monthly_credit_grants` is the period-keyed idempotency carrier: `unique(stripe_subscription_id, period_start)` — `webhook_events(source,event_id)` is still used but is NOT the subscription-grant idempotency key (H-C3).
- `claw_back_credits` must use `SELECT … FOR UPDATE` and `greatest(balance-amount, 0)` clamp — never causes negative balance (H-C5).
- Portal route: derive `stripe_customer_id` from authenticated profile only — never accept from request body (H-S6).
- KIMP users (`getAccountTier='kimp'`): hide ALL paid UI (subscriptions + packs). Gate server-side on the settings page.
- `Sentry.captureException` before every 500 return in webhook/checkout/portal (H-O3).
- Partial unique index enforcing one active subscription per user: `subscriptions_one_active ON subscriptions(user_id) WHERE status IN ('active','past_due','incomplete')` (H-C11).
- `pnpm typecheck` → `npx tsc --noEmit`; `npx vitest run` 570/572; `npx next build` passing.

---

## File Map

**Create (migrations):**

- `supabase/migrations/20260604000001_subscriptions.sql`
- `supabase/migrations/20260604000002_monthly_credit_grants.sql`
- `supabase/migrations/20260604000003_claw_back_credits.sql`

**Create (lib + routes):**

- `lib/payments/plans.ts`
- `app/api/stripe/portal/route.ts`
- `app/(app)/me/settings/SubscriptionClient.tsx`

**Modify:**

- `lib/env.ts` — add `STRIPE_PRICE_ID_SUB_STARTER/PRO/STUDIO`
- `app/api/stripe/checkout/route.ts` — branch on `plan_id` vs `pack_id`
- `app/api/stripe/webhook/route.ts` — extend event handling, add Sentry, subscription events
- `app/(app)/me/settings/page.tsx` — load subscription row, gate paid UI for KIMP

---

## Task 1 — DB migrations: subscriptions + monthly_credit_grants + claw_back_credits

**Files:**

- Create: `supabase/migrations/20260604000001_subscriptions.sql`
- Create: `supabase/migrations/20260604000002_monthly_credit_grants.sql`
- Create: `supabase/migrations/20260604000003_claw_back_credits.sql`

- [ ] **Step 1: Write migration 1 — subscriptions table**

```sql
-- 20260604000001_subscriptions.sql
-- Phase 3: subscription plan state. One active subscription per user enforced
-- by a partial unique index (H-C11). Writes: service-role only.

create type public.subscription_plan   as enum ('starter50', 'pro200', 'studio600');
create type public.subscription_status as enum ('active', 'past_due', 'canceled', 'incomplete', 'trialing');

create table public.subscriptions (
  id                       uuid primary key default gen_random_uuid(),
  user_id                  uuid not null references public.profiles(id) on delete cascade,
  plan                     public.subscription_plan   not null,
  status                   public.subscription_status not null,
  stripe_subscription_id   text unique not null,
  stripe_customer_id       text,
  monthly_credit_allotment int  not null check (monthly_credit_allotment > 0),
  current_period_start     timestamptz,
  current_period_end       timestamptz,
  cancel_at_period_end     boolean not null default false,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

-- One active/past_due/incomplete sub per user (H-C11)
create unique index subscriptions_one_active_per_user
  on public.subscriptions(user_id)
  where status in ('active', 'past_due', 'incomplete', 'trialing');

create index subscriptions_user_idx   on public.subscriptions(user_id);
create index subscriptions_stripe_idx on public.subscriptions(stripe_subscription_id);

alter table public.subscriptions enable row level security;
create policy "subscriptions_self_read" on public.subscriptions
  for select using (auth.uid() = user_id);
-- Writes: service-role only (no insert/update/delete policy for authenticated)
```

- [ ] **Step 2: Write migration 2 — monthly_credit_grants + grant/zero RPCs**

```sql
-- 20260604000002_monthly_credit_grants.sql
-- Phase 3: per-period grant idempotency table + RPCs.
-- The period key (stripe_subscription_id, period_start) prevents double-grants
-- across distinct Stripe events (invoice.paid + subscription.updated) for the
-- same billing cycle — webhook_events(source,event_id) alone cannot express this.

create table public.monthly_credit_grants (
  stripe_subscription_id text        not null,
  period_start           timestamptz not null,
  user_id                uuid        not null references public.profiles(id) on delete cascade,
  allotment              int         not null,
  granted_at             timestamptz not null default now(),
  primary key (stripe_subscription_id, period_start)
);

alter table public.monthly_credit_grants enable row level security;
-- Service-role only

-- grant_monthly_credits: idempotent SET (not increment) on monthly_credits.
-- ON CONFLICT DO NOTHING ensures repeat calls for the same period are no-ops.
create or replace function public.grant_monthly_credits(
  p_user_id         uuid,
  p_subscription_id text,
  p_period_start    timestamptz,
  p_allotment       int
)
returns boolean  -- true = granted, false = already granted (idempotent no-op)
language plpgsql security definer set search_path = public as $$
declare v_inserted boolean;
begin
  if p_allotment <= 0 then
    raise exception 'grant_monthly_credits: allotment must be positive';
  end if;

  insert into public.monthly_credit_grants (stripe_subscription_id, period_start, user_id, allotment)
  values (p_subscription_id, p_period_start, p_user_id, p_allotment)
  on conflict (stripe_subscription_id, period_start) do nothing;

  get diagnostics v_inserted = row_count;

  if v_inserted then
    -- SET (use-it-or-lose-it, no rollover)
    update public.profiles
       set monthly_credits          = p_allotment,
           monthly_credits_reset_at = now()
     where id = p_user_id and deleted_at is null;

    insert into public.admin_audit_log (admin_id, action, target_table, target_id, after)
    values (null, 'monthly_credit_grant', 'profiles', p_user_id::text,
      jsonb_build_object(
        'allotment', p_allotment,
        'subscription_id', p_subscription_id,
        'period_start', p_period_start
      ));
  end if;

  return v_inserted;
end;
$$;

revoke all on function public.grant_monthly_credits(uuid, text, timestamptz, int) from public;
grant execute on function public.grant_monthly_credits(uuid, text, timestamptz, int) to service_role;

-- zero_monthly_credits: called on subscription.deleted at period end
create or replace function public.zero_monthly_credits(p_user_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.profiles set monthly_credits = 0 where id = p_user_id and deleted_at is null;

  insert into public.admin_audit_log (admin_id, action, target_table, target_id, after)
  values (null, 'monthly_credits_zeroed', 'profiles', p_user_id::text, '{}'::jsonb);
end;
$$;

revoke all on function public.zero_monthly_credits(uuid) from public;
grant execute on function public.zero_monthly_credits(uuid) to service_role;
```

- [ ] **Step 3: Write migration 3 — claw_back_credits RPC**

```sql
-- 20260604000003_claw_back_credits.sql
-- Phase 3: chargeback / refund clawback (H-C5).
-- FOR UPDATE lock prevents race with concurrent spend.
-- greatest() clamp ensures CHECK(>=0) is never violated.
-- Shortfall (already-spent refunded amount) is audited, not thrown.

create or replace function public.claw_back_credits(
  p_user_id    uuid,
  p_amount     int,
  p_bucket     text,  -- 'monthly' or 'purchased'
  p_source     text,
  p_source_ref text
)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_profile  public.profiles;
  v_before   int;
  v_after    int;
  v_shortfall int;
begin
  if p_amount <= 0 then return; end if;
  if p_bucket not in ('monthly', 'purchased') then
    raise exception 'claw_back_credits: invalid bucket %', p_bucket;
  end if;

  select * into v_profile from public.profiles where id = p_user_id for update;
  if not found then return; end if;

  if p_bucket = 'monthly' then
    v_before := v_profile.monthly_credits;
    v_after  := greatest(v_before - p_amount, 0);
    update public.profiles set monthly_credits   = v_after where id = p_user_id;
  else
    v_before := v_profile.purchased_credits;
    v_after  := greatest(v_before - p_amount, 0);
    update public.profiles set purchased_credits = v_after where id = p_user_id;
  end if;

  v_shortfall := p_amount - (v_before - v_after);

  insert into public.admin_audit_log (admin_id, action, target_table, target_id, after)
  values (null, 'credit_clawback', 'profiles', p_user_id::text,
    jsonb_build_object(
      'bucket',      p_bucket,
      'requested',   p_amount,
      'clawed_back', v_before - v_after,
      'shortfall',   v_shortfall,
      'source',      p_source,
      'source_ref',  p_source_ref
    ));
end;
$$;

revoke all on function public.claw_back_credits(uuid, int, text, text, text) from public;
grant execute on function public.claw_back_credits(uuid, int, text, text, text) to service_role;
```

- [ ] **Step 4: Apply and verify**

```bash
./node_modules/.bin/supabase db reset
./node_modules/.bin/supabase db query "SELECT table_name FROM information_schema.tables WHERE table_name IN ('subscriptions','monthly_credit_grants');" 2>&1
./node_modules/.bin/supabase db query "SELECT proname FROM pg_proc WHERE proname IN ('grant_monthly_credits','zero_monthly_credits','claw_back_credits');" 2>&1
```

Expected: both tables + all 3 RPCs found.

- [ ] **Step 5: Run tests**

```bash
npx vitest run
```

Expected: 570/572.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260604000001_subscriptions.sql \
        supabase/migrations/20260604000002_monthly_credit_grants.sql \
        supabase/migrations/20260604000003_claw_back_credits.sql
git commit -m "feat(db): subscriptions table, monthly_credit_grants idempotency, claw_back_credits RPC"
```

---

## Task 2 — lib/payments/plans.ts + env vars

**Files:**

- Create: `lib/payments/plans.ts`
- Modify: `lib/env.ts`

- [ ] **Step 1: Write `lib/payments/plans.ts`**

```typescript
/**
 * Subscription plans — monthly credits via Stripe.
 * Structure mirrors lib/payments/packs.ts exactly.
 * Allotment is resolved HERE from the Stripe price_id — never from event amounts.
 */

export type PlanId = 'starter50' | 'pro200' | 'studio600'

export interface SubscriptionPlan {
  id: PlanId
  label: string
  monthlyCredits: number
  priceIdEnv: string
  priceCentsMonthly: number // for display only
}

export const SUBSCRIPTION_PLANS: ReadonlyArray<SubscriptionPlan> = [
  {
    id: 'starter50',
    label: 'Starter — 50 credits/mo',
    monthlyCredits: 50,
    priceIdEnv: 'STRIPE_PRICE_ID_SUB_STARTER',
    priceCentsMonthly: 499,
  },
  {
    id: 'pro200',
    label: 'Pro — 200 credits/mo',
    monthlyCredits: 200,
    priceIdEnv: 'STRIPE_PRICE_ID_SUB_PRO',
    priceCentsMonthly: 1499,
  },
  {
    id: 'studio600',
    label: 'Studio — 600 credits/mo',
    monthlyCredits: 600,
    priceIdEnv: 'STRIPE_PRICE_ID_SUB_STUDIO',
    priceCentsMonthly: 3999,
  },
]

export function findPlan(id: PlanId | string): SubscriptionPlan | null {
  return SUBSCRIPTION_PLANS.find((p) => p.id === id) ?? null
}

export function isPlanId(value: unknown): value is PlanId {
  return value === 'starter50' || value === 'pro200' || value === 'studio600'
}

/**
 * Resolve plan by Stripe price_id (used in webhook to derive allotment).
 * This is the authoritative allotment source — never use invoice amounts.
 */
export function findPlanByPriceId(priceId: string): SubscriptionPlan | null {
  for (const plan of SUBSCRIPTION_PLANS) {
    const envId = process.env[plan.priceIdEnv]
    if (envId && envId === priceId) return plan
  }
  return null
}

export function requirePlanPriceId(plan: SubscriptionPlan): string {
  const id = process.env[plan.priceIdEnv]
  if (!id)
    throw new Error(`${plan.priceIdEnv} is not set — create the Stripe price for "${plan.label}"`)
  return id
}
```

- [ ] **Step 2: Add env vars to `lib/env.ts`**

After `STRIPE_PRICE_ID_LARGE`, add:

```typescript
STRIPE_PRICE_ID_SUB_STARTER: z.string().min(1).optional(),
STRIPE_PRICE_ID_SUB_PRO: z.string().min(1).optional(),
STRIPE_PRICE_ID_SUB_STUDIO: z.string().min(1).optional(),
```

- [ ] **Step 3: Run typecheck + tests**

```bash
npx tsc --noEmit && npx vitest run
```

Expected: clean, 570/572.

- [ ] **Step 4: Commit**

```bash
git add lib/payments/plans.ts lib/env.ts
git commit -m "feat(payments): subscription plans lib, price-id env vars"
```

---

## Task 3 — Billing portal route (IDOR-safe)

**Files:**

- Create: `app/api/stripe/portal/route.ts`

- [ ] **Step 1: Write the route**

```typescript
import { NextResponse, type NextRequest } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import Stripe from 'stripe'
import { createClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function getStripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY
  if (!key) throw new Error('STRIPE_SECRET_KEY missing')
  return new Stripe(key)
}

export async function POST(request: NextRequest) {
  try {
    // Auth — MUST derive customer_id from authenticated session, never from body (H-S6 IDOR)
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

    const { data: profile } = await supabase
      .from('profiles')
      .select('stripe_customer_id')
      .eq('id', user.id)
      .maybeSingle()

    if (!profile?.stripe_customer_id) {
      return NextResponse.json({ error: 'No billing account found' }, { status: 404 })
    }

    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'
    const stripe = getStripe()
    const session = await stripe.billingPortal.sessions.create({
      customer: profile.stripe_customer_id,
      return_url: `${siteUrl}/me/settings`,
    })

    return NextResponse.json({ url: session.url })
  } catch (err: unknown) {
    Sentry.captureException(err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'portal error' },
      { status: 500 }
    )
  }
}
```

- [ ] **Step 2: Run typecheck**

```bash
npx tsc --noEmit
```

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add app/api/stripe/portal/route.ts
git commit -m "feat(stripe): billing portal route — IDOR-safe, derives customer from session"
```

---

## Task 4 — Extend checkout route for subscriptions

**Files:**

- Modify: `app/api/stripe/checkout/route.ts`

- [ ] **Step 1: Update the route**

Read the current file, then replace `BodySchema` and `POST` to support both `pack_id` and `plan_id`. Key changes:

```typescript
import { findPlan, isPlanId, requirePlanPriceId } from '@/lib/payments/plans'

const BodySchema = z.union([
  z.object({ pack_id: z.string().refine(isPackId, 'unknown pack_id') }),
  z.object({ plan_id: z.string().refine(isPlanId, 'unknown plan_id') }),
])
```

In the handler, after parsing:

- If `pack_id` → existing payment mode (unchanged, keep first-purchase coupon logic)
- If `plan_id`:
  1. `findPlan(body.plan_id)` — find the plan
  2. Ensure/create Stripe customer: check `profiles.stripe_customer_id`; if null, `stripe.customers.create({email, metadata: {user_id}})` and bind to profile via service-role `UPDATE profiles SET stripe_customer_id=...` (partial unique index guards against duplicate binding)
  3. `stripe.checkout.sessions.create({ mode: 'subscription', customer: customerId, line_items: [...], subscription_data: { metadata: { user_id, plan_id } }, success_url: .../me/settings?subscription=success, cancel_url: .../me/settings?subscription=cancelled })`
  4. Return `{ checkout_url: session.url }`

Add `Sentry.captureException` before all 500 returns.

- [ ] **Step 2: Run tests + typecheck**

```bash
npx tsc --noEmit && npx vitest run
```

Expected: clean, 570/572.

- [ ] **Step 3: Commit**

```bash
git add app/api/stripe/checkout/route.ts
git commit -m "feat(stripe): extend checkout for subscription mode alongside existing packs"
```

---

## Task 5 — Extend webhook handler

**Files:**

- Modify: `app/api/stripe/webhook/route.ts`

This is the most complex task. Read the current file fully before editing.

- [ ] **Step 1: Add imports**

```typescript
import { findPlanByPriceId } from '@/lib/payments/plans'
```

- [ ] **Step 2: Extend `handleEvent` switch**

```typescript
async function handleEvent(
  event: Stripe.Event,
  supabase: ReturnType<typeof createServiceClient>
): Promise<void> {
  switch (event.type) {
    case 'checkout.session.completed':
      await handleCheckoutCompleted(
        event.data.object as Stripe.Checkout.Session,
        event.id,
        supabase
      )
      return
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
      await handleSubscriptionUpsert(event.data.object as Stripe.Subscription, supabase)
      return
    case 'customer.subscription.deleted':
      await handleSubscriptionDeleted(event.data.object as Stripe.Subscription, supabase)
      return
    case 'invoice.paid':
      await handleInvoicePaid(event.data.object as Stripe.Invoice, supabase)
      return
    case 'invoice.payment_failed':
      await handleInvoicePaymentFailed(event.data.object as Stripe.Invoice, supabase)
      return
    case 'charge.refunded':
    case 'charge.dispute.created':
      await handleChargeClawback(event.data.object as Stripe.Charge, event.type, event.id, supabase)
      return
    default:
      // Breadcrumb unhandled events instead of silent no-op (H-O3)
      Sentry.addBreadcrumb({
        category: 'stripe.webhook',
        level: 'info',
        message: `unhandled event type: ${event.type}`,
        data: { event_id: event.id },
      })
      return
  }
}
```

- [ ] **Step 3: Update `handleCheckoutCompleted`**

Add subscription mode handling. When `session.mode === 'subscription'`:

1. Get `user_id` from metadata/client_reference_id
2. Upsert `subscriptions` row — status from `session.payment_status`, don't grant credits (invoice.paid does that)
3. Bind `stripe_customer_id` to profile if not already set (H-C4): `UPDATE profiles SET stripe_customer_id = session.customer WHERE id = user_id AND stripe_customer_id IS NULL`

Pack mode (existing) unchanged.

- [ ] **Step 4: Add `handleSubscriptionUpsert`**

```typescript
async function handleSubscriptionUpsert(
  sub: Stripe.Subscription,
  supabase: ReturnType<typeof createServiceClient>
): Promise<void> {
  // Resolve user_id from existing subscriptions row or metadata
  const { data: existing } = await supabase
    .from('subscriptions')
    .select('user_id')
    .eq('stripe_subscription_id', sub.id)
    .maybeSingle()

  const userId = existing?.user_id ?? sub.metadata?.user_id ?? null
  if (!userId) return // Can't attribute — skip

  // Resolve plan from price_id (authoritative)
  const priceId = sub.items.data[0]?.price?.id
  const plan = priceId ? findPlanByPriceId(priceId) : null
  if (!plan) return // Unknown price — skip

  await supabase.from('subscriptions').upsert(
    {
      user_id: userId,
      plan: plan.id,
      status: sub.status as string,
      stripe_subscription_id: sub.id,
      stripe_customer_id: typeof sub.customer === 'string' ? sub.customer : sub.customer?.id,
      monthly_credit_allotment: plan.monthlyCredits,
      current_period_start: new Date(sub.current_period_start * 1000).toISOString(),
      current_period_end: new Date(sub.current_period_end * 1000).toISOString(),
      cancel_at_period_end: sub.cancel_at_period_end,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'stripe_subscription_id' }
  )
}
```

- [ ] **Step 5: Add `handleSubscriptionDeleted`**

```typescript
async function handleSubscriptionDeleted(
  sub: Stripe.Subscription,
  supabase: ReturnType<typeof createServiceClient>
): Promise<void> {
  const { data: row } = await supabase
    .from('subscriptions')
    .select('user_id')
    .eq('stripe_subscription_id', sub.id)
    .maybeSingle()

  await supabase
    .from('subscriptions')
    .update({ status: 'canceled', updated_at: new Date().toISOString() })
    .eq('stripe_subscription_id', sub.id)

  if (row?.user_id) {
    await supabase.rpc('zero_monthly_credits', { p_user_id: row.user_id })
  }
}
```

- [ ] **Step 6: Add `handleInvoicePaid`**

```typescript
async function handleInvoicePaid(
  invoice: Stripe.Invoice,
  supabase: ReturnType<typeof createServiceClient>
): Promise<void> {
  const subId =
    typeof invoice.subscription === 'string' ? invoice.subscription : invoice.subscription?.id
  if (!subId) return

  const { data: subRow } = await supabase
    .from('subscriptions')
    .select('user_id, plan, status, monthly_credit_allotment, current_period_start')
    .eq('stripe_subscription_id', subId)
    .maybeSingle()

  if (!subRow) return
  // H-S12: skip grant if subscription is canceled
  if (subRow.status === 'canceled') return

  // Resolve allotment from server-side plan map (never from invoice.amount_paid)
  const lineItem = invoice.lines?.data?.[0]
  const priceId = lineItem?.price?.id
  const plan = priceId ? findPlanByPriceId(priceId) : null
  const allotment = plan?.monthlyCredits ?? subRow.monthly_credit_allotment

  // Period start from invoice line item (billing-cycle accurate)
  const periodStart = lineItem?.period?.start
    ? new Date(lineItem.period.start * 1000).toISOString()
    : (subRow.current_period_start ?? new Date().toISOString())

  await supabase.rpc('grant_monthly_credits', {
    p_user_id: subRow.user_id,
    p_subscription_id: subId,
    p_period_start: periodStart,
    p_allotment: allotment,
  })
}
```

- [ ] **Step 7: Add `handleInvoicePaymentFailed`**

```typescript
async function handleInvoicePaymentFailed(
  invoice: Stripe.Invoice,
  supabase: ReturnType<typeof createServiceClient>
): Promise<void> {
  const subId =
    typeof invoice.subscription === 'string' ? invoice.subscription : invoice.subscription?.id
  if (!subId) return
  await supabase
    .from('subscriptions')
    .update({ status: 'past_due', updated_at: new Date().toISOString() })
    .eq('stripe_subscription_id', subId)
}
```

- [ ] **Step 8: Add `handleChargeClawback`**

```typescript
async function handleChargeClawback(
  charge: Stripe.Charge,
  eventType: string,
  eventId: string,
  supabase: ReturnType<typeof createServiceClient>
): Promise<void> {
  const customerId = typeof charge.customer === 'string' ? charge.customer : charge.customer?.id
  if (!customerId) return

  const { data: profile } = await supabase
    .from('profiles')
    .select('id')
    .eq('stripe_customer_id', customerId)
    .maybeSingle()

  if (!profile) return

  // Determine bucket: subscription charges clawback monthly, pack charges clawback purchased
  // A charge linked to a subscription invoice → monthly bucket; otherwise → purchased
  const isSubscriptionCharge = Boolean(charge.invoice)
  const bucket = isSubscriptionCharge ? 'monthly' : 'purchased'
  const amountCents = charge.amount_refunded ?? charge.amount

  // Convert cents to credits — approximate: $0.024/credit baseline
  // This is an approximation; for billing accuracy use the actual allotment from the sub
  const creditsToClawback = Math.ceil(amountCents / 2.4)

  await supabase.rpc('claw_back_credits', {
    p_user_id: profile.id,
    p_amount: creditsToClawback,
    p_bucket: bucket,
    p_source: 'stripe',
    p_source_ref: eventId,
  })
}
```

- [ ] **Step 9: Add Sentry.captureException before the 500 return in POST**

In the existing `try { await handleEvent(...) } catch (err)` block, before `return NextResponse.json({ error: message }, { status: 500 })`, add:

```typescript
Sentry.captureException(err instanceof Error ? err : new Error(String(err)), {
  extra: { event_id: event.id, event_type: event.type },
})
```

- [ ] **Step 10: Run tests**

```bash
npx tsc --noEmit && npx vitest run
```

Expected: clean, 570/572.

- [ ] **Step 11: Commit**

```bash
git add app/api/stripe/webhook/route.ts
git commit -m "feat(stripe): subscription webhook events — invoice.paid, subscription lifecycle, clawback, Sentry"
```

---

## Task 6 — Subscription UI + settings page gating

**Files:**

- Create: `app/(app)/me/settings/SubscriptionClient.tsx`
- Modify: `app/(app)/me/settings/page.tsx`

- [ ] **Step 1: Write `SubscriptionClient.tsx`**

```typescript
'use client'

import { ExternalLink } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import type { subscription_plan, subscription_status } from '@/lib/supabase/database.types'

interface SubscriptionRow {
  plan: subscription_plan
  status: subscription_status
  cancel_at_period_end: boolean
  current_period_end: string | null
  monthly_credit_allotment: number
}

interface SubscriptionClientProps {
  subscription: SubscriptionRow | null
}

const PLAN_LABELS: Record<subscription_plan, string> = {
  starter50:  'Starter — 50 credits/mo',
  pro200:     'Pro — 200 credits/mo',
  studio600:  'Studio — 600 credits/mo',
}

export function SubscriptionClient({ subscription }: SubscriptionClientProps) {
  const [loading, setLoading] = useState(false)

  const openPortal = async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/stripe/portal', { method: 'POST' })
      const json = await res.json() as { url?: string; error?: string }
      if (!res.ok || !json.url) throw new Error(json.error ?? 'Portal unavailable')
      window.location.href = json.url
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not open billing portal')
      setLoading(false)
    }
  }

  if (!subscription) {
    return (
      <div className="flex flex-col gap-4">
        <p className="text-muted-foreground text-sm">No active subscription.</p>
        <div className="grid gap-3 sm:grid-cols-3">
          {(['starter50','pro200','studio600'] as const).map((id) => (
            <PlanCard key={id} planId={id} />
          ))}
        </div>
      </div>
    )
  }

  const periodEnd = subscription.current_period_end
    ? new Date(subscription.current_period_end).toLocaleDateString()
    : null

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <Badge variant={subscription.status === 'active' ? 'default' : 'destructive'} className="rounded-full">
          {subscription.status}
        </Badge>
        <span className="text-sm font-medium">{PLAN_LABELS[subscription.plan]}</span>
      </div>
      {subscription.cancel_at_period_end && periodEnd && (
        <p className="text-muted-foreground text-xs">Cancels on {periodEnd} — credits stop then.</p>
      )}
      {!subscription.cancel_at_period_end && periodEnd && (
        <p className="text-muted-foreground text-xs">Renews {periodEnd} · {subscription.monthly_credit_allotment} credits/mo</p>
      )}
      <Button variant="outline" size="sm" onClick={openPortal} disabled={loading} className="w-fit rounded-full gap-2">
        <ExternalLink className="size-3.5" />
        {loading ? 'Opening…' : 'Manage subscription'}
      </Button>
    </div>
  )
}

function PlanCard({ planId }: { planId: subscription_plan }) {
  const [loading, setLoading] = useState(false)
  const labels = { starter50: { credits: 50, price: '$4.99' }, pro200: { credits: 200, price: '$14.99' }, studio600: { credits: 600, price: '$39.99' } }
  const info = labels[planId]

  const subscribe = async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/stripe/checkout', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ plan_id: planId }),
      })
      const json = await res.json() as { checkout_url?: string; error?: string }
      if (!res.ok || !json.checkout_url) throw new Error(json.error ?? 'Checkout failed')
      window.location.href = json.checkout_url
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Checkout failed')
      setLoading(false)
    }
  }

  return (
    <div className="bg-card border-border/60 flex flex-col gap-3 rounded-2xl border p-4">
      <p className="text-sm font-bold">{info.credits} credits/mo</p>
      <p className="text-2xl font-extrabold">{info.price}<span className="text-muted-foreground text-xs font-normal">/mo</span></p>
      <Button size="sm" onClick={subscribe} disabled={loading} className="w-full rounded-full">
        {loading ? 'Opening…' : 'Subscribe'}
      </Button>
    </div>
  )
}
```

- [ ] **Step 2: Update `app/(app)/me/settings/page.tsx`**

Add imports:

```typescript
import { SubscriptionClient } from './SubscriptionClient'
import { getAccountTier } from '@/lib/account/tier'
```

Update the profile-loading section to also load subscription and tier:

```typescript
const tier = await getAccountTier(user.id)
const isKimp = tier === 'kimp'

// Load subscription only for non-KIMP users
let subscriptionRow: SubscriptionRow | null = null
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
```

In the JSX, wrap both the subscription block and the packs block with `{!isKimp && (...)}`.

- [ ] **Step 3: Run tests + build**

```bash
npx tsc --noEmit && npx vitest run && npx next build
```

Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add "app/(app)/me/settings/SubscriptionClient.tsx" "app/(app)/me/settings/page.tsx"
git commit -m "feat(ui): subscription plan cards, manage portal button, KIMP-gate paid UI"
```

---

## Task 7 — Types regen + vercel.json + final gate

**Files:**

- Modify: `lib/supabase/database.types.ts`
- Modify: `vercel.json`

- [ ] **Step 1: Apply migrations + regen types**

```bash
./node_modules/.bin/supabase db reset
./node_modules/.bin/supabase gen types typescript --local > lib/supabase/database.types.ts
npx tsc --noEmit
```

Expected: typecheck clean. Fix any type errors from new tables/enums.

- [ ] **Step 2: Add portal route to vercel.json**

In `functions` add:

```json
"app/api/stripe/portal/route.ts": { "maxDuration": 30 }
```

- [ ] **Step 3: Add subscription Stripe events to RUNBOOK**

In `docs/RUNBOOK.md`, add to the Stripe webhook section: `invoice.paid`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.payment_failed`, `charge.refunded`, `charge.dispute.created`.

- [ ] **Step 4: Final test + build**

```bash
npx tsc --noEmit && npx vitest run && npx next build
```

Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add lib/supabase/database.types.ts vercel.json docs/RUNBOOK.md
git commit -m "chore(phase-3): regen types, portal in vercel.json, RUNBOOK webhook events"
```

---

## Self-Review

| Spec requirement                                                                                                  | Task     |
| ----------------------------------------------------------------------------------------------------------------- | -------- |
| `subscriptions` table, `subscription_plan` + `subscription_status` enums, self-read RLS                           | T1       |
| `subscriptions_one_active_per_user` partial unique index (H-C11)                                                  | T1       |
| `monthly_credit_grants(stripe_subscription_id, period_start)` unique (H-C3)                                       | T1       |
| `grant_monthly_credits` RPC — ON CONFLICT DO NOTHING, SET monthly_credits                                         | T1       |
| `zero_monthly_credits` RPC                                                                                        | T1       |
| `claw_back_credits` — FOR UPDATE lock, greatest() clamp, shortfall audited (H-C5)                                 | T1       |
| `lib/payments/plans.ts` with `findPlanByPriceId` (H-C6)                                                           | T2       |
| `STRIPE_PRICE_ID_SUB_*` in lib/env.ts                                                                             | T2       |
| Portal route IDOR-safe — never accept customer from body (H-S6)                                                   | T3       |
| Checkout branches `pack_id` vs `plan_id`; subscription mode; ensure customer                                      | T4       |
| `checkout.session.completed` subscription mode: upsert sub, don't grant, bind customer (H-C4)                     | T5       |
| `customer.subscription.created/updated` upsert                                                                    | T5       |
| `invoice.paid` — `grant_monthly_credits` with allotment from `findPlanByPriceId` (H-C6), skip if canceled (H-S12) | T5       |
| `customer.subscription.deleted` — zero monthly_credits                                                            | T5       |
| `invoice.payment_failed` — past_due                                                                               | T5       |
| `charge.refunded/dispute` — `claw_back_credits`                                                                   | T5       |
| Unhandled events: Sentry breadcrumb not silent (H-O3)                                                             | T5       |
| `Sentry.captureException` before 500 returns (H-O3)                                                               | T3,T4,T5 |
| `SubscriptionClient` — plan badge + manage portal button                                                          | T6       |
| `page.tsx` — subscription row loaded, KIMP-gate both subscription + packs UI                                      | T6       |
| Types regenerated; portal in vercel.json                                                                          | T7       |
