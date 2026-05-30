import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { QuotaChip } from './QuotaChip'

describe('QuotaChip', () => {
  it('shows credits count when credits > 0', () => {
    render(<QuotaChip freeUsedThisWeek={3} creditsBalance={42} />)
    expect(screen.getByText(/42/)).toBeInTheDocument()
    expect(screen.getByText(/credit/i)).toBeInTheDocument()
  })

  it('shows free-left count when no credits and quota available', () => {
    render(<QuotaChip freeUsedThisWeek={2} creditsBalance={0} />)
    expect(screen.getByText(/3 free left/i)).toBeInTheDocument()
  })

  it('shows warning when free quota exhausted and no credits', () => {
    render(<QuotaChip freeUsedThisWeek={5} creditsBalance={0} />)
    expect(screen.getByText(/out of free/i)).toBeInTheDocument()
  })

  it('has sr-only context label', () => {
    render(<QuotaChip freeUsedThisWeek={2} creditsBalance={0} />)
    expect(screen.getByText(/free generations:/i)).toBeInTheDocument()
  })

  it('uses credits display when both credits and free remain', () => {
    render(<QuotaChip freeUsedThisWeek={1} creditsBalance={10} />)
    expect(screen.getByText(/10/)).toBeInTheDocument()
    expect(screen.queryByText(/free left/i)).not.toBeInTheDocument()
  })
})
