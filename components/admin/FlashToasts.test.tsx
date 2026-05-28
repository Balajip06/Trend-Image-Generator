import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'

// vi.mock is hoisted above any top-level const, so the mock factory references
// must come from vi.hoisted() to be available before initialization.
const toastMocks = vi.hoisted(() => {
  const base = vi.fn() as ReturnType<typeof vi.fn> & {
    success: ReturnType<typeof vi.fn>
    error: ReturnType<typeof vi.fn>
  }
  base.success = vi.fn()
  base.error = vi.fn()
  return base
})

const navMocks = vi.hoisted(() => ({
  pathname: '/admin/trends',
  params: new URLSearchParams(),
  replace: vi.fn(),
}))

vi.mock('sonner', () => ({
  toast: toastMocks,
}))

vi.mock('next/navigation', () => ({
  usePathname: () => navMocks.pathname,
  useSearchParams: () => navMocks.params,
  useRouter: () => ({ replace: navMocks.replace }),
}))

// Import after vi.mock so the SUT picks up the mocked modules.
import { FlashToasts } from './FlashToasts'

beforeEach(() => {
  toastMocks.mockReset()
  toastMocks.success.mockReset()
  toastMocks.error.mockReset()
  navMocks.pathname = '/admin/trends'
  navMocks.params = new URLSearchParams()
  navMocks.replace = vi.fn()
})

afterEach(() => {
  cleanup()
})

describe('FlashToasts', () => {
  it('returns null on render (no DOM output)', () => {
    const { container } = render(<FlashToasts flashes={[]} />)
    expect(container.firstChild).toBeNull()
  })

  it('fires toast.success when level=success and the matching key is present', () => {
    navMocks.params = new URLSearchParams('saved=1')
    render(
      <FlashToasts flashes={[{ key: 'saved', level: 'success', message: 'All saved.' }]} />,
    )
    expect(toastMocks.success).toHaveBeenCalledWith('All saved.')
    expect(toastMocks.error).not.toHaveBeenCalled()
  })

  it('fires toast.error when level=error and the matching key is present', () => {
    navMocks.params = new URLSearchParams('error=oops')
    render(<FlashToasts flashes={[{ key: 'error', level: 'error', message: 'Boom.' }]} />)
    expect(toastMocks.error).toHaveBeenCalledWith('Boom.')
    expect(toastMocks.success).not.toHaveBeenCalled()
  })

  it('fires the bare toast() (info channel) when level=info', () => {
    navMocks.params = new URLSearchParams('hint=1')
    render(<FlashToasts flashes={[{ key: 'hint', level: 'info', message: 'FYI.' }]} />)
    expect(toastMocks).toHaveBeenCalledWith('FYI.')
    expect(toastMocks.success).not.toHaveBeenCalled()
    expect(toastMocks.error).not.toHaveBeenCalled()
  })

  it('falls back to the URL-decoded param value when no static message is provided', () => {
    navMocks.params = new URLSearchParams('error=Hello%20World')
    render(<FlashToasts flashes={[{ key: 'error', level: 'error' }]} />)
    expect(toastMocks.error).toHaveBeenCalledWith('Hello World')
  })

  it('does nothing when the configured query param is absent', () => {
    navMocks.params = new URLSearchParams('') // no 'saved' key
    render(
      <FlashToasts flashes={[{ key: 'saved', level: 'success', message: 'All saved.' }]} />,
    )
    expect(toastMocks.success).not.toHaveBeenCalled()
    expect(navMocks.replace).not.toHaveBeenCalled()
  })

  it('dedupes re-renders with the same params via the internal firedRef', () => {
    navMocks.params = new URLSearchParams('saved=1')
    const { rerender } = render(
      <FlashToasts flashes={[{ key: 'saved', level: 'success', message: 'Saved.' }]} />,
    )
    expect(toastMocks.success).toHaveBeenCalledTimes(1)

    // Re-render with the same props/params — should NOT refire.
    rerender(<FlashToasts flashes={[{ key: 'saved', level: 'success', message: 'Saved.' }]} />)
    expect(toastMocks.success).toHaveBeenCalledTimes(1)
  })

  it('calls router.replace with the consumed param stripped from the URL', () => {
    navMocks.params = new URLSearchParams('saved=1&other=keep')
    render(<FlashToasts flashes={[{ key: 'saved', level: 'success', message: 'Saved.' }]} />)
    expect(navMocks.replace).toHaveBeenCalledWith('/admin/trends?other=keep', { scroll: false })
  })

  it('calls router.replace with the bare pathname when no params remain', () => {
    navMocks.params = new URLSearchParams('saved=1')
    render(<FlashToasts flashes={[{ key: 'saved', level: 'success', message: 'Saved.' }]} />)
    expect(navMocks.replace).toHaveBeenCalledWith('/admin/trends', { scroll: false })
  })

  it('fires multiple toasts in a single render when multiple flash keys are present', () => {
    navMocks.params = new URLSearchParams('saved=1&error=oops')
    render(
      <FlashToasts
        flashes={[
          { key: 'saved', level: 'success', message: 'Saved.' },
          { key: 'error', level: 'error', message: 'Bad.' },
        ]}
      />,
    )
    expect(toastMocks.success).toHaveBeenCalledWith('Saved.')
    expect(toastMocks.error).toHaveBeenCalledWith('Bad.')
    // Both params consumed → URL stripped clean.
    expect(navMocks.replace).toHaveBeenCalledWith('/admin/trends', { scroll: false })
  })

  it('decodes percent-encoded special characters from the URL value', () => {
    // %2F → '/', %26 → '&', '+' decodes to ' ' under URLSearchParams.get semantics.
    navMocks.params = new URLSearchParams('error=a%2Fb%26c+d')
    render(<FlashToasts flashes={[{ key: 'error', level: 'error' }]} />)
    expect(toastMocks.error).toHaveBeenCalledWith('a/b&c d')
  })
})
