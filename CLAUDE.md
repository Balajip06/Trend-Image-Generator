# Trend Image Generator — Project Instructions

Viral-trend image generator. Next.js 16 + Supabase + Gemini Nano Banana. Consumer-facing, IG + TikTok distribution.

---

## Current state (2026-05-29)

- **Branch:** `main` (renamed from `master` post-bootstrap)
- **Remote:** `origin` → https://github.com/Balajip06/Trend-Image-Generator
- **HEAD:** `2f59467` perf: dev-only /styleguide no longer ships its body to prod
- **Total commits on `origin/main`:** 86
- **Routes (`pnpm build`):** 30 — consumer (`/`, `/trend/[slug]`, `/result/[id]`, `/me/{creations,settings}`, `/login`), admin (`/admin/{trends,trends/[id]/{edit,eval},suggestions,audit}`), public legal (`/terms`, `/privacy`), dev-only (`/styleguide` — prod-stripped via `notFound()` + dynamic-import), 9 API routes, sitemap + robots + auth callback
- **Test gate:** Vitest 31 files / 283 tests — 278 passing, 5 failing in `app/(app)/result/[id]/ShareBurst.test.tsx` (regression introduced post-redesign; not yet triaged)
- **Static gates:** `pnpm typecheck` clean, `pnpm lint` clean, `pnpm build` clean (18 static + 12 dynamic)
- **MOCK_TRENDS=true** still toggleable for screenshot work; production never sets it (proxy.ts + repository.ts short-circuit auth + data when on)
- **Phase status:** 0 ✅ resolved, 1 ✅ except blocked-on-creds items, 2 ✅ shipped (admin CRUD + eval workflow + SSR trend pages + sitemap/robots), 3 ✅ shipped (Edge Function + Realtime + push/email fallback), 4 ✅ shipped (watermark + share + referrals + history + data export + branded OG), 5 prep ✅ + checkout UI ✅ (blocked on Stripe creds), 6 prep ✅ + approve/reject ✅ (blocked on real proposer + sources)
- **Outstanding work:** see [.claude/todo.md](.claude/todo.md) "Post-redesign hygiene" + the un-checked items per phase

---

## SESSION START PROTOCOL (read in this order, every new session)

1. **[.claude/todo.md](.claude/todo.md)** — current phase + active task + open checkboxes
2. **[.claude/lessons.md](.claude/lessons.md)** — corrections + patterns learned
3. **[.claude/session-log.md](.claude/session-log.md)** — last session's outcome
4. **[../../.claude/plans/check-this-plan-c-users-balaj-projects-t-luminous-prism.md](../../.claude/plans/check-this-plan-c-users-balaj-projects-t-luminous-prism.md)** — amended plan (AUTHORITATIVE)
5. **[trend-image-app-plan.md](trend-image-app-plan.md)** — original plan (superseded by amended where they conflict)

If any of these missing → stop, ask before proceeding.

---

## Source-of-Truth Documents

- **Amended plan** (above) — locked decisions, data model, RLS, phases, verification gates
- **Original plan** — keep for diff context
- `.claude/todo.md` — execution state
- `.claude/lessons.md` — what NOT to repeat
- [docs/TERMS_OF_SERVICE.md](docs/TERMS_OF_SERVICE.md) — draft ToS. §3 (personal-use only) + §4 (style references + takedown protocol) are load-bearing for franchise-IP risk in trend prompts. Wire into a public `/terms` page before launch.
- [docs/RUNBOOK.md](docs/RUNBOOK.md) — 14-test verification matrix for the day creds arrive
- [docs/CREDENTIALS.md](docs/CREDENTIALS.md) — per-service env var reference

The amended plan overrides the original on: credit packs (not subscription), schema-driven inputs, 30d free / forever Pro storage, SSR SEO + JSON-LD + sitemap, eval workflow, push notifications, referral farming guard, GDPR soft-delete.

**Post-audit reversals (plan §Decision Reversals):**
- **Sentry day-1** (was PostHog only)
- **Anonymous 1-try trial** (was login-wall day-1) — fingerprint + Turnstile + abuse budget
- **Free tier: 5/week refill** (was 10 lifetime + share bonus)
- **Test stack:** Vitest unit + Playwright E2E (primary) + agent-browser nightly smoke (supplemental)

---

