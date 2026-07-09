/**
 * Closed-testing gate. When LOGIN_ALLOWLIST_EMAILS is set, only the listed
 * emails may sign in — everywhere (consumer password, Google OAuth, KIMP SSO,
 * admin password). Unset the env var to reopen login to everyone.
 *
 * Reads process.env directly (not getServerEnv()) — this check must run even
 * when other required env vars are absent (e.g. unit tests), and must never
 * itself throw.
 */
export function isEmailAllowedToLogin(email: string): boolean {
  const raw = process.env.LOGIN_ALLOWLIST_EMAILS
  if (!raw) return true

  const allowlist = raw
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)

  return allowlist.includes(email.trim().toLowerCase())
}
