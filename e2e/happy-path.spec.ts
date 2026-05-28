/**
 * Happy-path navigation through the consumer flow.
 *
 * Pre-req: MOCK_TRENDS=true so authed pages render + result-* mock ids resolve.
 *
 * This is intentionally a "click around without crashing" smoke — not a
 * synthetic full generation. The Edge Function path remains blocked on real
 * Gemini + Supabase Storage which mock mode does not stand in for.
 */
import { test, expect } from '@playwright/test'

test('happy path: home → trend → login → creations → settings → result', async ({ page }) => {
  // 1. Home renders, shows trend cards
  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  await expect(page.getByText(/Make the trend/i)).toBeVisible()

  // 2. Click first trend card → trend page
  await page.getByRole('link', { name: /Ghibli|Pixar|Anime|Vintage|Cyberpunk/i }).first().click()
  await expect(page).toHaveURL(/\/trend\//)
  await expect(page.getByRole('heading', { name: /Make yours/i })).toBeVisible()

  // 3. Back to home → login
  await page.getByRole('link', { name: /All trends/i }).click()
  await expect(page).toHaveURL('/')

  await page.goto('/login')
  await expect(page.getByRole('heading', { name: /Welcome/i })).toBeVisible()
  await expect(page.getByRole('button', { name: /Continue with Google/i })).toBeVisible()
  await expect(page.getByRole('button', { name: /Send magic link/i })).toBeVisible()

  // 4. Creations
  await page.goto('/me/creations')
  await expect(page.getByRole('heading', { name: /creations/i })).toBeVisible()

  // 5. Settings
  await page.goto('/me/settings')
  await expect(page.getByRole('heading', { name: /Settings/i })).toBeVisible()
  await expect(page.getByText(/Your quota/i)).toBeVisible()
  await expect(page.getByText(/Buy credits/i)).toBeVisible()

  // 6. Result (mock-completed)
  await page.goto('/result/mock-completed')
  await expect(page.getByRole('heading', { name: /fresh off the model/i })).toBeVisible()
  await expect(page.getByRole('link', { name: /Download/i })).toBeVisible()

  // 7. Result (mock-processing) — verifies the loading state renders
  await page.goto('/result/mock-processing')
  await expect(page.getByRole('heading', { name: /Cooking your/i })).toBeVisible()
})