## Tech Stack (locked)

- **Frontend:** Next.js 16.2.6 App Router (Turbopack default), React 19.2.4, TypeScript 5.9, Tailwind v4 (CSS-first, no config file), shadcn/ui (14 primitives ejected into `components/ui/`)
- **Backend:** Supabase (Postgres + Auth + Storage + Realtime + Edge Functions + pg_cron)
- **AI:** Google Gemini — Nano Banana Pro default, v1 quick toggle, per-trend model override
- **Payments:** Stripe Checkout, USD, one-time credit packs
- **Email:** Resend (transactional + push fallback)
- **Push:** Web Push (VAPID), iOS via PWA install
- **Anti-bot:** Cloudflare Turnstile on signup
- **Observability:** PostHog (product analytics) + Sentry (errors + perf)
- **Testing:** Vitest (unit) + Playwright (E2E, chromium+webkit) + agent-browser (nightly smoke)
- **SEO:** SSR trend pages, `@vercel/og`, JSON-LD `HowTo`, sitemap.xml

---

## Non-Negotiables

1. **RLS-enforced quota** — `free_used_this_week >= 5 AND credits_balance <= 0` blocks `generations` INSERT at DB layer. pg_cron resets weekly (Sunday 00:00 UTC). Never bypass.
2. **Idempotency** — `/api/generate` accepts `Idempotency-Key`. Duplicate POST = 1 Gemini call, 1 row.
3. **Trust Gemini safety** — no custom pre-gen moderation. Refund quota on rejection.
4. **Schema-driven inputs** — `trends.input_schema jsonb`; forms render dynamic. Never hardcode "1 photo".
5. **Eval gate** — `is_active=true` requires `eval_status='passed'`. DB constraint enforces.
6. **Cost tracking** — every `generations` row records `cost_usd`.
7. **Soft-delete + audit log** — `profiles.deleted_at` cascades; admin actions write `admin_audit_log` via trigger, not client.
8. **Watermark on free-tier downloads** — server-side composer; Pro removes.
9. **Stripe webhook idempotency** — `webhook_events.event_id` unique constraint.
10. **Per-IP rate limit** — 20 gen attempts/hr/IP at Edge (Upstash Redis or in-memory LRU).
11. **Anonymous trial** — exactly 1 attempt per fingerprint+IP lifetime. Global daily abuse budget $20/day; on breach anonymous auto-disables until next day.
12. **Test gate** — Vitest + Playwright must pass; Phase verification checkboxes need green CI before `[x]`.

---

## Workflow

### Plan First
- Enter plan mode for non-trivial task (3+ steps or architectural).
- If something goes sideways → STOP, re-plan, update `.claude/todo.md`.
- Use plan mode for verification, not just building.

### Karpathy Guardrails (auto-skill `karpathy-guidelines`)
1. Think before coding — state assumptions, surface alternates, stop if unclear
2. Simplicity first — minimum code, no speculative abstractions
3. Surgical changes — every line traces to request; don't refactor adjacent
4. Goal-driven — task → verifiable goal → loop until verified

### Subagents
- Offload research, exploration, parallel analysis
- One task per subagent

### Verification
- Never mark `[x]` in `.claude/todo.md` without proof: tests pass, logs clean, behavior demonstrated
- Diff vs main when relevant
- 12-test verification matrix in amended plan §"Verification" must pass before MVP ship

### Autonomous Bug Fixing
- Given bug report → fix it. No hand-holding requests.
- Failing CI → fix without being told how.

### Demand Elegance
- Non-trivial change → ask "is there a more elegant way?"
- Skip for trivial obvious fixes — don't over-engineer.

### Self-Improvement
- ANY user correction → append pattern to `.claude/lessons.md` same turn
- Review `.claude/lessons.md` at session start (Step 2 of Protocol)

---

## Task Management

1. **Plan first** → write to `.claude/todo.md` with checkable items
2. **Verify plan** → check in with user before implementation
3. **Track progress** → mark `[x]` only with proof (see Verification)
4. **Explain changes** → high-level summary per step
5. **Document results** → review section in `.claude/todo.md`
6. **Capture lessons** → update `.claude/lessons.md` after correction
7. **Session log** → append to `.claude/session-log.md` at end of session: date, what done, what next

---

## Active Skills (invoke proactively)

