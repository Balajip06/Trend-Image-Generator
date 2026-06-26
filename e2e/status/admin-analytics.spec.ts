/**
 * Real-user status sweep — ADMIN ANALYTICS pages.
 *
 * These pages read REAL production Supabase (read-only). The dev server runs in
 * MOCK_TRENDS mode, but the analytics surfaces use the production-gated mock
 * helpers (MOCKS_ALLOWED), so prod-empty tables must surface as honest empty
 * states / real zeros — NOT canned demo numbers.
 *
 * HARD RULES enforced here: read-only. We navigate, assert, and click TABS
 * only. No mutating actions (no save/delete/approve/grant) are ever clicked.
 *
 * Each test attaches a console-error collector and records ONE result file via
 * the shared harness. Soft `check()` calls never throw, so a single page error
 * doesn't abort the whole sweep.
 */
import { expect, test, type Page } from '@playwright/test'
import { check, collectConsoleErrors, record, screenshot, type Check } from './harness'

const GROUP = 'Admin analytics'

/**
 * Navigate read-only and record the HTTP status + a visible-heading check.
 * Wrapped so a navigation failure becomes a failed check instead of a throw.
 * Returns true when the page rendered with a <h1> heading visible.
 */
async function gotoAndRender(
  page: Page,
  checks: Check[],
  route: string
): Promise<boolean> {
  let status = 0
  await check(checks, `GET ${route} responds <400`, async () => {
    const res = await page.goto(route, { waitUntil: 'networkidle' })
    status = res?.status() ?? 0
    return status > 0 && status < 400
  })

  let headingVisible = false
  await check(checks, 'heading / main content visible', async () => {
    const h1 = page.locator('h1').first()
    await h1.waitFor({ state: 'visible', timeout: 10_000 })
    headingVisible = await h1.isVisible()
    return headingVisible
  })

  return status > 0 && status < 400 && headingVisible
}

/** Click a tab trigger by its visible label and assert its panel becomes visible. */
async function clickTab(page: Page, checks: Check[], label: string): Promise<void> {
  await check(checks, `tab "${label}" → content visible`, async () => {
    const tab = page.getByRole('tab', { name: label, exact: true })
    await tab.click()
    // Radix marks the active trigger aria-selected and shows its panel.
    await expect(tab).toHaveAttribute('aria-selected', 'true', { timeout: 5_000 })
    const panel = page.getByRole('tabpanel')
    await panel.first().waitFor({ state: 'visible', timeout: 5_000 })
    return panel.first().isVisible()
  })
}

// ─── 1. Engagement ──────────────────────────────────────────────────────────
test('Engagement dashboard renders with KPI cards', async ({ page }, testInfo) => {
  const consoleErrors = collectConsoleErrors(page)
  const checks: Check[] = []
  const route = '/admin/engagement'

  await gotoAndRender(page, checks, route)

  await check(checks, 'heading "Engagement" visible', () =>
    page.getByRole('heading', { name: /Engagement/i, level: 1 }).isVisible()
  )
  await check(checks, 'KPI cards present', async () => {
    // KpiCard renders each label inside the cards grid; a populated dashboard
    // shows several. Assert at least one KPI-style label is on the page.
    const kpiLabels = page.getByText(/Impressions|Clicks|CTR|Total/i)
    return (await kpiLabels.count()) > 0
  })

  const shot = await screenshot(page, `${GROUP}-engagement`)
  record(testInfo, {
    group: GROUP,
    feature: 'Engagement',
    route,
    checks,
    screenshot: shot,
    consoleErrors,
    notes:
      consoleErrors.length > 0 ? `console errors: ${consoleErrors.length}` : undefined,
  })
})

// ─── 2. Users (tabs) ─────────────────────────────────────────────────────────
test('Users analytics renders and all tabs switch', async ({ page }, testInfo) => {
  const consoleErrors = collectConsoleErrors(page)
  const checks: Check[] = []
  const route = '/admin/users'

  await gotoAndRender(page, checks, route)

  // Tabs labels from app/admin/(authed)/users/page.tsx.
  for (const label of ['Active users', 'Signup sources', 'Funnel', 'Cohort retention']) {
    await clickTab(page, checks, label)
  }

  const shot = await screenshot(page, `${GROUP}-users`)
  record(testInfo, {
    group: GROUP,
    feature: 'Users',
    route,
    checks,
    screenshot: shot,
    consoleErrors,
    notes:
      consoleErrors.length > 0 ? `console errors: ${consoleErrors.length}` : undefined,
  })
})

