/**
 * Status sweep — Admin core + nav interactions, driven like a real user.
 *
 * Dev server runs in MOCK_TRENDS mode (admin auth bypassed). Admin pages read
 * REAL prod Supabase, which may be empty — tests degrade to skip/notes rather
 * than fail when no trends are seeded.
 *
 * READ-ONLY against prod: we only navigate, assert presence, toggle the nav
 * collapse, open the mobile drawer, and click nav links / tabs. We NEVER click
 * create/activate/deactivate/clone/delete/Run-Test/Approve/Reject buttons.
 */
import { expect, test } from '@playwright/test'
import { check, collectConsoleErrors, record, screenshot, type Check } from './harness'

const GROUP = 'Admin core'

test.describe('Admin core', () => {
  test('Dashboard renders, suggestions removed', async ({ page }, testInfo) => {
    const consoleErrors = collectConsoleErrors(page)
    const checks: Check[] = []

    await page.goto('/admin')
    await expect(page.locator('h1')).toBeVisible()

    await check(checks, 'h1 heading visible', async () => page.locator('h1').first().isVisible())
    await check(checks, 'no "Pending suggestions" text', async () => {
      const count = await page.getByText('Pending suggestions', { exact: false }).count()
      return count === 0
    })
    await check(checks, 'no link to /admin/suggestions', async () => {
      const count = await page.locator('a[href*="/admin/suggestions"]').count()
      return count === 0
    })

    const shot = await screenshot(page, 'admin-dashboard')
    record(testInfo, {
      group: GROUP,
      feature: 'Dashboard',
      route: '/admin',
      checks,
      screenshot: shot,
      consoleErrors,
    })
  })

  test('Menu — collapse persists', async ({ page }, testInfo) => {
    const consoleErrors = collectConsoleErrors(page)
    const checks: Check[] = []

    await page.goto('/admin')
    // Catalogue group button (aria-expanded toggle whose text includes the title).
    const catalogueBtn = page.locator('button[aria-expanded]', { hasText: 'Catalogue' }).first()
    const trendsLink = page
      .getByRole('navigation', { name: 'Admin sections' })
      .getByRole('link', { name: 'Trends' })

    await expect(catalogueBtn).toBeVisible()
    await expect(trendsLink).toBeVisible()
    await check(checks, 'Trends link visible before collapse', async () => trendsLink.isVisible())

    await catalogueBtn.click()
    await expect(trendsLink).toBeHidden()
    await check(checks, 'Trends link hidden after collapse', async () => {
      return (await trendsLink.count()) === 0 || !(await trendsLink.isVisible())
    })

    const shot = await screenshot(page, 'admin-menu-collapsed')

    // Reload and confirm the collapse persisted via localStorage.
    await page.reload()
    const catalogueBtnAfter = page
      .locator('button[aria-expanded]', { hasText: 'Catalogue' })
      .first()
    await expect(catalogueBtnAfter).toHaveAttribute('aria-expanded', 'false')
    await check(checks, 'collapse persists across reload (aria-expanded=false)', async () => {
      return (await catalogueBtnAfter.getAttribute('aria-expanded')) === 'false'
    })

    record(testInfo, {
      group: GROUP,
      feature: 'Menu — collapse',
      route: '/admin',
      checks,
      notes: 'Collapsed Catalogue group, reloaded, verified localStorage persistence.',
      screenshot: shot,
      consoleErrors,
    })
  })

  test('Menu — mobile drawer', async ({ page }, testInfo) => {
    const consoleErrors = collectConsoleErrors(page)
    const checks: Check[] = []

    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/admin')

    const hamburger = page.locator('button[aria-label="Open menu"]')
    await expect(hamburger).toBeVisible()
    await hamburger.click()

    const drawer = page.locator('[role="dialog"][aria-label="Admin navigation"]')
    await expect(drawer).toHaveAttribute('data-state', 'open')
    await check(checks, 'drawer data-state=open', async () => {
      return (await drawer.getAttribute('data-state')) === 'open'
    })

    const drawerLink = drawer.getByRole('link', { name: 'Trends' }).first()
    await expect(drawerLink).toBeVisible()
    await check(checks, 'a nav link visible inside drawer', async () => drawerLink.isVisible())

    const shot = await screenshot(page, 'admin-menu-drawer')
    record(testInfo, {
      group: GROUP,
      feature: 'Menu — mobile drawer',
      route: '/admin',
      checks,
      notes: 'Viewport 390x844; opened drawer via hamburger.',
      screenshot: shot,
      consoleErrors,
    })
  })

  test('Menu — nav click', async ({ page }, testInfo) => {
    const consoleErrors = collectConsoleErrors(page)
    const checks: Check[] = []

    await page.goto('/admin')
    const engagementLink = page
      .getByRole('navigation', { name: 'Admin sections' })
      .getByRole('link', { name: 'Engagement' })
    await expect(engagementLink).toBeVisible()
    await engagementLink.click()

    await page.waitForURL('**/admin/engagement')
    await check(checks, 'URL is /admin/engagement', async () =>
      page.url().endsWith('/admin/engagement')
    )

    const activeLink = page
      .getByRole('navigation', { name: 'Admin sections' })
      .getByRole('link', { name: 'Engagement' })
    await expect(activeLink).toHaveAttribute('aria-current', 'page')
    await check(checks, 'Engagement link aria-current=page', async () => {
      return (await activeLink.getAttribute('aria-current')) === 'page'
    })

    record(testInfo, {
      group: GROUP,
      feature: 'Menu — nav click',
      route: '/admin/engagement',
      checks,
      consoleErrors,
    })
  })

  test('Trends list renders', async ({ page }, testInfo) => {
    const consoleErrors = collectConsoleErrors(page)
    const checks: Check[] = []

    await page.goto('/admin/trends')
    await expect(page.getByRole('heading', { name: 'Trends' })).toBeVisible()
    await check(checks, 'Trends heading visible', async () =>
      page.getByRole('heading', { name: 'Trends' }).isVisible()
    )

    const rowCount = await page.locator('table tbody tr').count()
    const hasRows = rowCount > 0
    if (hasRows) {
      await check(checks, 'trend rows visible', async () =>
        page.locator('table tbody tr').first().isVisible()
      )
    } else {
      // Empty state: list confirms prod has no seeded trends.
      await check(checks, 'empty state shown (no seeded trends)', async () => {
        const count = await page.getByText('No trends yet').count()
        return count > 0
      })
    }

    const shot = await screenshot(page, 'admin-trends-list')
    record(testInfo, {
      group: GROUP,
      feature: 'Trends list',
      route: '/admin/trends',
      checks,
      notes: hasRows
        ? `Prod has ${rowCount} trend row(s) — list includes non-active/draft trends.`
        : 'Prod has NO seeded trends — empty state ("No trends yet") rendered.',
      screenshot: shot,
      consoleErrors,
    })
  })

  test('New trend form renders', async ({ page }, testInfo) => {
    const consoleErrors = collectConsoleErrors(page)
    const checks: Check[] = []

    await page.goto('/admin/trends/new')
    await expect(page.getByRole('heading', { name: 'New trend' })).toBeVisible()
    await check(checks, 'New trend heading visible', async () =>
      page.getByRole('heading', { name: 'New trend' }).isVisible()
    )
    await check(checks, 'form inputs render', async () => {
      const inputCount = await page.locator('form input, form textarea, form select').count()
      return inputCount > 0
    })

    const shot = await screenshot(page, 'admin-trend-new')
    record(testInfo, {
      group: GROUP,
      feature: 'New trend',
      route: '/admin/trends/new',
      checks,
      screenshot: shot,
      consoleErrors,
    })
  })

  test('Eval UI renders for a trend', async ({ page }, testInfo) => {
    const consoleErrors = collectConsoleErrors(page)
    const checks: Check[] = []

    // Discover a trend id from the trends list (first edit link).
    await page.goto('/admin/trends')
    const editLink = page.locator('a[href*="/admin/trends/"][href*="/edit"]').first()
    const editCount = await editLink.count()

    if (editCount === 0) {
      record(testInfo, {
        group: GROUP,
        feature: 'Eval UI',
        route: '/admin/trends/{id}/eval',
        status: 'skip',
        checks: [],
        notes: 'no trends seeded in prod',
        consoleErrors,
      })
      return
    }

    // Collect candidate trend ids from edit links. The "Approve & Go Live"
    // button only renders for INACTIVE trends (active ones show "Deactivate"),
    // so scan a few eval pages to find one that exposes the approve control.
    const hrefs = await page
      .locator('a[href*="/admin/trends/"][href*="/edit"]')
      .evaluateAll((els) =>
        Array.from(new Set(els.map((e) => (e as HTMLAnchorElement).getAttribute('href') ?? '')))
      )
    const ids = hrefs
      .map((h) => h.match(/\/admin\/trends\/([^/]+)\/edit/)?.[1])
      .filter((x): x is string => Boolean(x))

    if (ids.length === 0) {
      record(testInfo, {
        group: GROUP,
        feature: 'Eval UI',
        route: '/admin/trends/{id}/eval',
        status: 'skip',
        checks: [],
        notes: 'no trends seeded in prod (could not parse trend id)',
        consoleErrors,
      })
      return
    }

    // Visit eval pages until we find one whose "Go live" card exposes the
    // Approve button (inactive trend). Cap the scan to keep the run fast.
    let chosenId = ids[0]
    let foundApprove = false
    for (const candidate of ids.slice(0, 12)) {
      await page.goto(`/admin/trends/${candidate}/eval`)
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
      const count = await page.getByRole('button', { name: /Approve.*Go Live/i }).count()
      chosenId = candidate
      if (count > 0) {
        foundApprove = true
        break
      }
    }

    // Settle on the chosen eval page with a clean navigation + wait so the
    // assertions below run against a fully-rendered page (not mid-transition).
    await page.goto(`/admin/trends/${chosenId}/eval`)
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()

    // Upload form: file input OR "Choose a photo" text. DO NOT interact with it.
    await check(checks, 'upload form present (file input or "Choose a photo")', async () => {
      const fileInputs = await page.locator('input[type="file"]').count()
      const choose = await page.getByText('Choose a photo', { exact: false }).count()
      return fileInputs > 0 || choose > 0
    })

    // Go-live control present. The approve button only shows for inactive
    // trends; an active trend shows "Deactivate" instead — either confirms the
    // go-live workflow rendered. DO NOT click either.
    await check(
      checks,
      'go-live control present (Approve & Go Live, or Deactivate if active)',
      async () => {
        const approve = await page.getByRole('button', { name: /Approve.*Go Live/i }).count()
        const deactivate = await page.getByRole('button', { name: /Deactivate/i }).count()
        return approve > 0 || deactivate > 0
      }
    )

    const shot = await screenshot(page, 'admin-trend-eval')
    record(testInfo, {
      group: GROUP,
      feature: 'Eval UI',
      route: `/admin/trends/${chosenId}/eval`,
      checks,
      notes: foundApprove
        ? `Eval UI + "Approve & Go Live" button verified for inactive trend ${chosenId}. Buttons NOT clicked (read-only).`
        : `Eval UI verified for trend ${chosenId}; all scanned trends were active so the go-live card showed "Deactivate" instead of "Approve & Go Live". Buttons NOT clicked (read-only).`,
      screenshot: shot,
      consoleErrors,
    })
  })

  test('Suggestions route removed (404)', async ({ page }, testInfo) => {
    const consoleErrors = collectConsoleErrors(page)
    const checks: Check[] = []

    const response = await page.goto('/admin/suggestions')
    const statusCode = response?.status() ?? 0
    await check(checks, 'GET /admin/suggestions returns 404', () => statusCode === 404)

    record(testInfo, {
      group: GROUP,
      feature: 'Suggestions removed',
      route: '/admin/suggestions',
      checks,
      notes: `Response status was ${statusCode}.`,
      consoleErrors,
    })
  })
})