| Skill | When |
|---|---|
| `karpathy-guidelines` | Before non-trivial code |
| `superpowers:brainstorming` | Before new features/components |
| `superpowers:test-driven-development` | New features, bug fixes |
| `superpowers:systematic-debugging` | Any bug/unexpected behavior |
| `superpowers:writing-plans` | Multi-step tasks before code |
| `frontend-design` | Building UI surface |
| `frontend-patterns` | React/Next patterns |
| `nextjs-turbopack` / `vercel:nextjs` | Next 15 App Router |
| `supabase:supabase` | ANY Supabase task |
| `supabase:supabase-postgres-best-practices` | SQL/schema/perf |
| `database-migrations` | Schema changes, RLS, pg_cron |
| `postgres-patterns` | Indexes, triggers, RLS |
| `api-design` | `/api/generate`, webhooks |
| `security-review` | Auth, Stripe, RLS, uploads |
| `seo` | SSR trend page, sitemap, JSON-LD, OG |
| `accessibility` | All UI (WCAG 2.2 AA) |
| `e2e-testing` | Login → generate → share → pay |
| `deployment-patterns` | CI/CD, env vars |
| `vercel:vercel-functions` | Edge Function tail-latency |
| `e2e-testing` (Playwright) | E2E test authoring + flake quarantine |
| `vercel:env-vars` | Secrets |
| `tdd-workflow` | RED→GREEN→REFACTOR |
| `cost-aware-llm-pipeline` | Gemini cost + alerts |
| `content-hash-cache-pattern` | Image-hash caching |

---

## Available Agents (delegate proactively)

`planner`, `architect`, `tdd-guide`, `code-reviewer`, `security-reviewer`, `database-reviewer`, `typescript-reviewer`, `build-error-resolver`, `e2e-runner`, `refactor-cleaner`, `doc-updater`, `performance-optimizer`, `seo-specialist`.

**Mandatory:**
- `code-reviewer` immediately after writing/modifying code
- `security-reviewer` before commit if touching auth/payments/RLS
- `database-reviewer` for migrations + RLS

---

## Folder Structure (per amended plan §4)

```
/app
  /(public)/trend/[slug]     SSR + SEO
  /(public)/sitemap.ts
  /(public)/robots.ts
  /(app)/result/[id]
  /(app)/me/creations
  /admin
    /trends/[id]/eval        eval grid
    /suggestions             auto/user inbox
    /audit                   audit log viewer
  /api
    /generate                idempotent + RLS
    /stripe/webhook          dedup via webhook_events
    /push/subscribe
/lib
  /supabase                  client + server + generated types
  /gemini                    timeout + retry + cost + interpolation
  /push                      VAPID send
  /seo                       OG + JSON-LD
  /referrals                 reward + farming guard
  /eval                      trend test runner
  /utils
/components
  /admin/SchemaBuilder.tsx   dynamic schema editor
  /upload/SchemaForm.tsx     render form from schema
docs/                        Design docs, ADRs
.claude/
  todo.md                    Phase/task tracker
  lessons.md                 Correction log
  session-log.md             Per-session journal
  docs/pr-review/            PR review notes
```

---

## Build Phases (per amended plan §6)

State persisted in [.claude/todo.md](.claude/todo.md). Phase summary:

1. **Foundation (3–4d)** — Supabase + Next.js + auth + schema + RLS + Stripe test mode + admin gating + audit trigger
2. **Trends + Admin (3–4d)** — schema-driven CRUD + eval + SSR trend pages + sitemap/robots
3. **Core Generation (4–5d)** — schema form + idempotent `/api/generate` + Edge Function + Realtime + retry + refund + push + email fallback
4. **Virality + Polish (3d)** — watermark + Web Share + referrals + history + soft-delete + export + PostHog + pg_cron purge
5. **Payments (post-traction)** — Stripe Checkout + webhook idempotency
6. **Auto trend detector (post-MVP)** — TikTok/IG/Reddit poller + LLM proposer + admin inbox

MVP target: **~14–16 days solo**.

---

## Commands

