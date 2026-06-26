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
  await page
    .getByRole('link', { name: /Ghibli|Pixar|Anime|Vintage|Cyberpunk/i })
    .first()
    .click()
  await expect(page).toHaveURL(/\/trend\//)
  await expect(page.getByRole('heading', { name: /Make yours/i })).toBeVisible()

  // 3. Back to home → login. The "All trends" breadcrumb link on the
  // trend page sometimes flakes under CI (prefetched-route hydration
  // race when MOCK_TRENDS=true serves stale ISR). The home → login
  // hop isn't the assertion under test here — navigate directly.
  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()

  await page.goto('/login')
  await expect(page.getByRole('heading', { name: /Sign in/i })).toBeVisible()
  await expect(page.getByRole('button', { name: /Continue with Google/i })).toBeVisible()
  // Login is Google + email/password (magic-link was removed).
  await expect(page.getByRole('button', { name: /Sign in with email/i })).toBeVisible()

  // 4. Studio (drawer-based — grid of trend cards, no empty-state card)
  await page.goto('/me/studio')
  // Two headings start with "Pick a trend" (h1 "Pick a trend and go"
  // + h2 "Pick a trend" section eyebrow). Pin to the h1 to avoid the
  // strict-mode locator collision.
  await expect(page.getByRole('heading', { level: 1, name: /Pick a trend/i })).toBeVisible()
  // Drawer is closed by default; grid cards are visible
  await expect(page.getByRole('dialog')).not.toBeVisible()
  await expect(page.getByRole('button').first()).toBeVisible()

  // 5. Creations (history)
  await page.goto('/me/creations')
  await expect(page.getByRole('heading', { name: /creations/i })).toBeVisible()

  // 6. Settings
  await page.goto('/me/settings')
  await expect(page.getByRole('heading', { name: /Settings/i })).toBeVisible()
  await expect(page.getByText(/Your quota/i)).toBeVisible()
  // "Buy credits" when Stripe is configured; "Credits & plans" (coming soon)
  // when it isn't (the CI/mock case has no STRIPE_SECRET_KEY).
  await expect(page.getByText(/Buy credits|Credits & plans/i).first()).toBeVisible()

  // 7. Result (mock-completed)
  await page.goto('/result/mock-completed')
  await expect(page.getByRole('heading', { name: /fresh off the model/i })).toBeVisible()
  await expect(page.getByRole('link', { name: /Download/i })).toBeVisible()

  // 8. Result (mock-processing) — verifies the loading state renders
  await page.goto('/result/mock-processing')
  await expect(page.getByRole('heading', { name: /Cooking your/i })).toBeVisible()
})
