import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { LoginForms } from './LoginForms'

// The server actions redirect, which is not meaningful in jsdom — stub them so
// the component renders in isolation. Their tos_accepted validation is covered
// by actions.test.ts.
vi.mock('./actions', () => ({
  signInWithEmail: vi.fn(),
  signInWithGoogle: vi.fn(),
  signInWithKimp: vi.fn(),
}))

/**
 * Regression guard: sign-in buttons must never be gated behind an explicit
 * terms checkbox.
 *
 * That checkbox disabled every button until ticked — the single largest point
 * of signup friction. Consent is now implied by continuing, with the terms +
 * privacy notice rendered below the form. The server still validates
 * `tos_accepted === '1'` as defense-in-depth, so the hidden field must keep
 * being submitted.
 */
describe('LoginForms consent handling', () => {
  it('enables sign-in immediately, with no checkbox to tick first', () => {
    render(<LoginForms next="/studio" />)

    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Continue with Google/i })).toBeEnabled()
    expect(screen.getByRole('button', { name: /Sign in with email/i })).toBeEnabled()
  })

  it('still submits tos_accepted=1 so the server-side check passes', () => {
    const { container } = render(<LoginForms next="/studio" />)

    const hidden = container.querySelectorAll<HTMLInputElement>('input[name="tos_accepted"]')
    expect(hidden.length).toBeGreaterThan(0)
    for (const field of hidden) {
      expect(field.value).toBe('1')
    }
  })
})
