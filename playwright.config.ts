import { defineConfig, devices } from '@playwright/test'

const PORT = 3000
const baseURL = `http://localhost:${PORT}`

const VISUAL_GLOB = /visual-.*\.spec\.ts/
// The e2e/status/* sweep is a local diagnostic (needs a MOCK_TRENDS server +
// live Supabase for the admin pages). CI's e2e job has no backend, so skip it
// by default; opt in with `RUN_STATUS=true pnpm exec playwright test e2e/status`.
const STATUS_GLOB = /[\\/]status[\\/]/

// Visual baseline shoots need MOCK_TRENDS=true + are local/manual only.
// Default `pnpm exec playwright test` (including CI) skips them; opt in with
// `RUN_VISUAL_BASELINE=true pnpm exec playwright test`.
const visualEnabled = process.env.RUN_VISUAL_BASELINE === 'true'
const statusEnabled = process.env.RUN_STATUS === 'true'

// Functional projects always skip visual shoots, and skip the status sweep
// unless RUN_STATUS=true (so it stays runnable on demand but never in CI).
const FUNCTIONAL_IGNORE = statusEnabled ? [VISUAL_GLOB] : [VISUAL_GLOB, STATUS_GLOB]

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [['html'], ['github']] : 'html',
  use: {
    baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    // Functional E2E suites — exclude visual baseline shoots
    { name: 'chromium', testIgnore: FUNCTIONAL_IGNORE, use: { ...devices['Desktop Chrome'] } },
    { name: 'webkit', testIgnore: FUNCTIONAL_IGNORE, use: { ...devices['Desktop Safari'] } },
    { name: 'mobile-chrome', testIgnore: FUNCTIONAL_IGNORE, use: { ...devices['Pixel 7'] } },
    { name: 'mobile-safari', testIgnore: FUNCTIONAL_IGNORE, use: { ...devices['iPhone 14'] } },

    // Visual baseline shoots — only run visual-*.spec.ts, only when
    // RUN_VISUAL_BASELINE=true. Each project pins viewport + colorScheme so
    // screenshots are deterministic across runs.
    ...(visualEnabled
      ? [
          {
            name: 'visual-desktop-light',
            testMatch: VISUAL_GLOB,
            use: {
              ...devices['Desktop Chrome'],
              viewport: { width: 1280, height: 800 },
              colorScheme: 'light' as const,
            },
          },
          {
            name: 'visual-desktop-dark',
            testMatch: VISUAL_GLOB,
            use: {
              ...devices['Desktop Chrome'],
              viewport: { width: 1280, height: 800 },
              colorScheme: 'dark' as const,
            },
          },
          {
            name: 'visual-mobile-light',
            testMatch: VISUAL_GLOB,
            use: {
              ...devices['iPhone 14'],
              colorScheme: 'light' as const,
            },
          },
          {
            name: 'visual-mobile-dark',
            testMatch: VISUAL_GLOB,
            use: {
              ...devices['iPhone 14'],
              colorScheme: 'dark' as const,
            },
          },
        ]
      : []),
  ],
  webServer: {
    command: 'pnpm dev',
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
})
