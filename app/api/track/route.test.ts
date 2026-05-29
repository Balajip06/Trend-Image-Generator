import { afterEach, beforeEach, describe, expect, it } from 'vitest'

interface Counts {
  impressions: number
  clicks: number
}

declare global {
  var __trendEventStore: Map<string, Counts> | undefined
}

async function loadHandler() {
  globalThis.__trendEventStore = undefined
  return await import('./route')
}

beforeEach(() => {
  globalThis.__trendEventStore = undefined
})

afterEach(() => {
  globalThis.__trendEventStore = undefined
})

function makePost(body: unknown): Request {
  return new Request('http://localhost/api/track', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('POST /api/track', () => {
  it('returns 200 with ok:true on a valid impression', async () => {
    const { POST } = await loadHandler()
    const res = await POST(makePost({ trend_slug: 'ghibli-portrait', type: 'impression' }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ ok: true })
  })

  it('returns 200 with ok:true on a valid click_generate', async () => {
    const { POST } = await loadHandler()
    const res = await POST(makePost({ trend_slug: 'ghibli-portrait', type: 'click_generate' }))
    expect(res.status).toBe(200)
  })

  it('returns 400 on an unknown event type', async () => {
    const { POST } = await loadHandler()
    const res = await POST(makePost({ trend_slug: 'ghibli-portrait', type: 'invalid' }))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body).toEqual({ ok: false, error: 'invalid_body' })
  })

  it('returns 400 when trend_slug is missing', async () => {
    const { POST } = await loadHandler()
    const res = await POST(makePost({ type: 'impression' }))
    expect(res.status).toBe(400)
  })

  it('returns 400 when trend_slug is empty', async () => {
    const { POST } = await loadHandler()
    const res = await POST(makePost({ trend_slug: '', type: 'impression' }))
    expect(res.status).toBe(400)
  })

  it('returns 400 on malformed JSON', async () => {
    const { POST } = await loadHandler()
    const req = new Request('http://localhost/api/track', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'not-json',
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
  })

  it('actually increments the event store on success', async () => {
    const handler = await loadHandler()
    const store = await import('@/lib/analytics/event-store')
    const before = store.getCounts('test-slug').impressions
    await handler.POST(makePost({ trend_slug: 'test-slug', type: 'impression' }))
    expect(store.getCounts('test-slug').impressions).toBe(before + 1)
  })
})
