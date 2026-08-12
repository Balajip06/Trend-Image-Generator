import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Regression guard for the beta-gate error-copy bug.
 *
 * Every `isEmailAllowedToLogin()` rejection used to redirect to
 * `?error=invalid_credentials`, which renders "Email or password is incorrect."
 * On the Google and KIMP SSO paths there is no password at all, so testers were
 * told to fix a credential that was never wrong — costing hours of misdirected
 * debugging before the real cause (their email not being on the allowlist) was
 * found.
 *
 * This asserts on source text rather than behaviour on purpose: the invariant is
 * "no allowlist rejection anywhere emits password-specific copy", and that must
 * hold for every current and future call site, including the ones with no test
 * harness of their own.
 */
const REPO_ROOT = join(__dirname, '..', '..')

const ALLOWLIST_REJECTION_SITES = [
  'app/auth/callback/route.ts',
  'app/auth/kimp/callback/route.ts',
  'app/(auth)/login/actions.ts',
]

function readSource(relPath: string): string {
  return readFileSync(join(REPO_ROOT, relPath), 'utf8')
}

/**
 * Lines forming each `isEmailAllowedToLogin(...)` guard block plus its redirect.
 * Skips the `import` line, which also mentions the symbol but carries no
 * redirect — matching it produced a test that failed for the wrong reason.
 */
function allowlistGuardBlocks(source: string): string[] {
  const lines = source.split('\n')
  const blocks: string[] = []
  lines.forEach((line, i) => {
    const isGuard = line.includes('isEmailAllowedToLogin') && /^\s*if\s*\(/.test(line)
    if (isGuard) {
      blocks.push(lines.slice(i, i + 6).join('\n'))
    }
  })
  return blocks
}

describe('allowlist rejection error copy', () => {
  it.each(ALLOWLIST_REJECTION_SITES)('%s rejects with not_invited, not a password error', (rel) => {
    const blocks = allowlistGuardBlocks(readSource(rel))
    expect(blocks.length).toBeGreaterThan(0)
    for (const block of blocks) {
      expect(block).toContain('error=not_invited')
      expect(block).not.toContain('error=invalid_credentials')
    }
  })

  it('keeps the genuine wrong-password path generic to prevent enumeration', () => {
    const source = readSource('app/(auth)/login/actions.ts')
    // The final redirect after a failed signInWithPassword must stay generic —
    // distinguishing "no such account" from "wrong password" leaks which emails
    // are registered.
    expect(source).toContain("redirect('/login?error=invalid_credentials')")
  })

  it('ships user-facing copy for not_invited', () => {
    const source = readSource('app/(auth)/login/page.tsx')
    expect(source).toContain('not_invited:')
    // Must not fall through to the generic "Sign in failed" fallback.
    const match = source.match(/not_invited: *(['"`])([\s\S]*?)\1/)
    expect(match?.[2] ?? '').not.toBe('')
  })
})
