# Trend Image Generator — Project Instructions

Viral-trend image generator. Next.js 15 + Supabase + Gemini Nano Banana. Consumer-facing, IG + TikTok distribution.

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

The amended plan overrides the original on: credit packs (not subscription), schema-driven inputs, 30d free / forever Pro storage, SSR SEO + JSON-LD + sitemap, eval workflow, push notifications, referral farming guard, GDPR soft-delete.

**Post-audit reversals (plan §Decision Reversals):**
- **Sentry day-1** (was PostHog only)
- **Anonymous 1-try trial** (was login-wall day-1) — fingerprint + Turnstile + abuse budget
- **Free tier: 5/week refill** (was 10 lifetime + share bonus)
- **Test stack:** Vitest unit + Playwright E2E (primary) + agent-browser nightly smoke (supplemental)

---

## Tech Stack (locked)

- **Frontend:** Next.js 16.2 App Router (Turbopack stable), React 19.2, TypeScript 5.9, Tailwind v4 (CSS-first, no config file), shadcn/ui
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

_(populate during Phase 1 init)_

```bash
# TBD after scaffold:
# pnpm install
# pnpm dev
# pnpm build
# pnpm test
# pnpm typecheck
# pnpm lint
# pnpm supabase:reset
# pnpm supabase:types
```

---

## Environment Variables

_(populate during Phase 1)_

`.env.local` will hold:
- `NEXT_PUBLIC_SITE_URL` (canonical site URL — used by `@vercel/og`, Stripe success/cancel URLs, push action URLs)
- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
- `GEMINI_API_KEY`
- `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`
- `RESEND_API_KEY`
- `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`
- `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY`
- `NEXT_PUBLIC_POSTHOG_KEY`, `NEXT_PUBLIC_POSTHOG_HOST`
- `SENTRY_DSN`, `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT`
- `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` (rate limit + abuse budget counter)
- `ANONYMOUS_DAILY_BUDGET_USD` (default `20`)

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

## Pre-Build Checklist (before Phase 1)

See amended plan "Pre-Build Checklist — additions". Highlights: Gemini pricing + region confirmed, Stripe production app started, Resend domain DKIM/SPF/DMARC, VAPID keys, Turnstile keys, ToS/Privacy/AUP drafts, final credit-pack prices, domain + Cloudflare DNS, 5 launch trends with eval photos + FAQ.

## Verification (must pass before MVP ship)

12 end-to-end tests in amended plan §"Verification": RLS quota block, idempotency replay, retry/refund, schema-driven form, eval gate, push + email fallback, SEO HTML correctness, pg_cron purge, referral farming guard, Stripe webhook dedup, GDPR delete, PostHog funnel.
