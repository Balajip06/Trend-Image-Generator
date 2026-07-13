/**
 * Visual baseline: captures full-page PNG of every consumer + admin surface
 * across 4 projects (desktop/mobile × light/dark).
 * Output: e2e/screenshots/${baseline|redesign}/<project>/<route>.png
 *
 * Pre-req: MOCK_TRENDS=true in .env.local so authed pages render without a
 * Supabase session and home grid has deterministic fixtures. Admin pages hit
 * real Supabase (proxy.ts bypasses the gate in MOCK_TRENDS mode).
 *
 * Re-shoot after redesign by setting VISUAL_OUTPUT_DIR=redesign — manual diff.
 */
import { test, expect } from '@playwright/test'

const OUTPUT_DIR = process.env.VISUAL_OUTPUT_DIR ?? 'baseline'

const STATIC_ROUTES: Array<{ name: string; path: string }> = [
  // Consumer flow
  { name: 'home', path: '/' },
  { name: 'trend-ghibli', path: '/trend/ghibli-portrait' },
  { name: 'trend-pixar', path: '/trend/pixar-3d-character' },
  { name: 'login', path: '/login' },
  { name: 'studio-empty', path: '/studio' },
  { name: 'studio-trend', path: '/studio?trend=ghibli-portrait' },
  { name: 'creations', path: '/creations' },
  { name: 'settings', path: '/settings' },
  { name: 'result-completed', path: '/result/mock-completed' },
  { name: 'result-processing', path: '/result/mock-processing' },
  { name: 'result-retryable', path: '/result/mock-retryable' },
  { name: 'result-failed', path: '/result/mock-failed' },

  // Admin — proxy.ts bypasses auth in MOCK_TRENDS mode
  { name: 'admin-home', path: '/admin' },
  { name: 'admin-trends-list', path: '/admin/trends' },
  { name: 'admin-trend-new', path: '/admin/trends/new' },
  { name: 'admin-audit', path: '/admin/audit' },
]

async function captureRoute(
  page: import('@playwright/test').Page,
  testInfo: import('@playwright/test').TestInfo,
  routeName: string,
  routePath: string
): Promise<void> {
  const response = await page.goto(routePath, { waitUntil: 'networkidle' })
  expect(response, `${routePath} navigation`).not.toBeNull()
  expect(response!.status(), `${routePath} status`).toBeLessThan(400)
  await page.waitForTimeout(500)
  const filename = `${OUTPUT_DIR}/${testInfo.project.name}/${routeName}.png`
  await page.screenshot({
    path: `e2e/screenshots/${filename}`,
    fullPage: true,
    animations: 'disabled',
  })
}

test.describe('visual baseline', () => {
  // Static routes — fixed paths, no discovery needed.
  for (const route of STATIC_ROUTES) {
    test(`${route.name}`, async ({ page }, testInfo) => {
      await captureRoute(page, testInfo, route.name, route.path)
    })
  }

  // Dynamic admin routes — first scrape /admin/trends to find a real trend id
  // (the seeded DB has 15), then visit /edit + /eval for that id.
  test.describe('dynamic admin', () => {
    let trendId: string | null = null

    test.beforeAll(async ({ browser }) => {
      const ctx = await browser.newContext()
      const page = await ctx.newPage()
      await page.goto('/admin/trends', { waitUntil: 'networkidle' })
      const href = await page
        .locator('a[href*="/admin/trends/"][href*="/edit"]')
        .first()
        .getAttribute('href')
      const match = href?.match(/\/admin\/trends\/([^/]+)\/edit/)
      trendId = match?.[1] ?? null
      await ctx.close()
    })

    test('admin-trend-edit', async ({ page }, testInfo) => {
      test.skip(!trendId, 'no trend id discovered (DB empty?)')
      await captureRoute(page, testInfo, 'admin-trend-edit', `/admin/trends/${trendId}/edit`)
    })

    test('admin-trend-eval', async ({ page }, testInfo) => {
      test.skip(!trendId, 'no trend id discovered (DB empty?)')
      await captureRoute(page, testInfo, 'admin-trend-eval', `/admin/trends/${trendId}/eval`)
    })
  })
})
