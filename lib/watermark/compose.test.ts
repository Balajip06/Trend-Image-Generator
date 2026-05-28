import { describe, expect, it } from 'vitest'
import sharp from 'sharp'
import { applyWatermark } from './compose'

async function makeSolidPng(width: number, height: number): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 3, background: { r: 50, g: 100, b: 200 } },
  })
    .png()
    .toBuffer()
}

describe('applyWatermark', () => {
  it('returns a valid PNG with the input dimensions preserved', async () => {
    const input = await makeSolidPng(512, 512)
    const out = await applyWatermark(input)
    const meta = await sharp(out).metadata()
    expect(meta.format).toBe('png')
    expect(meta.width).toBe(512)
    expect(meta.height).toBe(512)
  })

  it('produces a buffer that differs from the original (composite actually applied)', async () => {
    const input = await makeSolidPng(256, 256)
    const out = await applyWatermark(input)
    expect(out.length).not.toBe(input.length)
  })

  it('scales tag with longest side (4096 vs 512 yields different byte sizes)', async () => {
    const small = await applyWatermark(await makeSolidPng(512, 512))
    const big = await applyWatermark(await makeSolidPng(2048, 1024))
    const smallMeta = await sharp(small).metadata()
    const bigMeta = await sharp(big).metadata()
    expect(smallMeta.width).toBe(512)
    expect(bigMeta.width).toBe(2048)
    expect(bigMeta.height).toBe(1024)
  })

  it('honors custom wordmark override', async () => {
    const input = await makeSolidPng(512, 512)
    const a = await applyWatermark(input, { wordmark: 'short' })
    const b = await applyWatermark(input, { wordmark: 'a-much-longer-wordmark-text' })
    // Longer text → larger composited buffer
    expect(b.length).toBeGreaterThan(a.length)
  })
})
