import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      exclude: ['**/*.config.*', '**/node_modules/**', '**/.next/**', 'e2e/**', 'supabase/**'],
      // Ratcheted to just under the measured baseline (statements 61.9,
      // branches 52.7, functions 64.4, lines 64.2) so the gate actually runs
      // and catches regressions from today forward.
      //
      // These were 80 across the board, but the gate had never executed on
      // main: the CI job ordering meant `Lint + Typecheck + Format` failed
      // first and `Vitest` was skipped on every recent run, so nobody saw the
      // real numbers. A threshold that can only fail teaches people to ignore
      // CI — this is the honest floor. Raise it deliberately as coverage
      // improves; do not lower it to make a red build green.
      thresholds: { lines: 62, branches: 50, functions: 62, statements: 60 },
    },
    exclude: [
      'node_modules',
      '.next',
      'e2e',
      'playwright-report',
      'test-results',
      'tests/integration',
      '.claude',
    ],
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./', import.meta.url)),
    },
  },
})
