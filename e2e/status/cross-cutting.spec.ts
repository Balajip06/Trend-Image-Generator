/**
 * Cross-cutting status checks — theme, mobile, accessibility.
 *
 * Read-only, zero cost: runs against the already-running MOCK_TRENDS dev server
 * at http://localhost:3000. Each test() records ONE feature result via the
 * shared harness (e2e/status/harness.ts) and never throws on a soft failure, so
 * the full sweep always completes and writes its JSON under
 * e2e/status/results/.
 */
import AxeBuilder from '@axe-core/playwright'
import { test } from '@playwright/test'
import { check, collectConsoleErrors, record, screenshot, type Check } from './harness'

const GROUP = 'Cross-cutting'

/** Read the current theme marker off <html> — class token (next-themes attribute="class"). */
async function readHtmlTheme(page: import('@playwright/test').Page): Promise<string> {
  return page.evaluate(() => {
    const el = document.documentElement
    return el.getAttribute('data-theme') ?? el.className.trim()
  })
}

test('Theme toggle', async ({ page }, testInfo) => {
  const consoleErrors = collectConsoleErrors(page)
  const checks: Check[] = []
  const route = '/'
  let shot = ''

  try {
    await page.goto(route, { waitUntil: 'networkidle' })

    const toggle = page.getByRole('button', { name: /switch to (dark|light) mode/i })
    await check(checks, 'theme toggle button present', async () => (await toggle.count()) > 0)

    const before = await readHtmlTheme(page)
    await toggle.first().click()
    // next-themes flips the <html> class synchronously on click; give it a beat.
    await page.waitForTimeout(300)
    const after = await readHtmlTheme(page)

    await check(checks, 'html theme marker changed', () => before !== after && after.length > 0)
    await check(
      checks,
      'toggled to light or dark',
      () => /\b(light|dark)\b/.test(after) || after === 'light' || after === 'dark'
    )

    shot = await screenshot(page, `${GROUP}-theme-toggle`)
    record(testInfo, {
      group: GROUP,
      feature: 'Theme toggle',
      route,
      checks,
      notes: `before="${before}" after="${after}"`,
      screenshot: shot,
      consoleErrors,
    })
  } catch (err) {
    record(testInfo, {
      group: GROUP,
      feature: 'Theme toggle',
      route,
      checks,
      status: 'fail',
      notes: `harness error: ${err instanceof Error ? err.message : String(err)}`,
      screenshot: shot,
      consoleErrors,
    })
  }
})

test('Mobile home', async ({ page }, testInfo) => {
  const consoleErrors = collectConsoleErrors(page)
  const checks: Check[] = []
  const route = '/'
  let shot = ''

  try {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto(route, { waitUntil: 'networkidle' })

    await check(checks, 'page rendered (h1 visible)', async () =>
      page.locator('h1').first().isVisible()
    )
    const trendLink = page.locator('a[href^="/trend/"]').first()
    await check(checks, 'a trend link is visible', async () => trendLink.isVisible())

    shot = await screenshot(page, `${GROUP}-mobile-home`)
    record(testInfo, {
      group: GROUP,
      feature: 'Mobile home',
      route,
      checks,
      notes: 'viewport 390x844',
      screenshot: shot,
      consoleErrors,
    })
  } catch (err) {
    record(testInfo, {
      group: GROUP,
      feature: 'Mobile home',
      route,
      checks,
      status: 'fail',
      notes: `harness error: ${err instanceof Error ? err.message : String(err)}`,
      screenshot: shot,
      consoleErrors,
    })
  }
})

const A11Y_ROUTES = ['/', '/trend/ghibli-portrait', '/me/settings']

for (const route of A11Y_ROUTES) {
  test(`a11y: ${route}`, async ({ page }, testInfo) => {
    const consoleErrors = collectConsoleErrors(page)
    const checks: Check[] = []
    const feature = `a11y: ${route}`
    let shot = ''
    let criticalCount = -1
    let seriousModerate = -1

    try {
      await page.goto(route, { waitUntil: 'networkidle' })

      const results = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .analyze()

      const critical = results.violations.filter((v) => v.impact === 'critical')
      criticalCount = critical.length
      seriousModerate = results.violations.filter(
        (v) => v.impact === 'serious' || v.impact === 'moderate'
      ).length

      await check(checks, 'no critical a11y violations', () => criticalCount === 0)

      const critIds = critical.map((v) => v.id).join(', ')
      shot = await screenshot(page, `${GROUP}-${feature}`)
      record(testInfo, {
        group: GROUP,
        feature,
        route,
        checks,
        notes: `critical=${criticalCount}${critIds ? ` [${critIds}]` : ''}; serious+moderate=${seriousModerate}`,
        screenshot: shot,
        consoleErrors,
      })
    } catch (err) {
      record(testInfo, {
        group: GROUP,
        feature,
        route,
        checks,
        status: 'fail',
        notes: `harness error: ${err instanceof Error ? err.message : String(err)}`,
        screenshot: shot,
        consoleErrors,
      })
    }
  })
}
