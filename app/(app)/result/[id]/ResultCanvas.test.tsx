import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'

// jsdom can't render next/image natively (no real layout / fill prop handling).
// Stub it to a plain <img> so we can assert on the URL + alt text directly.
vi.mock('next/image', () => ({
  default: (props: Record<string, unknown>) => {
    const { src, alt, fill, priority, sizes, quality, placeholder, ...rest } = props as {
      src: string
      alt: string
      fill?: boolean
      priority?: boolean
      sizes?: string
      quality?: number
      placeholder?: string
    }
    void fill
    void priority
    void sizes
    void quality
    void placeholder
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt={alt} {...(rest as Record<string, unknown>)} />
  },
}))

import { ResultCanvas } from './ResultCanvas'

afterEach(() => {
  cleanup()
})

describe('ResultCanvas', () => {
  it('renders the <Image> with the output URL + alt=title when completed', () => {
    // Arrange / Act
    render(
      <ResultCanvas
        status="completed"
        outputImageUrl="https://cdn.example.com/result.jpg"
        errorMessage={null}
        attempts={1}
        title="Glow Up"
      />
    )

    // Assert
    const img = screen.getByRole('img', { name: 'Glow Up' })
    expect(img).toHaveAttribute('src', 'https://cdn.example.com/result.jpg')
  })

  it('defaults the frame to a square aspect ratio before the image loads', () => {
    render(
      <ResultCanvas
        status="completed"
        outputImageUrl="https://cdn.example.com/result.jpg"
        errorMessage={null}
        attempts={1}
        title="Glow Up"
      />
    )
    const figure = screen.getByRole('img', { name: 'Glow Up' }).closest('figure')
    expect(figure).toHaveStyle({ aspectRatio: '1' })
  })

  it('resizes the frame to the image\'s real aspect ratio on load (Gemini ignored the configured 1:1)', () => {
    render(
      <ResultCanvas
        status="completed"
        outputImageUrl="https://cdn.example.com/result.jpg"
        errorMessage={null}
        attempts={1}
        title="Glow Up"
      />
    )
    const img = screen.getByRole('img', { name: 'Glow Up' })
    Object.defineProperty(img, 'naturalWidth', { value: 842, configurable: true })
    Object.defineProperty(img, 'naturalHeight', { value: 1264, configurable: true })

    act(() => {
      fireEvent.load(img)
    })

    const figure = img.closest('figure')
    expect(figure).toHaveStyle({ aspectRatio: String(842 / 1264) })
  })

  it('falls back to the shimmer/gradient panel when completed but no outputImageUrl', () => {
    render(
      <ResultCanvas
        status="completed"
        outputImageUrl={null}
        errorMessage={null}
        attempts={1}
        title="Glow Up"
      />
    )

    expect(screen.queryByRole('img')).toBeNull()
    // Falls into the shimmer/queue branch — uses the queued subline.
    expect(screen.getByText(/Queued — starting in a moment/)).toBeInTheDocument()
  })

  it('renders the "Rendering pixels" subline for processing status', () => {
    render(
      <ResultCanvas
        status="processing"
        outputImageUrl={null}
        errorMessage={null}
        attempts={1}
        title="Glow Up"
      />
    )

    expect(screen.getByText(/Rendering pixels/)).toBeInTheDocument()
  })

  it('renders the "Queued" subline for pending status', () => {
    render(
      <ResultCanvas
        status="pending"
        outputImageUrl={null}
        errorMessage={null}
        attempts={0}
        title="Glow Up"
      />
    )

    expect(screen.getByText(/Queued — starting in a moment/)).toBeInTheDocument()
  })

  it('interpolates attempts into the "Auto-retrying" subline for failed_retryable status', () => {
    render(
      <ResultCanvas
        status="failed_retryable"
        outputImageUrl={null}
        errorMessage={null}
        attempts={2}
        title="Glow Up"
      />
    )

    expect(screen.getByText('Auto-retrying… attempt 2')).toBeInTheDocument()
  })

  it('renders the destructive panel with error message + refund reassurance for failed', () => {
    render(
      <ResultCanvas
        status="failed"
        outputImageUrl={null}
        errorMessage="Gemini timed out"
        attempts={3}
        title="Glow Up"
      />
    )

    expect(screen.getByText('Generation failed')).toBeInTheDocument()
    expect(screen.getByText('Gemini timed out')).toBeInTheDocument()
    expect(screen.getByText(/quota was refunded/)).toBeInTheDocument()
  })

  it('omits the error paragraph when failed without an errorMessage but keeps reassurance', () => {
    render(
      <ResultCanvas
        status="failed"
        outputImageUrl={null}
        errorMessage={null}
        attempts={3}
        title="Glow Up"
      />
    )

    expect(screen.getByText('Generation failed')).toBeInTheDocument()
    expect(screen.getByText(/quota was refunded/)).toBeInTheDocument()
    // No raw 'null' string leaks into the DOM.
    expect(screen.queryByText('null')).toBeNull()
  })

  it('ignores outputImageUrl when status is not completed (still shows shimmer)', () => {
    render(
      <ResultCanvas
        status="processing"
        outputImageUrl="https://cdn.example.com/should-not-show.jpg"
        errorMessage={null}
        attempts={1}
        title="Glow Up"
      />
    )

    expect(screen.queryByRole('img')).toBeNull()
    expect(screen.getByText(/Rendering pixels/)).toBeInTheDocument()
  })
})
