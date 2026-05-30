# Studio Redesign Spec — `/me/studio`

Date: 2026-05-30 · Branch: `redteam-fixes-and-pending-work` · Owner: Balajip06

## Goal

Cut friction on the authed home page: tap trend → upload appears inline (drawer), no scroll, no double-CTA, real sample art on each card, live quota chip in header.

## Locked Decisions (from Phase 0)

1. **Direction A — Inline drawer.** Bottom-sheet on mobile, side-drawer on `md+`. Radix `Dialog` (already shadcn'd in `components/ui/dialog.tsx`).
2. **Thumb art:** wire `trend.sample_after_url` (fallback `thumbnail_url`, then gradient). No before/after hover this pass.
3. **Search / category chips:** deferred. 15 trends fit one screen.

## Source-of-Truth Findings (from recon agents)

### Flow

- `StudioPage` is RSC + `force-dynamic` → every `?trend=` click triggers `loading.tsx` flash. **Switch selection to client state** (`useSearchParams` + `router.replace` shallow URL update) to kill the flash. Keep the URL contract so `/login?next=/me/studio?trend=foo` and `/trend/[slug]` redirect still work.
- `TrendRunner` is `'use client'` already. Owns submitting + upsell state. On success it `router.push('/result/<id>')` — so the drawer closes on navigation anyway. No drawer-close logic needed on success.
- `TrendRunner` accepts `freeUsedThisWeek?: number` (default 5). Currently the studio page **never fetches it**, so `QuotaUpsellModal` always shows the default. Real fix: query `profiles.free_used_this_week` + `credits_balance` server-side and pass down.
- No realtime / push in studio tree. All result-side. Untouched by this redesign.

### URL contract (preserve)

| Site | File:line | Behavior |
|------|-----------|----------|
| Studio page | `app/(app)/me/studio/page.tsx:34` | Reads `?trend=` → selects |
| Grid card | `components/trends/TrendRail.tsx:48` | Links to `?trend=<slug>#upload` |
| Login redirect | `components/trends/TrendRunner.tsx:61` | `/login?next=/me/studio?trend=<slug>` |
| Public trend page | `app/(public)/trend/[slug]/page.tsx:80` | `redirect('/me/studio?trend=<slug>')` |
| E2E baselines | `e2e/visual-baseline.spec.ts:23`, `e2e/a11y.spec.ts:18` | `?trend=ghibli-portrait` |

→ Keep `?trend=` as the contract. Drop the `#upload` hash (drawer replaces scroll).

### A11y requirements

- Radix `Dialog` gives focus trap + esc + scroll-lock + `aria-modal` for free. Use it.
- Restore focus to the trigger thumb on close (Radix does this by default).
- **Close button ≥44×44 on mobile** (touch target SC 2.5.8).
- **`prefers-reduced-motion`**: existing `animate-in`/`animate-out` in `dialog.tsx` already respects it via tailwindcss-animate.
- Quota chip warning state: icon + text + color (not color alone) per SC 1.4.1. Use `sr-only` "Free generations used:" prefix. `aria-live="polite"` if it can update without page nav (it can't today — generations exit to /result — so static is fine).
- Fix `aria-current="true"` → `aria-current="page"` on selected card.
- Verify focus ring contrast: drop the `/60` alpha on `ring-ring` (becomes `ring-ring`).
- `<Image alt="">` stays — visible title in same `<Link>` provides the accessible name.

### Tests touching this surface

- `e2e/visual-baseline.spec.ts:23` → re-baseline after change.
- `e2e/a11y.spec.ts:18` → must stay green.
- `e2e/happy-path.spec.ts:36` → checks "Pick a trend" heading + empty state. The heading text we keep; the empty state goes away — **update assertion** (replace empty-state check with: drawer-not-open + first card present).
- No unit tests on `TrendRail` / `TrendRunner` exist yet. Add Vitest coverage for new `TrendGrid` + `QuotaChip` + `TrendDrawer` open/close.

## Component Diff

| Action | File | Notes |
|--------|------|-------|
| **Delete** | `components/trends/TrendStudioEmpty.tsx` | Empty CTA collapses into header |
| **Rename + rewrite** | `TrendRail.tsx` → `TrendGrid.tsx` | Client component, button (not Link), real sample image, opens drawer |
| **New** | `components/trends/TrendDrawer.tsx` | Radix Dialog wrapper; mobile bottom-sheet via Tailwind responsive variants; embeds `<TrendRunner>` |
| **New** | `components/trends/QuotaChip.tsx` | "3 of 5 free this week" or "42 credits". Color + icon + sr-only label |
| **Edit** | `app/(app)/me/studio/page.tsx` | Fetch quota profile, drop empty branch, render `<TrendGrid trends quota>`; drawer is owned by grid |
| **Edit** | `app/(app)/me/studio/loading.tsx` | Skeleton matches new grid; no upload-shape ghost |
| **Edit** | `e2e/happy-path.spec.ts` | Remove "Pick a trend above" assertion |

URL behavior:
- Initial load with `?trend=<slug>` → drawer **opens on mount** (no scroll, no flash).
- Click thumb → client-side `router.replace('?trend=<slug>', { scroll: false })` + drawer opens. No RSC reload.
- Close drawer → `router.replace('/me/studio', { scroll: false })` strip the param.

## New Component Contracts

### `<TrendGrid>`

```ts
interface TrendGridProps {
  trends: PublicTrend[]
  freeUsedThisWeek: number
  creditsBalance: number
  initialSlug: string | null   // from server, drives initial drawer state
}
```

Behavior:
- `'use client'`. Owns drawer open state derived from `useSearchParams().get('trend')`.
- Renders thumbnails as `<button>` (not `<Link>`) — opens drawer, no navigation.
- Image priority: `sample_after_url ?? thumbnail_url ?? gradient`.
- `aria-current="page"` on selected.

### `<TrendDrawer>`

```ts
interface TrendDrawerProps {
  trend: PublicTrend | null
  freeUsedThisWeek: number
  open: boolean
  onOpenChange: (open: boolean) => void
}
```

Behavior:
- Wraps Radix `<Dialog>`. On `md` and up: side-drawer right, 480px wide. On mobile: bottom-sheet, 92vh max, rounded top.
- Renders `<TrendRunner trend freeUsedThisWeek>` inside.
- Heading is `trend.title`, sub is `trend.description`.
- Close button top-right, 44×44 hit area.

### `<QuotaChip>`

```ts
interface QuotaChipProps {
  freeUsedThisWeek: number   // 0..5
  creditsBalance: number
}
```

Render rules:
- `credits > 0` → "✨ {credits} credits" (primary tone).
- else if `free < 5` → "{5-free} free left this week" (muted tone).
- else → "Out of free • Upgrade" (warning: icon + text + warning bg). Click → open `QuotaUpsellModal`.
- sr-only prefix "Free generations:".

## Quota Query

Add in `StudioPage` (mirroring `app/(app)/me/settings/page.tsx:56-66`):

```ts
const { data: profile } = await supabase
  .from('profiles')
  .select('free_used_this_week, credits_balance')
  .eq('id', user.id)
  .maybeSingle()
```

`MOCK_TRENDS=true` path: read from `lib/dev/mock-data.ts` constants (already set: `free_used_this_week: 2`, `credits_balance: 42`).

## Analytics

Add 2 events to `lib/analytics/client.ts` EVENTS map:

- `studio_thumb_clicked` `{ trend_slug }` — fired when grid card opens drawer.
- `studio_drawer_dismissed` `{ trend_slug, had_files: boolean }` — fired when drawer closes without submit.

Keep existing `upload_started` / `generate_clicked` / `generate_failed` unchanged.

## Verification Gate

Local: `pnpm typecheck && pnpm lint && pnpm test && pnpm build` must be green.

E2E:
- `e2e/happy-path.spec.ts` — open studio, click first card, drawer shows trend title, close drawer, URL clean.
- `e2e/a11y.spec.ts` — axe sweep with drawer open AND closed.
- `e2e/visual-baseline.spec.ts` — regenerate baseline PNGs (drawer open + closed × mobile/desktop).

Manual: screenshots @ 390 / 768 / 1440 before vs after, attach to PR.

## Out of Scope (next pass)

- Search / category filter (defer; add when >30 trends).
- Before/after hover reveal on thumbs (needs `sample_before_url` populated everywhere).
- Recently-used row at top of grid.
- Keyboard arrow-key roving tabindex (a11y agent confirmed not required for link/button grid).
- Realtime quota refresh on drawer close (would need supabase channel — out of scope; chip only updates on page reload, acceptable until first generation completes which already redirects to /result).
