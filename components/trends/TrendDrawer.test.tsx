import { describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { TrendDrawer } from './TrendDrawer'
import type { PublicTrend } from '@/lib/trends/repository'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => ({ get: () => null }),
}))

vi.mock('@/components/trends/TrendRunner', () => ({
  TrendRunner: ({ trend }: { trend: PublicTrend }) => (
    <div data-testid="trend-runner">{trend.title}</div>
  ),
}))

const trend: PublicTrend = {
  id: '1',
  slug: 'ghibli-portrait',
  title: 'Ghibli Portrait',
  description: 'Studio Ghibli style',
  thumbnail_url: null,
  sample_before_url: null,
  sample_after_url: null,
  aspect_ratio: '1:1',
  input_schema: { fields: [] },
  model: 'nano-banana',
  seo_title: null,
  seo_description: null,
  faq: [],
  display_order: 0,
  updated_at: '2026-01-01T00:00:00Z',
  activated_at: null,
}

describe('TrendDrawer', () => {
  it('renders nothing when trend is null', () => {
    const { container } = render(
      <TrendDrawer trend={null} open={false} onOpenChange={vi.fn()} freeUsedThisWeek={2} />
    )
    expect(container.querySelector('[role="dialog"]')).toBeNull()
  })

  it('renders trend title when open', async () => {
    render(<TrendDrawer trend={trend} open={true} onOpenChange={vi.fn()} freeUsedThisWeek={2} />)
    await waitFor(() => {
      // Title appears in DialogTitle; getAllByText handles mock TrendRunner also printing it
      expect(screen.getAllByText('Ghibli Portrait').length).toBeGreaterThan(0)
    })
  })

  it('renders TrendRunner inside drawer', async () => {
    render(<TrendDrawer trend={trend} open={true} onOpenChange={vi.fn()} freeUsedThisWeek={2} />)
    await waitFor(() => {
      expect(screen.getByTestId('trend-runner')).toBeInTheDocument()
    })
  })

  it('has a visible close button with adequate label', async () => {
    render(<TrendDrawer trend={trend} open={true} onOpenChange={vi.fn()} freeUsedThisWeek={2} />)
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /close/i })).toBeInTheDocument()
    })
  })

  it('calls onOpenChange(false) when close button clicked', async () => {
    const onOpenChange = vi.fn()
    render(
      <TrendDrawer trend={trend} open={true} onOpenChange={onOpenChange} freeUsedThisWeek={2} />
    )
    await waitFor(() => screen.getByRole('button', { name: /close/i }))
    fireEvent.click(screen.getByRole('button', { name: /close/i }))
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('renders description when provided', async () => {
    render(<TrendDrawer trend={trend} open={true} onOpenChange={vi.fn()} freeUsedThisWeek={2} />)
    await waitFor(() => {
      expect(screen.getByText('Studio Ghibli style')).toBeInTheDocument()
    })
  })

  it('has aria-modal dialog role', async () => {
    render(<TrendDrawer trend={trend} open={true} onOpenChange={vi.fn()} freeUsedThisWeek={2} />)
    await waitFor(() => {
      expect(screen.getByRole('dialog')).toBeInTheDocument()
    })
  })
})
