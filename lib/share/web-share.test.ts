import { describe, expect, it } from 'vitest'
import { buildTwitterShareUrl, buildWhatsappShareUrl } from './web-share'

describe('buildTwitterShareUrl', () => {
  it('URL-encodes text + url', () => {
    const out = buildTwitterShareUrl('hello world & friends', 'https://example.com/?q=1')
    expect(out).toContain('text=hello%20world%20%26%20friends')
    expect(out).toContain('url=https%3A%2F%2Fexample.com%2F%3Fq%3D1')
  })

  it('targets x.com intent endpoint', () => {
    expect(buildTwitterShareUrl('a', 'b')).toMatch(/^https:\/\/x\.com\/intent\/tweet/)
  })
})

describe('buildWhatsappShareUrl', () => {
  it('combines text and url in single query param', () => {
    const out = buildWhatsappShareUrl('hi', 'https://example.com')
    expect(out).toBe('https://wa.me/?text=hi%20https%3A%2F%2Fexample.com')
  })
})
