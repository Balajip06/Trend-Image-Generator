/**
 * Shared harness for the real-user status sweep.
 *
 * Each feature test builds a list of soft checks (they never throw — a failed
 * check just records ok:false so the run continues and the report shows ❌),
 * captures a viewport screenshot, and writes ONE result file to
 * e2e/status/results/<id>.json. Parallel Playwright workers each write their own
 * file (no shared mutable state), and scripts/build-status-report.mjs globs them.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Page, TestInfo } from '@playwright/test'

export interface Check {
  name: string
  ok: boolean
  detail?: string
}

export interface FeatureResult {
  group: string
  feature: string
  route: string
  status: 'pass' | 'fail' | 'skip'
  checks: Check[]
  notes?: string
  screenshot?: string // relative path under e2e/status/
  consoleErrors: string[]
}

const RESULTS_DIR = join('e2e', 'status', 'results')
const SHOTS_DIR = join('e2e', 'status', 'shots')

function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

/** Attach a console-error collector to a page. Returns the live array. */
export function collectConsoleErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text())
  })
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`))
  return errors
}

/** Run a soft check — never throws; records ok + optional detail. */
export async function check(
  checks: Check[],
  name: string,
  fn: () => Promise<boolean> | boolean
): Promise<void> {
  try {
    const ok = await fn()
    checks.push({ name, ok })
  } catch (err) {
    checks.push({ name, ok: false, detail: err instanceof Error ? err.message : String(err) })
  }
}

export async function screenshot(page: Page, id: string): Promise<string> {
  mkdirSync(SHOTS_DIR, { recursive: true })
  const rel = `shots/${slug(id)}.png`
  await page.screenshot({ path: join('e2e', 'status', rel), animations: 'disabled' })
  return rel
}

/**
 * Record a feature result. Status defaults to fail if any check failed, else
 * pass — unless explicitly overridden (e.g. 'skip').
 */
export function record(
  testInfo: TestInfo,
  r: Omit<FeatureResult, 'status'> & { status?: FeatureResult['status'] }
): void {
  mkdirSync(RESULTS_DIR, { recursive: true })
  const status: FeatureResult['status'] =
    r.status ?? (r.checks.some((c) => !c.ok) ? 'fail' : 'pass')
  const full: FeatureResult = { ...r, status }
  const id = slug(`${r.group}-${r.feature}`)
  writeFileSync(join(RESULTS_DIR, `${id}.json`), JSON.stringify(full, null, 2))
}
