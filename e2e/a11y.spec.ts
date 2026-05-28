/**
 * Axe-core accessibility scan across the consumer flow.
 *
 * Pre-req: MOCK_TRENDS=true (set in .env.local) so authed pages render.
 *
 * Failure rule: zero critical violations. Serious + moderate logged for
 * triage but do not fail the run during initial redesign — we can ratchet
 * the bar once a clean baseline is reached.
 */
import AxeBuilder from '@axe-core/playwright'
import { test, expect } from '@playwright/test'

const ROUTES = [
  '/',
  '/trend/ghibli-portrait',
  '/login',
  '/me/creations',
  '/me/settings',
  '/result/mock-completed',
]

for (const route of ROUTES) {
  test(`a11y: ${route}`, async ({ page }) => {
    await page.goto(route, { waitUntil: 'networkidle' })
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze()

    const critical = results.violations.filter((v) => v.impact === 'critical')
    if (critical.length > 0) {
      console.error(
        `${route} — critical violations:\n` +
          critical
            .map(
              (v) =>
                `  - ${v.id} (${v.help})\n    nodes: ${v.nodes.length}\n    rule: ${v.helpUrl}`,
            )
            .join('\n'),
      )
    }
    expect(critical, `${route} should have zero critical a11y violations`).toEqual([])
  })
}
