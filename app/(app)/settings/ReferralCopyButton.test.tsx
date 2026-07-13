import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'

// vi.mock is hoisted above any top-level const, so the mock factory references
// must come from vi.hoisted() to be available before initialization.
const toastMocks = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
}))

vi.mock('sonner', () => ({
  toast: toastMocks,
}))

// Import after vi.mock so the SUT picks up the mocked module.
import { ReferralCopyButton } from './ReferralCopyButton'

const REFERRAL_URL = 'https://trendly.app/?ref=a1b2c3d4'

beforeEach(() => {
  vi.useFakeTimers()
  toastMocks.success.mockReset()
  toastMocks.error.mockReset()
})

afterEach(() => {
  vi.useRealTimers()
  cleanup()
})

function installClipboard(impl: (text: string) => Promise<void>) {
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: vi.fn(impl) },
  })
  return navigator.clipboard.writeText as ReturnType<typeof vi.fn>
}

describe('ReferralCopyButton', () => {
  it('renders the "Copy" label by default', () => {
    installClipboard(async () => {})
    render(<ReferralCopyButton url={REFERRAL_URL} />)
    expect(screen.getByRole('button', { name: /copy/i })).toBeInTheDocument()
  })

  it('writes the prop URL to the clipboard when clicked', async () => {
    const writeText = installClipboard(async () => {})
    render(<ReferralCopyButton url={REFERRAL_URL} />)
    await act(async () => {
      fireEvent.click(screen.getByRole('button'))
    })
    expect(writeText).toHaveBeenCalledWith(REFERRAL_URL)
  })

  it('fires a success toast on a successful copy', async () => {
    installClipboard(async () => {})
    render(<ReferralCopyButton url={REFERRAL_URL} />)
    await act(async () => {
      fireEvent.click(screen.getByRole('button'))
    })
    expect(toastMocks.success).toHaveBeenCalledWith('Referral link copied.')
    expect(toastMocks.error).not.toHaveBeenCalled()
  })

  it('flips the label to "Copied" right after a successful copy', async () => {
    installClipboard(async () => {})
    render(<ReferralCopyButton url={REFERRAL_URL} />)
    await act(async () => {
      fireEvent.click(screen.getByRole('button'))
    })
    expect(screen.getByRole('button', { name: /copied/i })).toBeInTheDocument()
  })

  it('reverts the label back to "Copy" after the 1800ms timeout', async () => {
    installClipboard(async () => {})
    render(<ReferralCopyButton url={REFERRAL_URL} />)
    await act(async () => {
      fireEvent.click(screen.getByRole('button'))
    })
    expect(screen.getByRole('button', { name: /copied/i })).toBeInTheDocument()
    await act(async () => {
      vi.advanceTimersByTime(1800)
    })
    expect(screen.getByRole('button', { name: /^copy$/i })).toBeInTheDocument()
  })

  it('fires an error toast and stays on "Copy" when clipboard.writeText rejects', async () => {
    installClipboard(async () => {
      throw new Error('denied')
    })
    render(<ReferralCopyButton url={REFERRAL_URL} />)
    await act(async () => {
      fireEvent.click(screen.getByRole('button'))
    })
    expect(toastMocks.error).toHaveBeenCalledWith('Could not copy — long-press to copy manually.')
    expect(toastMocks.success).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: /^copy$/i })).toBeInTheDocument()
  })
})
