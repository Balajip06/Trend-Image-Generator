import { afterEach, beforeEach, describe, expect, it } from 'vitest'

interface Counts {
  impressions: number
  clicks: number
}

declare global {
  var __trendEventStore: Map<string, Counts> | undefined
}

async function loadFresh() {
  // The store hangs off globalThis so it can survive Next's per-route module
  // re-eval. Clearing the global + the Vitest module cache gives each test a
  // pristine baseline.
  globalThis.__trendEventStore = undefined
  const mod = await import('./event-store')
  return mod
}

beforeEach(() => {
  globalThis.__trendEventStore = undefined
})

afterEach(() => {
  globalThis.__trendEventStore = undefined
})

describe('event-store baseline', () => {
  it('returns a non-zero deterministic count for a given slug', async () => {
    const { getCounts } = await loadFresh()
    const a = getCounts('ghibli-portrait')
    expect(a.impressions).toBeGreaterThan(0)
    expect(a.clicks).toBeGreaterThanOrEqual(0)
  })

  it('is deterministic — same slug yields same baseline across loads', async () => {
    const first = await loadFresh()
    const a = first.getCounts('ghibli-portrait')
    const second = await loadFresh()
    const b = second.getCounts('ghibli-portrait')
    expect(b).toEqual(a)
  })

  it('different slugs yield different baselines', async () => {
    const { getCounts } = await loadFresh()
    const a = getCounts('ghibli-portrait')
    const b = getCounts('cyberpunk-neon')
    expect(a.impressions).not.toEqual(b.impressions)
  })

  it('CTR for any baseline is between 6% and 24%', async () => {
    const { getCounts } = await loadFresh()
    for (const slug of ['ghibli-portrait', 'anime-portrait', 'lego-minifigure', 'y2k-digicam-flash']) {
      const c = getCounts(slug)
      const ctr = c.clicks / c.impressions
      expect(ctr).toBeGreaterThanOrEqual(0.06)
      expect(ctr).toBeLessThanOrEqual(0.24)
    }
  })
})

describe('recordEvent', () => {
  it('increments impressions by exactly 1', async () => {
    const { getCounts, recordEvent } = await loadFresh()
    const before = getCounts('test-slug').impressions
    recordEvent('test-slug', 'impression')
    expect(getCounts('test-slug').impressions).toBe(before + 1)
  })

  it('increments clicks by exactly 1', async () => {
    const { getCounts, recordEvent } = await loadFresh()
    const before = getCounts('test-slug').clicks
    recordEvent('test-slug', 'click_generate')
    expect(getCounts('test-slug').clicks).toBe(before + 1)
  })

  it('records do not leak across slugs', async () => {
    const { getCounts, recordEvent } = await loadFresh()
    const otherBefore = getCounts('other-slug')
    recordEvent('test-slug', 'impression')
    expect(getCounts('other-slug')).toEqual(otherBefore)
  })
})

describe('getCountsBatch', () => {
  it('returns a Map keyed on each requested slug', async () => {
    const { getCountsBatch } = await loadFresh()
    const slugs = ['a', 'b', 'c']
    const map = getCountsBatch(slugs)
    expect(map.size).toBe(3)
    for (const s of slugs) {
      expect(map.has(s)).toBe(true)
    }
  })

  it('returns the same counts as getCounts for each slug', async () => {
    const { getCounts, getCountsBatch } = await loadFresh()
    const slugs = ['x', 'y']
    const map = getCountsBatch(slugs)
    expect(map.get('x')).toEqual(getCounts('x'))
    expect(map.get('y')).toEqual(getCounts('y'))
  })
})

describe('getOverall', () => {
  it('sums impressions + clicks across all requested slugs', async () => {
    const { getCounts, getOverall } = await loadFresh()
    const slugs = ['one', 'two', 'three']
    const expected = slugs.reduce(
      (acc, s) => {
        const c = getCounts(s)
        acc.impressions += c.impressions
        acc.clicks += c.clicks
        return acc
      },
      { impressions: 0, clicks: 0 }
    )
    expect(getOverall(slugs)).toEqual(expected)
  })

  it('returns zeros for empty input', async () => {
    const { getOverall } = await loadFresh()
    expect(getOverall([])).toEqual({ impressions: 0, clicks: 0 })
  })

  it('reflects recorded events', async () => {
    const { getOverall, recordEvent } = await loadFresh()
    const before = getOverall(['a', 'b'])
    recordEvent('a', 'impression')
    recordEvent('b', 'click_generate')
    const after = getOverall(['a', 'b'])
    expect(after.impressions).toBe(before.impressions + 1)
    expect(after.clicks).toBe(before.clicks + 1)
  })
})

describe('globalThis persistence', () => {
  it('shares state across module loads in the same process', async () => {
    const first = await import('./event-store')
    first.recordEvent('shared-slug', 'impression')
    const before = first.getCounts('shared-slug').impressions

    // Force a re-import — should rebind to the same globalThis store.
    const second = await import('./event-store')
    expect(second.getCounts('shared-slug').impressions).toBe(before)
  })
})