// ─── 3. Margin (tabs + no-demo-string assertion) ─────────────────────────────
test('Margin renders, tabs switch, and shows NO demo $89.95', async ({ page }, testInfo) => {
  const consoleErrors = collectConsoleErrors(page)
  const checks: Check[] = []
  const route = '/admin/margin'

  await gotoAndRender(page, checks, route)

  for (const label of ['Margin overview', 'Trend leaderboard', 'Revenue cohorts', 'Unit economics']) {
    await clickTab(page, checks, label)
  }

  // Production build must show real/empty figures, never MOCK_SUMMARY ($89.95).
  await check(checks, 'does NOT contain demo string "$89.95"', async () => {
    const body = (await page.locator('body').innerText()).toString()
    return !body.includes('$89.95')
  })

  const shot = await screenshot(page, `${GROUP}-margin`)
  const body = await page.locator('body').innerText()
  record(testInfo, {
    group: GROUP,
    feature: 'Margin',
    route,
    checks,
    screenshot: shot,
    consoleErrors,
    notes: body.includes('$89.95')
      ? 'WARNING: demo $89.95 present — MOCK_SUMMARY leaked into prod build'
      : 'No demo $89.95 — real/empty figures as expected.',
  })
})

// ─── 4. Referrals (empty-state vs demo names) ────────────────────────────────
test('Referrals renders with honest empty state', async ({ page }, testInfo) => {
  const consoleErrors = collectConsoleErrors(page)
  const checks: Check[] = []
  const route = '/admin/referrals'

  await gotoAndRender(page, checks, route)

  const body = await page.locator('body').innerText()
  const looksEmpty = /No referrals yet/i.test(body)
  // The page surfaces a "demo data" badge whenever it falls back to
  // MOCK_REFERRERS (dev MOCK_TRENDS mode or MOCKS_ALLOWED with empty tables).
  const showsDemoBadge = await page
    .getByText(/demo data/i)
    .first()
    .isVisible()
    .catch(() => false)
  const showsDemoNames = /@trendly\.dev/i.test(body)

  await check(checks, 'page rendered (heading visible)', () =>
    page.getByRole('heading', { name: /Referrals/i, level: 1 }).isVisible()
  )
  // Either an honest empty state OR real referral rows is acceptable; a
  // "demo data" fallback in what should be a production build is NOT — flag it.
  await check(checks, 'shows empty-state OR real data (not demo fallback)', () =>
    Promise.resolve(looksEmpty || !(showsDemoBadge || showsDemoNames))
  )

  const shot = await screenshot(page, `${GROUP}-referrals`)
  const notes = looksEmpty
    ? 'Empty: "No referrals yet" shown — honest empty state, no demo names.'
    : showsDemoBadge || showsDemoNames
      ? 'DEMO DATA shown (badge + @trendly.dev names). Dev server runs MOCK_TRENDS=true, ' +
        'so loadData() short-circuits to MOCK_REFERRERS at the top of the function. ' +
        'In production (MOCKS_ALLOWED=false) this path returns the zeroed empty state ' +
        '(page.tsx lines 68-74), so this is a dev-mode artifact, not a prod regression.'
      : 'Real referral data present (no demo badge).'
  record(testInfo, {
    group: GROUP,
    feature: 'Referrals',
    route,
    checks,
    screenshot: shot,
    consoleErrors,
    notes,
  })
})

// ─── 5–12. Plain "renders" pages ─────────────────────────────────────────────
const RENDER_ONLY: { feature: string; route: string; note: string }[] = [
  { feature: 'Refunds', route: '/admin/refunds', note: 'refunds list' },
  { feature: 'Marketing spend', route: '/admin/marketing-spend', note: 'marketing spend' },
  { feature: 'Generations', route: '/admin/generations', note: 'live monitor' },
  { feature: 'Audit log', route: '/admin/audit', note: 'audit log viewer' },
  { feature: 'Export', route: '/admin/export', note: 'data export' },
  { feature: 'VIP', route: '/admin/vip', note: 'VIP grants' },
  { feature: 'KIMP360', route: '/admin/kimp', note: 'KIMP360' },
  { feature: 'Settings', route: '/admin/settings', note: 'admin settings' },
]

for (const { feature, route, note } of RENDER_ONLY) {
  test(`${feature} (${route}) renders`, async ({ page }, testInfo) => {
    const consoleErrors = collectConsoleErrors(page)
    const checks: Check[] = []

    await gotoAndRender(page, checks, route)

    const shot = await screenshot(page, `${GROUP}-${feature}`)
    record(testInfo, {
      group: GROUP,
      feature,
      route,
      checks,
      screenshot: shot,
      consoleErrors,
      notes:
        consoleErrors.length > 0
          ? `${note} · console errors: ${consoleErrors.length}`
          : note,
    })
  })
}