```bash
pnpm install
pnpm dev                  # next dev (Turbopack)
pnpm build                # next build — emits 30-route table
pnpm analyze              # cross-env ANALYZE=true next build → bundle report
pnpm typecheck            # tsc --noEmit
pnpm lint / pnpm lint:fix # eslint 9 flat config
pnpm format / pnpm format:check
pnpm test                 # vitest run (currently 278/283; ShareBurst suite has 5 reds)
pnpm test:watch
pnpm test:e2e             # playwright (chromium / webkit / mobile-chrome / mobile-safari)
pnpm test:e2e:visual      # RUN_VISUAL_BASELINE=true → 40-PNG sweep
pnpm supabase:start       # local stack (needs Docker)
pnpm supabase:reset       # apply migrations + seed locally
pnpm supabase:types       # regenerate lib/supabase/database.types.ts from live schema
pnpm supabase:diff        # detect drift between local DB and migrations
```

Full ship runbook (per-credential onboarding + 14-test verification matrix): [docs/RUNBOOK.md](docs/RUNBOOK.md). Per-var reference: [docs/CREDENTIALS.md](docs/CREDENTIALS.md).

---

## Environment Variables

Authoritative source: [`lib/env.ts`](lib/env.ts) (Zod `ServerEnvSchema`). What follows mirrors that file as of commit `9e439d8`.

**Required (Zod throws at first `getServerEnv()` if missing):**
- `NEXT_PUBLIC_SITE_URL` — canonical site URL; used by OG, Stripe success/cancel, push click-through, sitemap base
- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (renamed from `SUPABASE_ANON_KEY` per commit `5bb647d`), `SUPABASE_SERVICE_ROLE_KEY`

**Optional (call sites degrade gracefully — see CREDENTIALS.md for the "what breaks if missing" matrix):**
- `GEMINI_API_KEY` (mock-mode fallback)
- Stripe: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`, `STRIPE_PRICE_ID_SMALL` / `_MEDIUM` / `_LARGE`
- Resend: `RESEND_API_KEY`, `RESEND_FROM_EMAIL` (`.email()` enforced)
- VAPID: `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (`^mailto:` regex)
- Turnstile: `NEXT_PUBLIC_TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY`
- PostHog: `NEXT_PUBLIC_POSTHOG_KEY`, `NEXT_PUBLIC_POSTHOG_HOST`
- Sentry: `SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_DSN`, `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT`
- Upstash: `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`
- Anonymous budget: `ANONYMOUS_DAILY_BUDGET_USD` (coerced number, default `20`)
- Phase 6 sources (post-MVP): `TIKTOK_CREATIVE_CENTER_KEY`, `INSTAGRAM_SESSION_COOKIE`, `REDDIT_USER_AGENT`

**Dev-only:**
- `MOCK_TRENDS` (string enum `'true' | 'false'`) — short-circuits Supabase reads with `lib/dev/mock-data.ts`; proxy.ts + `lib/supabase/middleware.ts` also bypass auth gates. Never set in prod.

---

## Gotchas

_(append as discovered)_

