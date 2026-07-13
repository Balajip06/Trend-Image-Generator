import { describe, expect, it } from 'vitest'
import { safeNextPath } from './safe-next-path'

describe('safeNextPath', () => {
  it('returns / for null', () => {
    expect(safeNextPath(null)).toBe('/')
  })

  it('returns / for empty string', () => {
    expect(safeNextPath('')).toBe('/')
  })

  it('passes through a same-origin path', () => {
    expect(safeNextPath('/creations')).toBe('/creations')
  })

  it('passes through a same-origin path with query', () => {
    expect(safeNextPath('/trend/ghibli?ref=abc')).toBe('/trend/ghibli?ref=abc')
  })

  it('rejects protocol-relative URL (//evil.com)', () => {
    expect(safeNextPath('//evil.com')).toBe('/')
  })

  it('rejects protocol-relative URL with path', () => {
    expect(safeNextPath('//evil.com/path')).toBe('/')
  })

  it('rejects fully-qualified http URL', () => {
    expect(safeNextPath('http://evil.com')).toBe('/')
  })

  it('rejects fully-qualified https URL', () => {
    expect(safeNextPath('https://evil.com/path')).toBe('/')
  })

  it('rejects backslash prefix (browser-quirk normalisation to /)', () => {
    expect(safeNextPath('\\evil.com')).toBe('/')
  })

  it('rejects backslash anywhere in path', () => {
    expect(safeNextPath('/me\\evil.com')).toBe('/')
  })

  it('rejects @ in path (userinfo escape vector)', () => {
    expect(safeNextPath('/@evil.com')).toBe('/')
  })

  it('rejects @ anywhere in path', () => {
    expect(safeNextPath('/login@evil.com')).toBe('/')
  })

  it('rejects path not starting with slash', () => {
    expect(safeNextPath('me/creations')).toBe('/')
  })

  it('rejects javascript: scheme', () => {
    expect(safeNextPath('javascript:alert(1)')).toBe('/')
  })

  it('rejects data: scheme', () => {
    expect(safeNextPath('data:text/html,<script>alert(1)</script>')).toBe('/')
  })
})
