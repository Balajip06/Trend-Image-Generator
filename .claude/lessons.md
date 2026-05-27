# Lessons — Corrections + Patterns

Append on EVERY user correction. Review at session start.

Format:
```
## YYYY-MM-DD — short title
**Trigger:** what user corrected
**Lesson:** what to do differently
**Apply when:** scope of rule
```

---

## 2026-05-27 — Track plan + session state on disk

**Trigger:** User flagged session tracker missing; plan being lost between sessions. Referenced KIMP project as template.
**Lesson:** Project needs `.claude/todo.md` + `.claude/lessons.md` + `.claude/session-log.md` from day 1. CLAUDE.md must enforce read-on-session-start. Plan files must be linked at top.
**Apply when:** Any new project with multi-session scope. Set up trackers BEFORE first code.

---

## 2026-05-27 — Amended plan supersedes original

**Trigger:** Two plan files exist — `trend-image-app-plan.md` (original) and `check-this-plan-c-users-balaj-projects-t-luminous-prism.md` (amended). User interview locked decisions only reflected in amended.
**Lesson:** When two plan docs disagree, amended wins. List which fields differ in CLAUDE.md so future-me doesn't blend them.
**Apply when:** Any architecture/data-model/scope decision in this project.

---

## 2026-05-27 — Sync reversals across 3 files in one turn

**Trigger:** Post-wiring audit produced 4 decision reversals (Sentry day-1, anonymous trial, 5/week refill, Playwright). Plan file got reversals but `.claude/todo.md`, `CLAUDE.md`, and `.claude/lessons.md` would have drifted if not synced same turn.
**Lesson:** When plan file gets a "Decision Reversals" section, immediately mirror into: (1) `.claude/todo.md` Phase 0 checkboxes resolved + schema-column deltas + new phase subsections, (2) `CLAUDE.md` Source-of-Truth section + Non-Negotiables + Env Vars + Active Skills + Stack list, (3) `.claude/lessons.md` if reversal teaches a recurring pattern. Don't let three files drift.
**Apply when:** Any time the plan file gets a reversal/amendment AFTER the wiring docs (CLAUDE.md/todo.md) are already populated.

---

## 2026-05-27 — agent-browser is not a Playwright replacement

**Trigger:** User asked if `vercel-labs/agent-browser` could serve as the E2E framework.
**Lesson:** agent-browser is a Rust CLI for AI agents to drive browsers via CDP; it lacks the assertion library, fixture system, multi-browser project config, video traces, and CI test-runner that Playwright provides. Correct use: Playwright as primary E2E framework (asserts, fixtures, parallelism), agent-browser as nightly supplemental "agent-as-user" smoke test (natural-language scripts that catch UX regressions Playwright's strict selectors miss).
**Apply when:** Anyone proposes agent-browser/Browserless/Browserbase as a Playwright/Cypress replacement.
