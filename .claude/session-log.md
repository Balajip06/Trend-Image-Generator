# Session Log

Append at end of each session. Newest on top.

Format:
```
## YYYY-MM-DD — short title
**Done:** what shipped
**Open:** what's parked
**Next:** what to start next session
**Phase:** current phase
**Blockers:** any
```

---

## 2026-05-27 — Phase 1 foundation scaffolded + committed

**Done:**
- Generated VAPID keypair (saved location: user `.env.local` only — example template has empty values for safety)
- Scaffolded Next.js 16.2 via `create-next-app` into `scaffold-tmp/` (folder-caps+space workaround), merged contents to root preserving our CLAUDE.md
- Rewrote `package.json` (name = `trend-image-generator`, scripts: typecheck, format, format:check, test, test:watch, test:ui, test:e2e, supabase:*)
- Installed runtime deps: @supabase/{supabase-js,ssr}, zod, stripe, resend, web-push, @vercel/og, posthog-{js,node}, @sentry/nextjs, @upstash/{ratelimit,redis}, @fingerprintjs/fingerprintjs, heic2any, next-themes, clsx, tailwind-merge, lucide-react, class-variance-authority
- Installed dev deps: vitest + @vitest/ui + @vitejs/plugin-react + jsdom, @testing-library/{react,jest-dom,user-event}, @playwright/test, prettier + prettier-plugin-tailwindcss, @types/web-push, supabase CLI 2.101
- Configs: .prettierrc.json + .prettierignore, vitest.config.ts (80% coverage threshold), vitest.setup.ts (jest-dom matchers), playwright.config.ts (4 projects: chromium/webkit/mobile-chrome/mobile-safari, webServer auto-spawn)
- Supabase init + 5 migrations written and timestamped in `supabase/migrations/`:
  * `20260527000001_profiles.sql` — profiles + auto-create trigger + RLS
  * `20260527000002_trends.sql` — input_schema JSONB + version-bump trigger + eval gate constraint + SEO columns
  * `20260527000003_generations.sql` — idempotency unique, cost tracking, tier-aware purge_at, quota consume/refund triggers, RLS own + public-gallery
  * `20260527000004_ancillary.sql` — referrals + farming-guarded reward trigger, trend_eval_inputs/runs, trend_suggestions, admin_audit_log, webhook_events, anonymous_attempts
  * `20260527000005_pg_cron.sql` — weekly free reset (Sun 00:00 UTC), daily purges
- Lib code: `lib/supabase/{client,server,middleware,database.types}.ts`, `lib/utils/cn.ts`
- `middleware.ts` — Supabase session refresh + `/admin` gate + `/me` + `/result` authed-area gate; excludes `/api/stripe/webhook` (raw body)
- `.env.local.example` with 20+ keys (NEXT_PUBLIC_SITE_URL, Supabase trio, Gemini, Stripe trio, Resend pair, VAPID trio, Turnstile pair, PostHog pair, Sentry quartet, Upstash pair, ANONYMOUS_DAILY_BUDGET_USD)
- Replaced scaffold's boilerplate `app/page.tsx` with minimal "Trend Image Generator — Coming soon" placeholder
- Updated `app/layout.tsx` metadata with project title + metadataBase from `NEXT_PUBLIC_SITE_URL`
- Updated `.gitignore` (Supabase ignores, Sentry, env templates allow-listed, .claude/draft/, IDE folders)
- CLAUDE.md updated for Next 16.2 (not 15), added 5 new gotchas (folder-name workaround, `pnpm supabase` invocation, virtual-store path sensitivity, Stripe webhook middleware exclusion, Tailwind v4 syntax)
- `pnpm typecheck` passes clean
- Commit `ff8f84a` — "feat: phase 1 foundation scaffold" (30 files, +6749 / -1382)

**Open:**
- Supabase migrations written but not applied — needs `pnpm supabase start` (requires Docker Desktop) OR remote Supabase project linked
- Sentry config files + next.config wrap — needs `SENTRY_DSN` + `SENTRY_AUTH_TOKEN` (user-side account creation)
- PostHog provider bootstrap — needs project key (user-side)
- Playwright browser binaries not yet downloaded (`pnpm exec playwright install`)
- CI workflow (.github/workflows/ci.yml) not yet written
- shadcn/ui init deferred until first component built
- agent-browser not yet installed (nightly cron supplement)

**Next:**
- Either: (a) install Docker Desktop + `pnpm supabase start` to verify migrations apply cleanly locally, OR (b) create Supabase project at supabase.com, link via `supabase link --project-ref ...`, push migrations
- Run `pnpm exec playwright install`
- Run `pnpm dlx @sentry/wizard@latest -i nextjs` once Sentry DSN/auth-token available
- Move to Phase 1.3 (Auth): Google OAuth provider in Supabase dashboard + magic-link email + `(auth)` route group + login UI

