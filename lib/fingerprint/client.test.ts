import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockGet = vi.fn(() => Promise.resolve({ visitorId: 'visitor-abc' }))
const mockLoad = vi.fn(() => Promise.resolve({ get: mockGet }))

vi.mock('@fingerprintjs/fingerprintjs', () => ({
  load: mockLoad,
}))

describe('getFingerprintHash', () => {
  beforeEach(() => {
    vi.resetModules()
    mockLoad.mockClear()
    mockGet.mockClear()
  })

  it('returns a 64-char hex SHA-256 digest', async () => {
    const { getFingerprintHash } = await import('./client')
    const hash = await getFingerprintHash()
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('is deterministic for the same visitor id', async () => {
    const { getFingerprintHash } = await import('./client')
    const first = await getFingerprintHash()
    const second = await getFingerprintHash()
    expect(first).toBe(second)
  })

  it('only loads the FingerprintJS agent once across multiple calls', async () => {
    const { getFingerprintHash } = await import('./client')
    await getFingerprintHash()
    await getFingerprintHash()
    expect(mockLoad).toHaveBeenCalledTimes(1)
    expect(mockGet).toHaveBeenCalledTimes(2)
  })
})
