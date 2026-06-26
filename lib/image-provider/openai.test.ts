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
          error: { code: 'content_policy_violation', message: 'Policy violation' },
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
})
