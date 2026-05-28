import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

// AdminShell pulls in ThemeToggle which calls next-themes' useTheme. Mock it
// the same way ThemeToggle.test.tsx does so the component renders deterministically
// in jsdom (no ThemeProvider, no flashing).
const themeState: { resolvedTheme: string; setTheme: ReturnType<typeof vi.fn> } = {
  resolvedTheme: 'light',
  setTheme: vi.fn(),
}

vi.mock('next-themes', () => ({
  useTheme: () => themeState,
}))

// Import after vi.mock so the SUT picks up the mocked module.
import { AdminShell } from './AdminShell'

beforeEach(() => {
  themeState.resolvedTheme = 'light'
  themeState.setTheme = vi.fn()
})

afterEach(() => {
  cleanup()
})

describe('AdminShell', () => {
  it('renders the "Admin console" label and an INTERNAL badge', () => {
    render(
      <AdminShell>
        <p>child</p>
      </AdminShell>,
    )
    expect(screen.getByText('Admin console')).toBeInTheDocument()
    // Badge text is rendered lowercase but styled uppercase via CSS — match the raw text.
    expect(screen.getByText('internal')).toBeInTheDocument()
  })

  it('renders the brand Logo with the "Admin home" aria-label on its wrapping link', () => {
    render(
      <AdminShell>
        <p>child</p>
      </AdminShell>,
    )
    const adminHome = screen.getByRole('link', { name: 'Admin home' })
    expect(adminHome).toBeInTheDocument()
    expect(adminHome).toHaveAttribute('href', '/admin')
    // The Logo glyph is an inline svg inside this link.
    expect(adminHome.querySelector('svg')).not.toBeNull()
  })

  it('renders all 4 nav links with the correct hrefs', () => {
    render(
      <AdminShell>
        <p>child</p>
      </AdminShell>,
    )
    expect(screen.getByRole('link', { name: 'Trends' })).toHaveAttribute('href', '/admin/trends')
    expect(screen.getByRole('link', { name: 'Suggestions' })).toHaveAttribute(
      'href',
      '/admin/suggestions',
    )
    expect(screen.getByRole('link', { name: 'Audit' })).toHaveAttribute('href', '/admin/audit')
    expect(screen.getByRole('link', { name: '← App' })).toHaveAttribute('href', '/')
  })

  it('renders the ThemeToggle in the nav', () => {
    render(
      <AdminShell>
        <p>child</p>
      </AdminShell>,
    )
    // ThemeToggle exposes its button with one of these aria-labels depending on theme.
    expect(screen.getByRole('button', { name: /switch to (dark|light) mode/i })).toBeInTheDocument()
  })

  it('renders children inside the <main> content region', () => {
    render(
      <AdminShell>
        <p data-testid="child-marker">child payload</p>
      </AdminShell>,
    )
    const main = screen.getByRole('main')
    expect(main).toBeInTheDocument()
    expect(main.querySelector('[data-testid="child-marker"]')).not.toBeNull()
    expect(main.textContent).toContain('child payload')
  })

  it('marks the header as sticky at the top of the viewport', () => {
    const { container } = render(
      <AdminShell>
        <p>child</p>
      </AdminShell>,
    )
    const header = container.querySelector('header')
    expect(header).not.toBeNull()
    expect(header).toHaveClass('sticky')
    expect(header).toHaveClass('top-0')
  })
})
