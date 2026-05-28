import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { ActiveBadge, EvalBadge, SourceBadge } from './StatusBadges'

afterEach(() => {
  cleanup()
})

describe('EvalBadge', () => {
  it('renders "passed" label with the emerald tone classes', () => {
    render(<EvalBadge status="passed" />)
    const badge = screen.getByText('passed')
    expect(badge).toBeInTheDocument()
    expect(badge.className).toContain('bg-emerald-500/15')
    expect(badge.className).toContain('text-emerald-700')
  })

  it('renders "failed" label with the destructive tone classes', () => {
    render(<EvalBadge status="failed" />)
    const badge = screen.getByText('failed')
    expect(badge).toBeInTheDocument()
    expect(badge.className).toContain('bg-destructive/15')
    expect(badge.className).toContain('text-destructive')
  })

  it('renders "untested" label with the muted tone classes', () => {
    render(<EvalBadge status="untested" />)
    const badge = screen.getByText('untested')
    expect(badge).toBeInTheDocument()
    expect(badge.className).toContain('bg-muted')
    expect(badge.className).toContain('text-muted-foreground')
  })

  it('merges a custom className onto the rendered badge', () => {
    render(<EvalBadge status="passed" className="extra-eval" />)
    expect(screen.getByText('passed')).toHaveClass('extra-eval')
  })
})

describe('ActiveBadge', () => {
  it('renders "live" with emerald tone when active={true}', () => {
    render(<ActiveBadge active={true} />)
    const badge = screen.getByText('live')
    expect(badge).toBeInTheDocument()
    expect(badge.className).toContain('bg-emerald-500/15')
    expect(badge.className).toContain('text-emerald-700')
  })

  it('renders "draft" with muted tone when active={false}', () => {
    render(<ActiveBadge active={false} />)
    const badge = screen.getByText('draft')
    expect(badge).toBeInTheDocument()
    expect(badge.className).toContain('bg-muted')
    expect(badge.className).toContain('text-muted-foreground')
  })

  it('merges a custom className onto the rendered badge', () => {
    render(<ActiveBadge active className="extra-active" />)
    expect(screen.getByText('live')).toHaveClass('extra-active')
  })
})

describe('SourceBadge', () => {
  it('renders "auto" with the brand-cyan accent classes', () => {
    render(<SourceBadge source="auto" />)
    const badge = screen.getByText('auto')
    expect(badge).toBeInTheDocument()
    expect(badge.className).toContain('text-[var(--brand-cyan)]')
    expect(badge.className).toContain('border-[var(--brand-cyan)]/30')
  })

  it('renders "user" with the neutral foreground tone', () => {
    render(<SourceBadge source="user" />)
    const badge = screen.getByText('user')
    expect(badge).toBeInTheDocument()
    expect(badge.className).toContain('text-foreground/70')
  })

  it('merges a custom className onto the rendered badge', () => {
    render(<SourceBadge source="user" className="extra-source" />)
    expect(screen.getByText('user')).toHaveClass('extra-source')
  })
})
