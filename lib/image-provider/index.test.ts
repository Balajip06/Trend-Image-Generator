import { afterEach, describe, expect, it, vi } from 'vitest'
import type { GenerateImageArgs, GenerateImageResult } from './types'

// Mock the two provider impls so we control ok/fail per model without network.
let geminiImpl: (args: GenerateImageArgs) => Promise<GenerateImageResult> = async () => ({
  ok: true,
  outputPng: new Uint8Array([1]),
  costUsd: 0.001,
  modelUsed: 'gemini-3.1-flash-image',
})
let openaiImpl: (args: GenerateImageArgs) => Promise<GenerateImageResult> = async () => ({
  ok: true,
  outputPng: new Uint8Array([1]),
  costUsd: 0.04,
  modelUsed: 'gpt-image-2',
})

vi.mock('./gemini', () => ({ generateImage: (a: GenerateImageArgs) => geminiImpl(a) }))
vi.mock('./openai', () => ({ generateImage: (a: GenerateImageArgs) => openaiImpl(a) }))

const { generateImageWithFallback, fallbackModelFor } = await import('./index')

const baseArgs = (model: GenerateImageArgs['model']): GenerateImageArgs => ({
  model,
  prompt: 'p',
  imageUrls: [],
})

afterEach(() => {
  geminiImpl = async () => ({
    ok: true,
    outputPng: new Uint8Array([1]),
    costUsd: 0.001,
    modelUsed: 'gemini-3.1-flash-image',
  })
  openaiImpl = async () => ({
    ok: true,
    outputPng: new Uint8Array([1]),
    costUsd: 0.04,
    modelUsed: 'gpt-image-2',
  })
})

describe('fallbackModelFor', () => {
  it('falls back to nano-banana-2-lite for non-lite models', () => {
    expect(fallbackModelFor('gpt-image-2')).toBe('nano-banana-2-lite')
    expect(fallbackModelFor('nano-banana-2')).toBe('nano-banana-2-lite')
  })
  it('falls back to nano-banana-2 when the primary IS lite', () => {
    expect(fallbackModelFor('nano-banana-2-lite')).toBe('nano-banana-2')
  })
})

describe('generateImageWithFallback', () => {
  it('returns the primary result when it succeeds (no fallback call)', async () => {
    let openaiCalls = 0
    openaiImpl = async () => {
      openaiCalls++
      return { ok: true, outputPng: new Uint8Array([1]), costUsd: 0.04, modelUsed: 'gpt-image-2' }
    }
    const geminiCalls = { n: 0 }
    geminiImpl = async () => {
      geminiCalls.n++
      return {
        ok: true,
        outputPng: new Uint8Array([1]),
        costUsd: 0.001,
        modelUsed: 'gemini-3.1-flash-image',
      }
    }
    const res = await generateImageWithFallback(baseArgs('gpt-image-2'))
    expect(res.ok).toBe(true)
    expect(openaiCalls).toBe(1)
    expect(geminiCalls.n).toBe(0) // fallback never invoked
  })

  it('retries on the fallback model when primary fails with a retryable reason', async () => {
    openaiImpl = async () => ({ ok: false, costUsd: 0, reason: 'timeout', message: 'slow' })
    let fallbackModel: string | null = null
    geminiImpl = async (a) => {
      fallbackModel = a.model
      return {
        ok: true,
        outputPng: new Uint8Array([1]),
        costUsd: 0.001,
        modelUsed: 'gemini-3.1-flash-lite-image',
      }
    }
    const res = await generateImageWithFallback(baseArgs('gpt-image-2'))
    expect(res.ok).toBe(true)
    expect(fallbackModel).toBe('nano-banana-2-lite') // gpt-image-2 → lite
  })

  it('does NOT fall back on a safety block', async () => {
    openaiImpl = async () => ({ ok: false, costUsd: 0, reason: 'safety', message: 'blocked' })
    let geminiCalled = false
    geminiImpl = async () => {
      geminiCalled = true
      return { ok: true, outputPng: new Uint8Array([1]), costUsd: 0.001, modelUsed: 'x' }
    }
    const res = await generateImageWithFallback(baseArgs('gpt-image-2'))
    expect(res.ok).toBe(false)
    expect(geminiCalled).toBe(false)
  })

  it('does NOT fall back on not-configured', async () => {
    openaiImpl = async () => ({
      ok: false,
      costUsd: 0,
      reason: 'not-configured',
      message: 'no key',
    })
    let geminiCalled = false
    geminiImpl = async () => {
      geminiCalled = true
      return { ok: true, outputPng: new Uint8Array([1]), costUsd: 0.001, modelUsed: 'x' }
    }
    const res = await generateImageWithFallback(baseArgs('gpt-image-2'))
    expect(res.ok).toBe(false)
    expect(geminiCalled).toBe(false)
  })

  it('when lite is the primary and fails, falls back to nano-banana-2', async () => {
    // lite is a gemini model → geminiImpl handles both primary + fallback here.
    const seen: string[] = []
    geminiImpl = async (a) => {
      seen.push(a.model)
      if (a.model === 'nano-banana-2-lite')
        return { ok: false, costUsd: 0, reason: 'invalid', message: 'bad' }
      return {
        ok: true,
        outputPng: new Uint8Array([1]),
        costUsd: 0.001,
        modelUsed: 'gemini-3.1-flash-image',
      }
    }
    const res = await generateImageWithFallback(baseArgs('nano-banana-2-lite'))
    expect(res.ok).toBe(true)
    expect(seen).toEqual(['nano-banana-2-lite', 'nano-banana-2'])
  })
})
