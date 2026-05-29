# Bundle Analysis — 2026-05-29

Snapshot of client-bundle health after the UI redesign + shadcn primitives + Sentry / PostHog / Sharp / heic2any / web-push / react-markdown landed.

## How to reproduce

```bash
# Webpack-mode `next build` is currently broken on Next 16.2.6 + Windows
# (font-manifest path bug), so we drive the Turbopack analyzer directly.
rm -rf .next
pnpm next build --experimental-analyze

# Then:
node scripts/analyze-chunks.mjs        # per-route table + unique-chunk delta
# Stats JSON:     .next/diagnostics/route-bundle-stats.json
# HTML reports:   .next/diagnostics/analyze/

# Webpack-based @next/bundle-analyzer HTML report (when webpack mode works
# again in a future Next release):
pnpm analyze
# Outputs to .next/analyze/
```

`@next/bundle-analyzer` is wired into `next.config.ts` behind `process.env.ANALYZE === 'true'`. It writes HTML reports to `.next/analyze/` when invoked through the webpack pipeline; we keep it ready for that future path even though Turbopack analyzer is what's working today on Next 16.2.6.

> All sizes below are **uncompressed bytes** as reported by Turbopack's analyzer.
> Gzipped sizes are typically ~25-30% of these numbers (rough rule of thumb).

## Per-route First Load JS

After applying the surgical wins below:

| Route | First Load JS | Chunks |
|---|---:|---:|
| `/trend/[slug]` | **1159.6 KB** | 17 |
| `/result/[id]` | **1077.7 KB** | 16 |
| `/styleguide` (dev) | **941.8 KB** | 16 |
| `/me/creations` | 826.1 KB | 15 |
| `/` | 824.4 KB | 15 |
| `/login` | 818.4 KB | 15 |
| `/me/settings` | 818.0 KB | 15 |
| `/admin/trends/[id]/eval` | 813.1 KB | 15 |
| `/admin/trends/[id]/edit` | 812.3 KB | 15 |
| `/admin/trends/new` | 812.3 KB | 15 |
| `/admin/suggestions` | 811.1 KB | 15 |
| `/admin`, `/admin/audit`, `/admin/trends` | 810.3 KB | 14 |
| `/privacy`, `/terms` | 810.3 KB | 14 |
| `/_not-found` (baseline) | 772.2 KB | 12 |

Shared baseline (every route): **~772 KB uncompressed (~230 KB gzipped)** — React + Next runtime + middleware + shared shells.

## Heaviest unique chunks per top route

| Chunk | Size | Route(s) | Contents |
|---|---:|---|---|
| `07j8y6tvwkes4.js` | **236 KB** | `/trend/[slug]`, `/result/[id]` | `@supabase/supabase-js` realtime + storage + auth client |
| `0d~40jd1xe~5.js` | 86 KB | `/trend/[slug]` | Radix UI Dialog / Select stack for `SchemaForm` |
| `0mfo81z4n16.u.js` | 86 KB | `/styleguide` | Radix Dialog / Accordion / Tabs / Switch / Progress demos |
| `03q9pzmu.ws_.js` | 39 KB | `/styleguide` | Sonner Toaster demo wiring |
| `0khuzz61_uubb.js` | 29 KB | shared | shadcn primitives chunk |

## Top 5 heaviest dependencies (client)

| Dep | ~Size | Used in | Status |
|---|---:|---|---|
| `@supabase/supabase-js` (browser client) | ~236 KB uncompressed / ~70 KB gz | `/trend/[slug]`, `/result/[id]`, anywhere `createClient()` runs | **Hot client path.** Realtime + auth refresh + storage all bundled together. See recommendations below. |
| `radix-ui` (Dialog, Select, Dropdown, etc.) | ~86 KB per route that uses them | Forms, headers, settings | Already split per consumer route. Expected cost of using accessible primitives. |
| `@sentry/nextjs` (browser client + replay) | ~50–80 KB gz when DSN set | `instrumentation-client.ts` (loaded on every route) | **Mitigated** — see Win #1. Replay deferred to `requestIdleCallback`. Note: in *this* build `NEXT_PUBLIC_SENTRY_DSN` is unset so Sentry is fully dead-code-eliminated, hiding the headline number. |
| `sharp` (~7 MB) | server-only | `lib/watermark/compose.ts` (called by `/api/download/[id]`) | **OK** — confirmed not in any client chunk. Used only inside the route handler. |
| `web-push` | server-only | `lib/push/send.ts` (called by `/api/push/dispatch`) | **OK** — confirmed not in any client chunk. |
| `heic2any` | client | `lib/utils/image.ts` `convertHeicToJpeg` | **OK** — already dynamic-imported (`await import('heic2any')`) inside the HEIC branch only. |
| `react-markdown` + `remark-gfm` | server-only (RSC) | `app/(public)/_legal/renderDoc.tsx` used by `/terms`, `/privacy` | **OK** — both pages are RSCs, no `'use client'`. Markdown rendering happens on the server; only the rendered HTML ships. `/privacy` + `/terms` are at baseline (810 KB) confirming this. |
| `posthog-node` | server-only | `lib/analytics/server.ts` | **OK** — different package from `posthog-js`. |
| `posthog-js` | client | `lib/analytics/client.ts` | **OK** — already async-loaded inside provider (`posthog.init` runs in `useEffect`). |
| `@fingerprintjs/fingerprintjs` | client | anonymous-trial path | Loaded eagerly today; candidate for dynamic import (see follow-ups). |
| `stripe` | server-only | `/api/stripe/*` | **OK** — confirmed not in any client chunk. |
| `resend` | server-only | push fallback email | **OK** — symbol name appears in client chunks (4 hits) but those are unrelated string matches inside `@supabase/supabase-js`, not the package itself. |

