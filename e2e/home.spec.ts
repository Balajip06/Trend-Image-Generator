import { expect, test } from '@playwright/test'

test.describe('Home', () => {
  test('renders title + tagline', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('heading', { name: /Create your version of the/i })).toBeVisible()
    await expect(page.getByText(/turn it into a trending post/i)).toBeVisible()
  })

  test('sets metadata title', async ({ page }) => {
    await page.goto('/')
    await expect(page).toHaveTitle(/Trendly/)
  })

  test('hero offers a single CTA that jumps to the trend grid', async ({ page }) => {
    await page.goto('/')

    // Exactly one hero CTA — the old build had a second competing
    // "Try <trend>" / "Try one free" link pair.
    const cta = page.getByRole('link', { name: 'Browse trends' })
    await expect(cta).toHaveCount(1)
    await expect(cta).toHaveAttribute('href', '#trends')

    await cta.click()
    await expect(page).toHaveURL(/#trends$/)
  })

  test('trend grid clears the sticky header after the CTA jump', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('link', { name: 'Browse trends' }).click()

    // Smooth scrolling is async. Poll-until-true would pass mid-scroll (the
    // heading is trivially below the header before the jump lands), so wait for
    // scrollY to actually settle, then measure exactly once.
    await page.waitForFunction(() => window.scrollY > 100)
    const settled = await page.evaluate(
      () =>
        new Promise<number>((resolve) => {
          let last = -1
          let stable = 0
          const tick = () => {
            if (window.scrollY === last) {
              if (++stable >= 5) return resolve(window.scrollY)
            } else {
              stable = 0
              last = window.scrollY
            }
            requestAnimationFrame(tick)
          }
          requestAnimationFrame(tick)
        })
    )
    expect(settled, 'page should have scrolled to the grid').toBeGreaterThan(100)

    const headerBottom = await page
      .locator('header')
      .first()
      .evaluate((el) => el.getBoundingClientRect().bottom)
    const h2Top = await page
      .getByRole('heading', { name: 'Browse trends', level: 2 })
      .evaluate((el) => el.getBoundingClientRect().top)

    expect(
      h2Top,
      `grid heading (top ${h2Top}) must clear the sticky header (bottom ${headerBottom})`
    ).toBeGreaterThanOrEqual(headerBottom)
  })

  test('explains the process before the trend grid', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('heading', { name: 'From Photo to Trend in 3 Taps' })).toBeVisible()

    // DOM order, not visual position: how-it-works must precede the grid.
    const headings = await page.locator('main h2').allInnerTexts()
    const process = headings.findIndex((h) => /From Photo to Trend in 3 Taps/i.test(h))
    const grid = headings.findIndex((h) => /^Browse trends$/i.test(h.trim()))
    expect(process, 'process heading missing').toBeGreaterThanOrEqual(0)
    expect(grid, 'grid heading missing').toBeGreaterThanOrEqual(0)
    expect(process, 'how-it-works must come before the trend grid').toBeLessThan(grid)
  })

  // globals.css sets `scroll-behavior: smooth` for the CTA anchor jump. Without
  // this attribute the Next router also animates route-change scrolling, which
  // it warns about at runtime. Guard the opt-in so the pair can't drift apart.
  test('declares data-scroll-behavior so route changes still scroll instantly', async ({
    page,
  }) => {
    await page.goto('/')
    await expect(page.locator('html')).toHaveAttribute('data-scroll-behavior', 'smooth')
  })
})
