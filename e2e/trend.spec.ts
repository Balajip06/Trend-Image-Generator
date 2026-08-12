import { expect, test } from '@playwright/test'

test.describe('Trend page', () => {
  test('labels the FAQ section in full', async ({ page }) => {
    await page.goto('/trend/anime-portrait')
    // Was a bare "Questions" — the full label is what users and SEO expect.
    await expect(page.getByRole('heading', { name: 'Frequently Asked Questions' })).toBeVisible()
  })

  test('renders the FAQ accordion under the heading', async ({ page }) => {
    await page.goto('/trend/anime-portrait')
    const faq = page.getByRole('heading', { name: 'Frequently Asked Questions' })
    await expect(faq).toBeVisible()
    await expect(page.getByRole('button').filter({ hasText: /\?$/ }).first()).toBeVisible()
  })
})