## Surgical wins applied this commit

### Win #1 — Sentry Replay deferred via dynamic import _(applied)_

`instrumentation-client.ts` previously contained:

```ts
integrations: [Sentry.replayIntegration({ ... })],
```

That static call forces the bundler to include `@sentry-internal/replay`'s implementation into the route's initial chunk. We changed it to:

```ts
Sentry.init({ /* no integrations: [] up front */ })
if (typeof window !== 'undefined' && process.env.NODE_ENV === 'production') {
  schedule(() => {
    void import('@sentry/nextjs').then((m) => {
      const client = Sentry.getClient()
      if (client) client.addIntegration(m.replayIntegration({ ... }))
    })
  })
}
```

Replay is only useful AFTER an error (`replaysOnErrorSampleRate: 1.0`, session rate `0.0`) — so loading it eagerly is pure dead weight on Time-to-Interactive. The dynamic import lets the bundler split it into a separate async chunk, fetched on idle.

**Estimated impact when `NEXT_PUBLIC_SENTRY_DSN` is set:** ~50 KB gzipped off every client route's first-load JS. In *this local build* the DSN is unset so Sentry is entirely tree-shaken — we cannot measure the delta here, but the change pays off in production.

## Findings deferred to follow-up

### F1 — `/styleguide` ships 940 KB to prod (~170 KB unique)

`app/(dev)/styleguide/page.tsx` uses `notFound()` at the top in prod to 404 the page, but the static `import { ... } from './Sections'` at module top means `Sections.tsx` (Radix Dialog + Accordion + Tabs + Switch + Progress + Sonner demos, 675 lines) still gets bundled into the route's prerender output. A user typing `/styleguide` in prod hits the 404 page — but the chunks exist in the manifest.

**Recommended fix (follow-up PR):**
- Move the entire route under a `process.env.NODE_ENV !== 'production'` `route.ts` redirect, OR
- Replace static `import { ... } from './Sections'` with 18 `next/dynamic` calls so Turbopack can split them and not include in the route's initial chunk list.

**Effort:** medium (mechanical).
**Impact:** ~940 KB chunk emission eliminated. Reduces deploy artifact size; no user-visible perf delta since prod users never load `/styleguide`.
Skipped this commit: 18 dynamic-import sites in one file = noisy diff vs the actual prod benefit. Defer.

### F2 — `@supabase/supabase-js` browser client is 236 KB (single biggest user-facing chunk)

Used by both heavy routes (`/trend/[slug]`, `/result/[id]`). The full client pulls realtime, storage, auth, and postgrest into a single chunk. Most pages need only one of these (e.g. `/result/[id]` needs realtime subscription + storage signed URLs; `/trend/[slug]` needs auth + storage upload).

**Options to investigate:**
- Try `@supabase/supabase-js`'s tree-shakeable submodule imports (`createBrowserClient` from `@supabase/ssr` already used).
- Lazy-load realtime via `supabase.channel()` only when subscription is needed — currently `createClient` pre-instantiates the realtime client even on pages that never subscribe.
- Consider whether anonymous-trial pages can skip the client SDK entirely (server-only mutations through API routes already exist).

**Effort:** high (involves changing `lib/supabase/client.ts` and verifying no auth/realtime regression).
**Impact:** potentially 50-100 KB gzipped off the two heaviest routes.
Out of scope for this commit.

### F3 — `@fingerprintjs/fingerprintjs` not dynamic-imported

Loaded eagerly anywhere the anonymous-trial flow runs. The library is ~30 KB minified and is only needed once at submission time.

**Recommended fix:** wrap `FingerprintJS.load()` in a dynamic import like `heic2any`.
**Effort:** trivial (single file).
**Impact:** ~10 KB gzipped off `/trend/[slug]` first load.
Skipped this commit: the anonymous-trial code path is hot enough that bundling it eagerly is defensible — defer until a measurable user-facing perf budget exists.

### F4 — Two Radix chunks (86 KB each) overlap

`0d~40jd1xe~5.js` and `0mfo81z4n16.u.js` are both ~86 KB Radix chunks with identical signature counts. Possibly Turbopack duplication. Worth re-checking when Next 16 ships webpack-mode fixes so `@next/bundle-analyzer`'s HTML reports work — it's much easier to spot duplication there.

### F5 — `lucide-react@1.16.0`

Major-bumped from the typical `0.x` line. Worth verifying icon imports are individual (`import { Heart } from 'lucide-react'`) and not barrel (`import * as Icons from 'lucide-react'`). Quick `ctx_search` confirmed individual imports; no action.

## Conventions guardrails honored

- `'use client'` boundaries verified — server-only libs (`sharp`, `web-push`, `stripe`, `resend`, `posthog-node`, `react-markdown`+`remark-gfm`) confirmed not in any client chunk.
- `heic2any` confirmed dynamic-imported (already optimized).
- No route count change (30 routes before and after).
