/**
 * Regression tests for the anonymous result poller.
 *
 * THE BUG: the poller refreshed on any status `!== 'pending'`. The Edge
 * Function sets `processing` the instant it claims the row, but the result page
 * renders neither its "ready" nor its "failed" branch for that status — so the
 * poller refreshed into the same spinner and stopped polling, stranding the
 * visitor on it permanently. Only terminal statuses should end the poll.
 */

import { render, cleanup } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const refresh = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }))

import { AnonymousStatusPoller } from './AnonymousStatusPoller'

const ID = '11111111-1111-1111-1111-111111111111'

function mockStatus(status: string) {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ status }) }))
  )
}

/** Advance fake timers and let the fetch promise chain settle. */
async function tick(ms: number) {
  await vi.advanceTimersByTimeAsync(ms)
}

beforeEach(() => {
  vi.useFakeTimers()
  refresh.mockClear()
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('AnonymousStatusPoller', () => {
  it('does NOT refresh while the row is still pending', async () => {
    mockStatus('pending')
    render(<AnonymousStatusPoller id={ID} />)

    await tick(10_000)

    expect(refresh).not.toHaveBeenCalled()
  })

  it('does NOT refresh on `processing` — it is not a terminal state', async () => {
    mockStatus('processing')
    render(<AnonymousStatusPoller id={ID} />)

    await tick(10_000)

    // This is the regression: `processing` used to end the poll and leave the
    // visitor watching a spinner that could never resolve.
    expect(refresh).not.toHaveBeenCalled()
  })

  it('refreshes once the row completes', async () => {
    mockStatus('completed')
    render(<AnonymousStatusPoller id={ID} />)

    await tick(3_500)

    expect(refresh).toHaveBeenCalled()
  })

  it('refreshes on failure so the page can show the error branch', async () => {
    mockStatus('failed')
    render(<AnonymousStatusPoller id={ID} />)

    await tick(3_500)

    expect(refresh).toHaveBeenCalled()
  })

  it('stops polling after a terminal status (no repeat refreshes)', async () => {
    mockStatus('completed')
    render(<AnonymousStatusPoller id={ID} />)

    await tick(30_000)

    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('gives up after the hard timeout instead of polling forever', async () => {
    mockStatus('processing')
    render(<AnonymousStatusPoller id={ID} />)

    await tick(185_000)

    // A worker that died leaves the row non-terminal; the timeout refreshes
    // once so the page can render whatever the sweep left behind.
    expect(refresh).toHaveBeenCalledTimes(1)
  })
})
