import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`)
  }),
}))

vi.mock('next/headers', () => ({
  headers: vi.fn(async () => new Headers({ 'x-forwarded-for': '1.2.3.4' })),
}))

let turnstileOk = true
vi.mock('@/lib/turnstile/verify', () => ({
  verifyTurnstile: vi.fn(async () => turnstileOk),
}))

// Controls per-test behaviour of the Supabase stub.
let signInWithPasswordResult: { error: { message: string } | null } = { error: null }
let signUpResult: { error: { message: string } | null } = { error: null }
let signInWithOAuthResult: {
  data: { url: string } | null
  error: { message: string } | null
} = { data: { url: 'https://accounts.google.com/test' }, error: null }

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    auth: {
      signInWithPassword: vi.fn(async () => signInWithPasswordResult),
      signUp: vi.fn(async () => signUpResult),
      signInWithOAuth: vi.fn(async () => signInWithOAuthResult),
    },
  })),
}))

import { signInWithEmail, signInWithGoogle } from './actions'

function lastRedirectUrl(err: unknown): string {
  if (err instanceof Error && err.message.startsWith('NEXT_REDIRECT:')) {
    return err.message.replace('NEXT_REDIRECT:', '')
  }
  throw err
}

function makeEmailForm(overrides: Partial<Record<string, string>> = {}): FormData {
  const fd = new FormData()
  fd.set('email', 'user@example.com')
  fd.set('password', 'password123')
  fd.set('next', '/')
  fd.set('turnstile_token', 'tok-ok')
  fd.set('tos_accepted', '1')
  for (const [k, v] of Object.entries(overrides)) {
    if (v === '') fd.delete(k)
    else fd.set(k, v as string)
  }
  return fd
}

function makeGoogleForm(overrides: Partial<Record<string, string>> = {}): FormData {
  const fd = new FormData()
  fd.set('next', '/')
  fd.set('turnstile_token', 'tok-ok')
  fd.set('tos_accepted', '1')
  for (const [k, v] of Object.entries(overrides)) {
    if (v === '') fd.delete(k)
    else fd.set(k, v as string)
  }
  return fd
}

beforeEach(() => {
  turnstileOk = true
  signInWithPasswordResult = { error: null }
  signUpResult = { error: null }
  signInWithOAuthResult = {
    data: { url: 'https://accounts.google.com/test' },
    error: null,
  }
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('signInWithEmail', () => {
  it('redirects to ?error=tos_required when checkbox is not checked', async () => {
    const form = makeEmailForm({ tos_accepted: '0' })
    try {
      await signInWithEmail(form)
    } catch (err) {
      expect(lastRedirectUrl(err)).toBe('/login?error=tos_required')
      return
    }
    throw new Error('redirect was not invoked')
  })

  it('redirects to ?error=tos_required when tos_accepted is absent entirely', async () => {
    const form = makeEmailForm({ tos_accepted: '' })
    try {
      await signInWithEmail(form)
    } catch (err) {
      expect(lastRedirectUrl(err)).toBe('/login?error=tos_required')
      return
    }
    throw new Error('redirect was not invoked')
  })

  it('redirects to ?error=invalid_email when email is malformed', async () => {
    const form = makeEmailForm({ email: 'not-an-email' })
    try {
      await signInWithEmail(form)
    } catch (err) {
      expect(lastRedirectUrl(err)).toBe('/login?error=invalid_email')
      return
    }
    throw new Error('redirect was not invoked')
  })

  it('redirects to ?error=password_too_short when password is under 8 chars', async () => {
    const form = makeEmailForm({ password: 'short' })
    try {
      await signInWithEmail(form)
    } catch (err) {
      expect(lastRedirectUrl(err)).toBe('/login?error=password_too_short')
      return
    }
    throw new Error('redirect was not invoked')
  })

  it('redirects to ?error=bot_check_failed when Turnstile rejects', async () => {
    turnstileOk = false
    try {
      await signInWithEmail(makeEmailForm())
    } catch (err) {
      expect(lastRedirectUrl(err)).toBe('/login?error=bot_check_failed')
      return
    }
    throw new Error('redirect was not invoked')
  })

  it('redirects to next on the happy path (returning user)', async () => {
    try {
      await signInWithEmail(makeEmailForm())
    } catch (err) {
      // next='/' normalises to /me/studio
      expect(lastRedirectUrl(err)).toBe('/me/studio')
      return
    }
    throw new Error('redirect was not invoked')
  })

  it('redirects to ?sent=1 for a new user (signUp succeeds)', async () => {
    signInWithPasswordResult = { error: { message: 'Invalid login credentials' } }
    // signUpResult defaults to { error: null } — new user, confirmation sent
    try {
      await signInWithEmail(makeEmailForm())
    } catch (err) {
      expect(lastRedirectUrl(err)).toBe('/login?sent=1')
      return
    }
    throw new Error('redirect was not invoked')
  })

  it('redirects to ?error=wrong_password when email is already registered', async () => {
    signInWithPasswordResult = { error: { message: 'Invalid login credentials' } }
    signUpResult = { error: { message: 'User already registered' } }
    try {
      await signInWithEmail(makeEmailForm())
    } catch (err) {
      expect(lastRedirectUrl(err)).toBe('/login?error=wrong_password')
      return
    }
    throw new Error('redirect was not invoked')
  })

  it('redirects to ?error=signup_failed when signUp returns an unexpected error', async () => {
    signInWithPasswordResult = { error: { message: 'Invalid login credentials' } }
    signUpResult = { error: { message: 'rate limited' } }
    try {
      await signInWithEmail(makeEmailForm())
    } catch (err) {
      expect(lastRedirectUrl(err)).toBe('/login?error=signup_failed')
      return
    }
    throw new Error('redirect was not invoked')
  })
})

describe('signInWithGoogle', () => {
  it('redirects to ?error=tos_required when checkbox is not checked', async () => {
    try {
      await signInWithGoogle(makeGoogleForm({ tos_accepted: '0' }))
    } catch (err) {
      expect(lastRedirectUrl(err)).toBe('/login?error=tos_required')
      return
    }
    throw new Error('redirect was not invoked')
  })

  it('redirects to ?error=bot_check_failed when Turnstile rejects', async () => {
    turnstileOk = false
    try {
      await signInWithGoogle(makeGoogleForm())
    } catch (err) {
      expect(lastRedirectUrl(err)).toBe('/login?error=bot_check_failed')
      return
    }
    throw new Error('redirect was not invoked')
  })

  it('redirects to the Supabase-issued OAuth URL on the happy path', async () => {
    try {
      await signInWithGoogle(makeGoogleForm())
    } catch (err) {
      expect(lastRedirectUrl(err)).toBe('https://accounts.google.com/test')
      return
    }
    throw new Error('redirect was not invoked')
  })

  it('redirects to ?error=oauth_failed when Supabase returns no URL', async () => {
    signInWithOAuthResult = { data: null, error: { message: 'no provider' } }
    try {
      await signInWithGoogle(makeGoogleForm())
    } catch (err) {
      expect(lastRedirectUrl(err)).toBe('/login?error=oauth_failed')
      return
    }
    throw new Error('redirect was not invoked')
  })
})
