import { describe, it, expect, vi } from 'vitest'

// Mock env so tests are deterministic
vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://abcdef.supabase.co')

import { assertStorageUrl } from './validate-image-url'

describe('assertStorageUrl', () => {
  it('accepts a valid signed URL', () => {
    expect(() =>
      assertStorageUrl(
        'https://abcdef.supabase.co/storage/v1/object/sign/uploads/user-1/photo.jpg?token=abc'
      )
    ).not.toThrow()
  })

  it('accepts a valid public URL', () => {
    expect(() =>
      assertStorageUrl('https://abcdef.supabase.co/storage/v1/object/public/uploads/user-1/photo.jpg')
    ).not.toThrow()
  })

  it('rejects http:// URLs', () => {
    expect(() =>
      assertStorageUrl('http://abcdef.supabase.co/storage/v1/object/sign/uploads/x.jpg')
    ).toThrow('invalid image URL')
  })

  it('rejects external host', () => {
    expect(() =>
      assertStorageUrl('https://evil.com/storage/v1/object/sign/uploads/x.jpg')
    ).toThrow('invalid image URL')
  })

  it('rejects cloud metadata endpoint', () => {
    expect(() => assertStorageUrl('http://169.254.169.254/latest/meta-data/')).toThrow(
      'invalid image URL'
    )
  })

  it('rejects GCP metadata endpoint', () => {
    expect(() => assertStorageUrl('http://metadata.google.internal/')).toThrow('invalid image URL')
  })

  it('rejects localhost', () => {
    expect(() => assertStorageUrl('http://localhost:9000/bucket/file.png')).toThrow(
      'invalid image URL'
    )
  })

  it('rejects data: URLs', () => {
    expect(() => assertStorageUrl('data:image/png;base64,abc')).toThrow('invalid image URL')
  })

  it('rejects non-uploads path', () => {
    expect(() =>
      assertStorageUrl('https://abcdef.supabase.co/storage/v1/object/sign/outputs/x.jpg')
    ).toThrow('invalid image URL')
  })
})
