import { describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { TrendGrid } from './TrendGrid'
import type { PublicTrend } from '@/lib/trends/repository'

// next/navigation mock
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn() }),
  useSearchParams: () => ({ get: () => null }),
}))

// next/image mock
vi.mock('next/image', () => ({
  default: ({ alt, src }: { alt: string; src: string }) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img alt={alt} src={src} />
  ),
}))

const makeTrend = (overrides?: Partial<PublicTrend>): PublicTrend => ({
  id: '1',
  slug: 'ghibli-portrait',
  title: 'Ghibli Portrait',
  description: 'Studio Ghibli style',
  thumbnail_url: null,
  sample_before_url: null,
  sample_after_url: 'https://example.com/after.jpg',
  aspect_ratio: '1:1',
  input_schema: { fields: [] },
  model: 'nano-banana',
  seo_title: null,
  seo_description: null,
  faq: [],
  display_order: 0,
  updated_at: '2026-01-01T00:00:00Z',
  activated_at: null,
  ...overrides,
})

describe('TrendGrid', () => {
  const defaultProps = {
    trends: [makeTrend()],
    freeUsedThisWeek: 2,
    initialSlug: null,
    onSelect: vi.fn(),
  }

  it('renders trend card with title', () => {
    render(<TrendGrid {...defaultProps} />)
    expect(screen.getByText('Ghibli Portrait')).toBeInTheDocument()
  })

  it('renders sample_after_url as the card image', () => {
    const { container } = render(<TrendGrid {...defaultProps} />)
    // alt="" makes image presentational (correct for decorative trend thumbs),
    // so query via DOM rather than role
    const img = container.querySelector('img')
    expect(img).not.toBeNull()
    expect(img).toHaveAttribute('src', 'https://example.com/after.jpg')
  })

  it('shows NEW badge for recently activated trend', () => {
    const recentTrend = makeTrend({ activated_at: new Date().toISOString() })
    render(<TrendGrid {...defaultProps} trends={[recentTrend]} />)
    expect(screen.getByText(/new/i)).toBeInTheDocument()
  })

  it('does not show NEW badge for old trend', () => {
    const oldTrend = makeTrend({ activated_at: '2020-01-01T00:00:00Z' })
    render(<TrendGrid {...defaultProps} trends={[oldTrend]} />)
    expect(screen.queryByText(/^new$/i)).not.toBeInTheDocument()
  })

  it('calls onSelect when card button clicked', () => {
    const onSelect = vi.fn()
    render(<TrendGrid {...defaultProps} onSelect={onSelect} />)
    fireEvent.click(screen.getByRole('button', { name: /ghibli portrait/i }))
    expect(onSelect).toHaveBeenCalledWith(defaultProps.trends[0])
  })

  it('marks selected card with aria-pressed="true"', () => {
    render(<TrendGrid {...defaultProps} initialSlug="ghibli-portrait" />)
    const selected = document.querySelector('[aria-pressed="true"]')
    expect(selected).not.toBeNull()
    expect(selected?.tagName).toBe('BUTTON')
  })

  it('renders a grid list (ul)', () => {
    const { container } = render(<TrendGrid {...defaultProps} />)
    expect(container.querySelector('ul')).not.toBeNull()
  })

  it('renders trend count label', () => {
    render(<TrendGrid {...defaultProps} />)
    expect(screen.getByText(/1 trend/i)).toBeInTheDocument()
  })
})
