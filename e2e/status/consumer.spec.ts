/**
 * Consumer-surface status sweep — drives Trendly's public + signed-in consumer
 * pages like a real user against the already-running MOCK_TRENDS dev server.
 *
 * HARD RULES enforced here:
 *   - Never click any generate/submit button (zero API cost).
 *   - Read-only: navigate + assert + screenshot only.
 *
 * Each feature is its own `test()` so Playwright parallelizes them, and each
 * writes one result JSON via the shared harness.
 */
import path from 'node:path'
import { test } from '@playwright/test'
import { check, collectConsoleErrors, record, screenshot } from './harness'

const FIXTURE_PHOTO = path.join('e2e', 'status', 'fixtures', 'test-photo.png')

/** Safe navigation: records a check rather than throwing on a bad route. */
async function safeGoto(
  page: import('@playwright/test').Page,
  checks: import('./harness').Check[],
  route: string
): Promise<boolean> {
  try {
    const res = await page.goto(route, { waitUntil: 'networkidle' })
    const status = res?.status() ?? 0
    const ok = status > 0 && status < 400
    checks.push({ name: `GET ${route} < 400`, ok, detail: `status ${status}` })
    return ok
  } catch (err) {
    checks.push({
      name: `GET ${route} < 400`,
      ok: false,
      detail: err instanceof Error ? err.message : String(err),
    })
    return false
  }
}

test('home', async ({ page }, testInfo) => {
  const consoleErrors = collectConsoleErrors(page)
  const checks: import('./harness').Check[] = []
  await page.goto('/', { waitUntil: 'networkidle' })
  await check(checks, 'page title present', async () => (await page.title()).length > 0)
  await check(checks, 'trend grid visible', async () =>
    page.locator('a[href^="/trend/"]').first().isVisible()
  )
  const shot = await screenshot(page, 'consumer-home')
  record(testInfo, {
    group: 'Consumer',
    feature: 'Home',
    route: '/',
    checks,
    screenshot: shot,
    consoleErrors,
  })
})

test('trend card click', async ({ page }, testInfo) => {
  const consoleErrors = collectConsoleErrors(page)
  const checks: import('./harness').Check[] = []
  await page.goto('/', { waitUntil: 'networkidle' })

  const firstCard = page.locator('a[href^="/trend/"]').first()
  await check(checks, 'first trend card visible', async () => firstCard.isVisible())

  await check(checks, 'clicking card navigates to /trend/...', async () => {
    await firstCard.click()
    // Authed (mock) users get redirected to /studio?trend=... — accept either
    // landing on /trend/ OR the studio with a trend query param. Wait for the URL
    // to settle rather than reading a single (possibly pre-navigation) snapshot.
    await page.waitForURL(/(\/trend\/|\/me\/studio\?trend=)/, { timeout: 10_000 }).catch(() => {})
    const url = page.url()
    return /\/trend\//.test(url) || /\/me\/studio\?trend=/.test(url)
  })

  const shot = await screenshot(page, 'consumer-trend-card-click')
  record(testInfo, {
    group: 'Consumer',
    feature: 'Trend card click',
    route: '/',
    checks,
    notes: `landed on ${page.url()}`,
    screenshot: shot,
    consoleErrors,
  })
})

test('trend detail', async ({ page }, testInfo) => {
  const consoleErrors = collectConsoleErrors(page)
  const checks: import('./harness').Check[] = []
  const route = '/trend/ghibli-portrait'
  await safeGoto(page, checks, route)

  await check(checks, 'heading visible', async () => page.locator('h1, h2').first().isVisible())

  // The real upload form renders a hidden <input type="file"> (sr-only) from
  // SchemaForm. setInputFiles works on hidden inputs. Single-image fields use
  // id="file-<name>"; multi-slot fields use id="file-<name>-<idx>".
  const fileInput = page.locator('input[type="file"]').first()
  const hasFileInput = (await fileInput.count()) > 0
  await check(checks, 'file input present', async () => hasFileInput)

  if (hasFileInput) {
    await check(checks, 'attach fixture photo (no submit)', async () => {
      await fileInput.setInputFiles(FIXTURE_PHOTO)
      // Confirm either: a preview/thumbnail rendered, OR the input holds a value.
      const previewVisible = await page
        .locator('img[alt^="Preview"], img[alt^="Photo"]')
        .first()
        .isVisible()
        .catch(() => false)
      const inputValue = await fileInput.evaluate((el) => (el as HTMLInputElement).value.length > 0)
      return previewVisible || inputValue
    })
  }

  const shot = await screenshot(page, 'consumer-trend-detail')
  record(testInfo, {
    group: 'Consumer',
    feature: 'Trend detail (upload form)',
    route,
    checks,
    notes: hasFileInput ? undefined : 'no file input found on page',
    screenshot: shot,
    consoleErrors,
  })
})

