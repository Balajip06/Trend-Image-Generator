import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

// ── Module-level mocks ────────────────────────────────────────────────────
// sonner toast — pure side-effect, capture call counts only.
vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}))

// web-share helpers — stub each so we can assert call args + control return values.
vi.mock('@/lib/share/web-share', () => ({
  shareNative: vi.fn(async () => ({ ok: true, channel: 'web_share' })),
  buildTwitterShareUrl: vi.fn(
    (text: string, url: string) =>
      `https://x.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`
  ),
  buildWhatsappShareUrl: vi.fn(
    (text: string, url: string) => `https://wa.me/?text=${text}%20${url}`
  ),
  copyToClipboard: vi.fn(async () => ({ ok: true, channel: 'copy_link' })),
  isWebShareSupported: vi.fn(() => true),
}))

// analytics — track is the only call site under test.
vi.mock('@/lib/analytics/client', () => ({
  analytics: { track: vi.fn() },
  EVENTS: { SHARE_CLICKED: 'share_clicked' },
}))

// Import AFTER mocks so the SUT picks them up.
import { ShareBurst } from './ShareBurst'
import { toast } from 'sonner'
import {
  buildTwitterShareUrl,
  buildWhatsappShareUrl,
  copyToClipboard,
  isWebShareSupported,
  shareNative,
} from '@/lib/share/web-share'
import { analytics, EVENTS } from '@/lib/analytics/client'

const baseProps = {
  trendSlug: 'glow-up',
  trendTitle: 'Glow Up',
  outputImageUrl: 'https://cdn.example.com/result.jpg',
  referralCode: null,
}

beforeEach(() => {
  vi.clearAllMocks()
  // Default: web share supported, copy + share succeed.
  ;(isWebShareSupported as ReturnType<typeof vi.fn>).mockReturnValue(true)
  ;(copyToClipboard as ReturnType<typeof vi.fn>).mockResolvedValue({
    ok: true,
    channel: 'copy_link',
  })
  ;(shareNative as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, channel: 'web_share' })
  // Predictable fetch — returns a blob for native share.
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, blob: async () => new Blob(['fake'], { type: 'image/jpeg' }) }))
  )
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

// Find the native-share tile (label="Share", sub="Native") — disambiguates from
// the section heading "Share" that also renders as text.
function findNativeShareTile(): HTMLElement | null {
  const matches = screen.queryAllByText('Share')
  for (const el of matches) {
    const tile = el.closest('button, a')
    if (tile) return tile as HTMLElement
  }
  return null
}

