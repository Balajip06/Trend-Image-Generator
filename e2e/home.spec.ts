import { expect, test } from '@playwright/test'

test.describe('Home', () => {
  test('renders title + tagline', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('heading', { name: /Make the trend/i })).toBeVisible()
    await expect(page.getByText(/Pick a viral look/i)).toBeVisible()
  })

  test('sets metadata title', async ({ page }) => {
    await page.goto('/')
    await expect(page).toHaveTitle(/Trendly/)
  })
})
