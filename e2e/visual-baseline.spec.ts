/**
 * Visual baseline: captures full-page PNG of every consumer surface across
 * 4 projects (desktop/mobile × light/dark). Output: e2e/screenshots/baseline/
 *
 * Pre-req: MOCK_TRENDS=true in .env.local so authed pages render without a
 * Supabase session and home grid has deterministic fixtures.
 *
 * Re-shoot after redesign by changing OUTPUT_DIR to "redesign" — manual diff.
 */
import { test, expect } from '@playwright/test'

const OUTPUT_DIR = process.env.VISUAL_OUTPUT_DIR ?? 'baseline'

const ROUTES: Array<{ name: string; path: string; waitFor?: string }> = [
  // Consumer flow
  { name: 'home', path: '/' },
  { name: 'trend-ghibli', path: '/trend/ghibli-portrait' },
  { name: 'trend-pixar', path: '/trend/pixar-3d-character' },
  { name: 'login', path: '/login' },
  { name: 'creations', path: '/me/creations' },
  { name: 'settings', path: '/me/settings' },
  { name: 'result-completed', path: '/result/mock-completed' },
  { name: 'result-processing', path: '/result/mock-processing' },
  { name: 'result-retryable', path: '/result/mock-retryable' },
  { name: 'result-failed', path: '/result/mock-failed' },

  // Admin surface — proxy.ts bypasses auth in MOCK_TRENDS mode. Edit + eval
  // pages omitted (require a real :id param — add later via beforeAll fetch).
  { name: 'admin-home', path: '/admin' },
  { name: 'admin-trends-list', path: '/admin/trends' },
  { name: 'admin-trend-new', path: '/admin/trends/new' },
  { name: 'admin-suggestions', path: '/admin/suggestions' },
]

test.describe('visual baseline', () => {
  for (const route of ROUTES) {
    test(`${route.name}`, async ({ page }, testInfo) => {
      const response = await page.goto(route.path, { waitUntil: 'networkidle' })
      expect(response, `${route.path} navigation`).not.toBeNull()
      expect(response!.status(), `${route.path} status`).toBeLessThan(400)

      // Quiet the page a beat for any client transitions / font swap
      await page.waitForTimeout(500)

      const projectName = testInfo.project.name
      const filename = `${OUTPUT_DIR}/${projectName}/${route.name}.png`
      await page.screenshot({
        path: `e2e/screenshots/${filename}`,
        fullPage: true,
        animations: 'disabled',
      })
    })
  }
})