describe('ShareBurst', () => {
  it('renders all 5 tiles (native + X + WhatsApp + IG + Copy) when web share is supported', () => {
    render(<ShareBurst {...baseProps} />)
    expect(screen.getByText('X / Twitter')).toBeInTheDocument()
    expect(screen.getByText('WhatsApp')).toBeInTheDocument()
    expect(screen.getByText('Instagram')).toBeInTheDocument()
    expect(screen.getByText('Copy link')).toBeInTheDocument()
    // Native tile distinct from the section heading.
    expect(findNativeShareTile()).not.toBeNull()
  })

  it('drops the native share tile when web share is unsupported (4 tiles)', () => {
    ;(isWebShareSupported as ReturnType<typeof vi.fn>).mockReturnValue(false)
    render(<ShareBurst {...baseProps} />)
    // Only the section heading remains; no tile-shaped element.
    expect(findNativeShareTile()).toBeNull()
    expect(screen.getByText('X / Twitter')).toBeInTheDocument()
    expect(screen.getByText('WhatsApp')).toBeInTheDocument()
    expect(screen.getByText('Instagram')).toBeInTheDocument()
    expect(screen.getByText('Copy link')).toBeInTheDocument()
  })

  it('builds the Twitter share URL via buildTwitterShareUrl with text + siteUrl', () => {
    render(<ShareBurst {...baseProps} />)
    expect(buildTwitterShareUrl).toHaveBeenCalledWith(
      expect.stringContaining('Glow Up'),
      expect.stringContaining('/trend/glow-up')
    )
    const link = screen.getByText('X / Twitter').closest('a')
    expect(link?.getAttribute('href')).toContain('https://x.com/intent/tweet')
  })

  it('builds the WhatsApp share URL via buildWhatsappShareUrl', () => {
    render(<ShareBurst {...baseProps} />)
    expect(buildWhatsappShareUrl).toHaveBeenCalledWith(
      expect.stringContaining('Glow Up'),
      expect.stringContaining('/trend/glow-up')
    )
    const link = screen.getByText('WhatsApp').closest('a')
    expect(link?.getAttribute('href')).toContain('https://wa.me/')
  })

  it('tags the Twitter share URL with ?ref=<code> when a referral code is present', () => {
    render(<ShareBurst {...baseProps} referralCode="a1b2c3d4e5f6" />)
    expect(buildTwitterShareUrl).toHaveBeenCalledWith(
      expect.stringContaining('Glow Up'),
      expect.stringContaining('ref=a1b2c3d4e5f6')
    )
  })

  it('tags the WhatsApp share URL with ?ref=<code> when a referral code is present', () => {
    render(<ShareBurst {...baseProps} referralCode="a1b2c3d4e5f6" />)
    expect(buildWhatsappShareUrl).toHaveBeenCalledWith(
      expect.stringContaining('Glow Up'),
      expect.stringContaining('ref=a1b2c3d4e5f6')
    )
  })

  it('tags the copied link with ?ref=<code> when a referral code is present', async () => {
    render(<ShareBurst {...baseProps} referralCode="a1b2c3d4e5f6" />)
    const copyBtn = screen.getByText('Copy link').closest('button')
    await act(async () => {
      fireEvent.click(copyBtn as HTMLButtonElement)
    })
    expect(copyToClipboard).toHaveBeenCalledWith(expect.stringContaining('ref=a1b2c3d4e5f6'))
  })

  it('falls back to the plain trend URL (no ?ref=) when referralCode is null', () => {
    render(<ShareBurst {...baseProps} referralCode={null} />)
    expect(buildTwitterShareUrl).toHaveBeenCalledWith(expect.anything(), expect.not.stringContaining('ref='))
  })

  it('copy-link click calls copyToClipboard, fires analytics, toasts, flips to "Copied!" for ~1.8s', async () => {
    vi.useFakeTimers()
    try {
      render(<ShareBurst {...baseProps} />)
      const copyBtn = screen.getByText('Copy link').closest('button')
      expect(copyBtn).not.toBeNull()

      await act(async () => {
        fireEvent.click(copyBtn as HTMLButtonElement)
      })

      expect(copyToClipboard).toHaveBeenCalledWith(expect.stringContaining('/trend/glow-up'))
      expect(analytics.track).toHaveBeenCalledWith(EVENTS.SHARE_CLICKED, {
        trend_slug: 'glow-up',
        channel: 'copy_link',
      })
      expect(toast.success).toHaveBeenCalledWith('Link copied — ready to paste anywhere.')
      // Label switches to Copied! while the timeout is pending.
      expect(screen.getByText('Copied!')).toBeInTheDocument()

      // Advance past the 1.8s reset window.
      await act(async () => {
        vi.advanceTimersByTime(1800)
      })
      expect(screen.queryByText('Copied!')).toBeNull()
      expect(screen.getByText('Copy link')).toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })

  it('native share click calls shareNative with title/text/url/imageBlob and tracks on success', async () => {
    render(<ShareBurst {...baseProps} />)
    const shareBtn = findNativeShareTile()
    expect(shareBtn).not.toBeNull()

    await act(async () => {
      fireEvent.click(shareBtn as HTMLElement)
    })

    await waitFor(() => {
      expect(shareNative).toHaveBeenCalledTimes(1)
    })
    const callArg = (shareNative as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(callArg).toMatchObject({
      title: 'Glow Up',
      text: expect.stringContaining('Glow Up'),
      url: expect.stringContaining('/trend/glow-up'),
      imageFilename: 'trend-glow-up.jpg',
    })
    expect(callArg.imageBlob).toBeInstanceOf(Blob)
    expect(analytics.track).toHaveBeenCalledWith(EVENTS.SHARE_CLICKED, {
      trend_slug: 'glow-up',
      channel: 'web_share',
    })
  })

  it('native share still calls shareNative with undefined imageBlob when fetch fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('network blip')
      })
    )
    render(<ShareBurst {...baseProps} />)
    const shareBtn = findNativeShareTile()

    await act(async () => {
      fireEvent.click(shareBtn as HTMLElement)
    })

    await waitFor(() => {
      expect(shareNative).toHaveBeenCalledTimes(1)
    })
    const callArg = (shareNative as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(callArg.imageBlob).toBeUndefined()
  })

  it('does not fire analytics or show "Copied!" when copyToClipboard fails', async () => {
    ;(copyToClipboard as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      channel: 'copy_link',
      error: 'denied',
    })
    render(<ShareBurst {...baseProps} />)
    const copyBtn = screen.getByText('Copy link').closest('button')

    await act(async () => {
      fireEvent.click(copyBtn as HTMLButtonElement)
    })

    expect(analytics.track).not.toHaveBeenCalled()
    expect(toast.success).not.toHaveBeenCalled()
    expect(screen.queryByText('Copied!')).toBeNull()
  })

  it('ShareTile renders <a target="_blank" rel="noreferrer"> when href is provided', () => {
    render(<ShareBurst {...baseProps} />)
    const twitter = screen.getByText('X / Twitter').closest('a')
    expect(twitter).not.toBeNull()
    expect(twitter?.tagName).toBe('A')
    expect(twitter).toHaveAttribute('target', '_blank')
    expect(twitter).toHaveAttribute('rel', 'noreferrer')
  })

  it('ShareTile renders <button> when no href is provided (copy + native tiles)', () => {
    render(<ShareBurst {...baseProps} />)
    expect(screen.getByText('Copy link').closest('button')).not.toBeNull()
    const nativeTile = findNativeShareTile()
    expect(nativeTile?.tagName).toBe('BUTTON')
    // And the copy tile is NOT an anchor.
    expect(screen.getByText('Copy link').closest('a')).toBeNull()
  })

  it('fires analytics with channel=twitter when X tile is clicked', () => {
    render(<ShareBurst {...baseProps} />)
    fireEvent.click(screen.getByText('X / Twitter'))
    expect(analytics.track).toHaveBeenCalledWith(EVENTS.SHARE_CLICKED, {
      trend_slug: 'glow-up',
      channel: 'twitter',
    })
  })
})
