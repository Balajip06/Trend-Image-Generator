import { describe, expect, it } from 'vitest'
import { GET, POST } from './route'

// Trend discovery is disabled (the admin Suggestions inbox it fed was removed).
// Both verbs must return 410 Gone and do no work.

describe('POST/GET /api/admin/run-trend-discovery — disabled', () => {
  it('POST returns 410 Gone', async () => {
    const res = await POST()
    expect(res.status).toBe(410)
    expect(await res.json()).toEqual(expect.objectContaining({ error: 'gone' }))
  })

  it('GET returns 410 Gone', async () => {
    const res = await GET()
    expect(res.status).toBe(410)
  })
})