**Phase:** 1 — Foundation (1.1 ✅, 1.2 schema written ✅ apply ⏳, 1.6 SDKs installed ✅ init ⏳, 1.7 installed+configured ✅ binaries ⏳)

**Blockers:** Docker Desktop OR remote Supabase project; Sentry account; PostHog account (all user-side)

---

## 2026-05-27 — Plan audit + reversals synced across all docs

**Done:**
- Read existing plan + interviewed user on 12 high-leverage decisions (success goal, geography, virality vector, login flow, free quota, abuse posture, trend pipeline, latency UX, storage retention, pricing, input flexibility, SEO, prompt QA, observability, payments, job runner)
- Wrote amended plan to `~/.claude/plans/check-this-plan-...md` with: gaps + amendments table, data-model deltas, RLS additions, architecture additions (push subsystem, SEO, eval workflow, suggestion pipeline), revised phase plan (~14–16 days MVP), alternative recommendations, risk matrix (Critical/High/Med/Low + mitigations), 12-test verification matrix
- Audited `.claude/` folder vs amended plan — found tight wiring (32/32 items covered); flagged 5 minor gaps (test stack, `NEXT_PUBLIC_SITE_URL`, PWA manifest, bonus cap, wrong `vercel:vercel-storage` skill)
- Asked 4 follow-up decisions: Sentry day-1 ✅YES, anonymous trial ✅YES, 5/week refill ✅YES, E2E tool → Playwright primary + agent-browser nightly supplemental
- Verified `vercel-labs/agent-browser` is Rust CLI for AI agents, NOT Playwright replacement
- Appended Decision Reversals section to plan file
- Synced reversals into: `.claude/todo.md` (resolved Phase 0 decisions, schema column delta `free_used_lifetime`→`free_used_this_week`+`free_week_starts_at`, added Phase 1.7 Test Stack + 1.8 Anonymous Trial + renumbered 1.9 Verification, added pg_cron weekly + anonymous purge jobs, bonus cap = 50)
- Synced reversals into: `CLAUDE.md` (Source-of-Truth reversals section, Non-Negotiables #1 rule updated + #11 anonymous + #12 test gate, stack lists Sentry + test framework, Env Vars added `NEXT_PUBLIC_SITE_URL` + Sentry quartet + `ANONYMOUS_DAILY_BUDGET_USD`, e2e-testing skill added)
- Appended 2 lessons to `.claude/lessons.md` (sync-reversals-same-turn pattern + agent-browser-not-Playwright)

**Open:**
- Phase 0 external prereqs still pending (Gemini access, Stripe app, Resend domain, VAPID keys, Turnstile keys, domain, ToS/Privacy/AUP drafts, final credit-pack prices, 5 launch trends with eval photos + FAQ)
- 2 remaining decisions in Phase 0: `bonus_credits_earned` cap (default 50 if user accepts), anonymous abuse budget (default $20/day if user accepts)

**Next:**
- Resolve remaining 2 Phase 0 defaults (or accept them as written)
- Work through Phase 0 external prereqs in parallel
- Begin Phase 1.1 scaffold (`npx create-next-app@latest` with TS + Tailwind + App Router)

**Phase:** 0 — Pre-Build (decisions resolved, external prereqs pending)

**Blockers:** Phase 0 external accounts (user-side)

---

## 2026-05-27 — Project bootstrap (CLAUDE.md + trackers)

**Done:**
- Created project [CLAUDE.md](../CLAUDE.md) — stack, non-negotiables, workflow, skills, agents, folder map, phases, gotchas, conventions
- Verified karpathy-guidelines skill already installed globally (no re-clone)
- Created `.claude/todo.md` with full Phase 0–6 task tree from amended plan
- Created `.claude/lessons.md` seeded with 2 entries
- Created this `.claude/session-log.md`
- Audited against [KIMP CLAUDE.md](../../Video-Editor-kimp/CLAUDE.md); pulled in Task Management, Workflow, Self-Improvement, Verification, Gotchas, docs/ convention, Session Start Protocol

**Open:**
- Phase 0 pre-build checklist — 15+ external prerequisites unresolved (Gemini access, Stripe app, Resend domain, VAPID, Turnstile, ToS, pricing, 5 launch trends, etc.)
- Three open decisions: Sentry day-1 yes/no; anonymous trial yes/no; lifetime cap vs 5/week refill

**Next:**
- User answers the 3 open decisions
- Work through Phase 0 checklist in parallel
- Then `npx create-next-app` to start Phase 1.1

**Phase:** 0 — Pre-Build

**Blockers:** None (external accounts user-side)