test('studio', async ({ page }, testInfo) => {
  const consoleErrors = collectConsoleErrors(page)
  const checks: import('./harness').Check[] = []
  const route = '/studio'
  await safeGoto(page, checks, route)
  await check(checks, 'heading or trend grid visible', async () => {
    const heading = await page
      .locator('h1, h2')
      .first()
      .isVisible()
      .catch(() => false)
    const grid = await page
      .locator('a[href^="/trend/"]')
      .first()
      .isVisible()
      .catch(() => false)
    return heading || grid
  })
  const shot = await screenshot(page, 'consumer-studio')
  record(testInfo, {
    group: 'Consumer',
    feature: 'Studio',
    route,
    checks,
    screenshot: shot,
    consoleErrors,
  })
})

test('creations', async ({ page }, testInfo) => {
  const consoleErrors = collectConsoleErrors(page)
  const checks: import('./harness').Check[] = []
  const route = '/creations'
  await safeGoto(page, checks, route)
  await check(checks, 'heading visible', async () => page.locator('h1').first().isVisible())
  const shot = await screenshot(page, 'consumer-creations')
  record(testInfo, {
    group: 'Consumer',
    feature: 'Creations',
    route,
    checks,
    screenshot: shot,
    consoleErrors,
  })
})

test('settings', async ({ page }, testInfo) => {
  const consoleErrors = collectConsoleErrors(page)
  const checks: import('./harness').Check[] = []
  const route = '/settings'
  await safeGoto(page, checks, route)

  await check(
    checks,
    '"Credits & plans" present',
    async () => (await page.getByText('Credits & plans').count()) > 0
  )
  await check(
    checks,
    '"Coming soon" present',
    async () => (await page.getByText('Coming soon').count()) > 0
  )
  await check(
    checks,
    '"Your quota" section present',
    async () => (await page.getByText('Your quota').count()) > 0
  )
  await check(
    checks,
    'referral / "Invite friends" block present',
    async () => (await page.getByText('Invite friends').count()) > 0
  )

  const shot = await screenshot(page, 'consumer-settings')
  record(testInfo, {
    group: 'Consumer',
    feature: 'Settings',
    route,
    checks,
    screenshot: shot,
    consoleErrors,
  })
})

test('login', async ({ page }, testInfo) => {
  const consoleErrors = collectConsoleErrors(page)
  const checks: import('./harness').Check[] = []
  const route = '/login'
  await safeGoto(page, checks, route)
  await check(checks, 'page renders (title present)', async () => (await page.title()).length > 0)
  const shot = await screenshot(page, 'consumer-login')
  record(testInfo, {
    group: 'Consumer',
    feature: 'Login',
    route,
    checks,
    screenshot: shot,
    consoleErrors,
  })
})

// Public legal + pricing surfaces: status < 400 + a heading.
for (const route of ['/pricing', '/terms', '/privacy']) {
  const feature = route.replace('/', '')
  test(`public ${feature}`, async ({ page }, testInfo) => {
    const consoleErrors = collectConsoleErrors(page)
    const checks: import('./harness').Check[] = []
    await safeGoto(page, checks, route)
    await check(checks, 'heading visible', async () => page.locator('h1, h2').first().isVisible())
    const shot = await screenshot(page, `consumer-${feature}`)
    record(testInfo, {
      group: 'Consumer',
      feature: feature.charAt(0).toUpperCase() + feature.slice(1),
      route,
      checks,
      screenshot: shot,
      consoleErrors,
    })
  })
}

// Marketing landing pages.
for (const route of [
  '/contact',
  '/vs-midjourney',
  '/free-ghibli-effect-maker',
  '/free-anime-portrait-generator',
]) {
  const feature = route.replace('/', '')
  test(`marketing ${feature}`, async ({ page }, testInfo) => {
    const consoleErrors = collectConsoleErrors(page)
    const checks: import('./harness').Check[] = []
    await safeGoto(page, checks, route)
    await check(checks, 'heading visible', async () => page.locator('h1, h2').first().isVisible())
    const shot = await screenshot(page, `consumer-${feature}`)
    record(testInfo, {
      group: 'Consumer',
      feature: `Marketing: ${feature}`,
      route,
      checks,
      screenshot: shot,
      consoleErrors,
    })
  })
}
