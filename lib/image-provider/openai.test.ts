import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://abcdef.supabase.co')

describe('openai generateImage', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.unstubAllEnvs()
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://abcdef.supabase.co')
  })

  it('returns mock PNG when OPENAI_API_KEY is not set', async () => {
    vi.stubEnv('OPENAI_API_KEY', '')
    const { generateImage } = await import('./openai')
    const result = await generateImage({
      model: 'gpt-image',
      prompt: 'test prompt',
      imageUrls: [],
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.modelUsed).toMatch(/^mock:/)
      expect(result.costUsd).toBe(0.04)
    }
  })

  it('maps failure reason correctly for safety block', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'sk-test-key')
    vi.stubEnv('OPENAI_IMAGE_MODEL', 'gpt-image-1')
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      text: async () =>
        JSON.stringify({
          error: { code: 'moderation_blocked', message: 'Policy violation' },
        }),
    })
    const { generateImage } = await import('./openai')
    const result = await generateImage({
      model: 'gpt-image',
      prompt: 'test',
      imageUrls: [],
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('safety')
  })

  it('maps 429 to transient', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'sk-test-key')
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      text: async () => 'rate limited',
    })
    const { generateImage } = await import('./openai')
    const result = await generateImage({ model: 'gpt-image', prompt: 'test', imageUrls: [] })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('transient')
  })

  it('never sends response_format — gpt-image-1 rejects it with 400 unknown_parameter', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'sk-test-key')
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ data: [{ b64_json: 'aGVsbG8=' }] }),
    })
    global.fetch = fetchMock
    const { generateImage } = await import('./openai')

    await generateImage({ model: 'gpt-image', prompt: 'test', imageUrls: [] })
    const jsonBody = JSON.parse(String(fetchMock.mock.calls[0][1].body))
    expect(jsonBody).not.toHaveProperty('response_format')

    fetchMock.mockClear()
    global.fetch = vi
      .fn()
      .mockImplementationOnce(async () => ({ ok: true, blob: async () => new Blob(['x']) }))
      .mockImplementationOnce(fetchMock)
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ data: [{ b64_json: 'aGVsbG8=' }] }),
    })
    await generateImage({ model: 'gpt-image', prompt: 'test', imageUrls: ['https://example.com/a.png'] })
    const formBody = fetchMock.mock.calls[0][1].body as FormData
    expect(formBody.has('response_format')).toBe(false)
  })
})