- Two CLAUDE.md files exist: this project file + user global (`c:\Users\balaj\CLAUDE.md`). Project overrides on conflict.
- Amended plan supersedes original — don't blend them.
- Karpathy skill ships only `karpathy-guidelines` (already global). Don't re-clone repo.
- **Next 16 not 15** — Tailwind v4 (CSS-first, `@import "tailwindcss"` in globals.css; no `tailwind.config.ts`), React 19.2, Turbopack default. Watch for v15-era StackOverflow advice.
- **Folder name has caps + space** — `create-next-app` rejects it, so the scaffold was done in `scaffold-tmp/` then merged up. Future scaffolds (Storybook, etc.) need same workaround.
- **`supabase` CLI** is a devDep (v2.101). Invoke as `pnpm supabase ...` not bare `supabase`.
- **pnpm virtual store** is path-sensitive — if you ever move the project folder, run `rm -rf node_modules pnpm-lock.yaml && pnpm install` to relink.
- **`api/stripe/webhook`** is excluded from Supabase middleware (raw-body handling).
- **Next 16: `middleware.ts` → `proxy.ts`** + exported function renamed `middleware` → `proxy`. Old name builds with deprecation warning; new name is the convention. Helper file `lib/supabase/middleware.ts` keeps its name (internal module, only `updateSession` exported).
- **`bg-gradient-*` custom utility names collide with tailwind-merge.** Lightning CSS dropped `.bg-gradient-hero` at runtime when combined with `shadow-glow-pink`. Fix: brand-prefixed utilities (`.brand-grad`, `.brand-glow`) avoid the twMerge group conflict (commit `7819e2f`; see lessons.md 2026-05-28).
- **`window.location.origin` in client components → SSR hydration mismatch.** Use `process.env.NEXT_PUBLIC_SITE_URL` for URLs rendered during SSR; only touch `window` inside `useEffect` (commit `7819e2f`).
- **Eval gate trigger fires on prompt edits.** Any UPDATE to `public.trends.prompt_template` flips `eval_status='untested'` + `is_active=false` (migration 0002). Don't bundle prompt edits with `is_active=true` resets — route through `/admin/trends/[id]/eval` once Gemini key is wired. One-time SQL bypass logged in lessons.md 2026-05-29.
- **Database stub forces `as never` casts on insert/update** until `pnpm supabase:types` runs against the live DB and writes concrete `Database` types. Most casts were removed in commit `7783e22` once strict types landed.
- **`/styleguide` ships its body to prod even with runtime `notFound()`** — `notFound()` only runs at request time; the module imports still bundle. Use `next/dynamic` to keep dev-only bodies out of prod bundles (commit `2f59467`, lessons.md 2026-05-29).
- **Audit log surfaces actor emails by design.** `app/admin/audit/page.tsx` resolves admin emails via service-role and renders them — intentional (attribution is the point of the trail). If lower-role tiers are added later, tier the join, don't anonymize (lessons.md 2026-05-29).
- **FlashToasts API takes strings, not functions.** RSC serialization rejects function-style messages — pass already-resolved strings through `?flash=` query params (commit `370adb6`).
- **Empty admin FAQ + input_schema fields previously broke trend create/update** — fixed in commit `9980ff2`. If admin form regression appears, check the optional-vs-required branch in `app/admin/trends/actions.ts`.

---

## Conventions

- Immutability — return new objects, never mutate
- Files ≤ 800 lines, functions ≤ 50, nesting ≤ 4
- TS strict; generated Supabase types
- 80%+ test coverage
- Conventional commits (`feat:`, `fix:`, `refactor:`, etc.)
- No hardcoded secrets — env vars only
- HEIC → JPEG client-side before upload (heic2any)
- Client compress to 2048px before upload
- Design docs → `docs/`; PR review notes → `.claude/docs/pr-review/`

---

## Pre-Build Checklist (status as of 2026-05-29)

Shipped from the codebase side:
- ToS draft (`docs/TERMS_OF_SERVICE.md`) + Privacy draft (`docs/PRIVACY_POLICY.md`) + public `/terms` and `/privacy` routes (commits `1be0727`, `6622794`)
- 15 launch trends seeded with v2 prompts (commits `2ef4af8`, `1803428`, `0857b21`); FAQ + reference photos still pending real eval runs (need Gemini key)
- Credit-pack pricing decided: $4.99=50 / $14.99=200 / $39.99=600 (`lib/payments/packs.ts`)
- Checkout UI on `/me/settings` (`CreditPacksClient`, commit `e29462a`)

Still user-side (creds not yet in `.env.local`):
- Gemini API access + Nano Banana Pro pricing + region confirmed
- Stripe production app submitted; test-mode price IDs paste into `STRIPE_PRICE_ID_*`
- Resend domain DKIM/SPF/DMARC verified
- VAPID key pair generated (kept forever — rotating breaks subscriptions)
- Cloudflare Turnstile site keys (localhost + production)
- Domain registered + Cloudflare DNS
- Upstash Redis (or commit to in-memory LRU for v1)
- PostHog project + Sentry DSN
- Run the 14-test verification matrix in [`docs/RUNBOOK.md`](docs/RUNBOOK.md) once creds are wired.

## Verification (must pass before MVP ship)

14-test verification matrix lives in [`docs/RUNBOOK.md`](docs/RUNBOOK.md) §3. Covers RLS quota block + decrement, `/api/generate` idempotency replay, Edge Function retry path, refund-on-safety, schema-driven form, eval gate constraint, push + email fallback, SSR HTML completeness, pg_cron purges, referral farming guard, Stripe webhook dedup, GDPR delete cascade, PostHog funnel. Local sanity loop (`pnpm typecheck && pnpm lint && pnpm test && pnpm build`) must be green before running the cred-dependent matrix.
