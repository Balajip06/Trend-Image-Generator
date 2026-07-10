import { describe, expect, it } from 'vitest'
import { costForOutput, isAnonymousBudgetExceeded } from './cost'

describe('costForOutput', () => {
  it('returns the standard Flash cost higher than the cheaper Lite variant', () => {
    expect(costForOutput('nano-banana-2')).toBeGreaterThan(costForOutput('nano-banana-2-lite'))
  })

  it('returns finite positive USD value for both models', () => {
    expect(costForOutput('nano-banana-2')).toBeGreaterThan(0)
    expect(costForOutput('nano-banana-2-lite')).toBeGreaterThan(0)
    expect(Number.isFinite(costForOutput('nano-banana-2'))).toBe(true)
  })
})

describe('isAnonymousBudgetExceeded', () => {
  it('returns false when spent < cap', () => {
    expect(isAnonymousBudgetExceeded(5, 20)).toBe(false)
  })

  it('returns true when spent equals cap', () => {
    expect(isAnonymousBudgetExceeded(20, 20)).toBe(true)
  })

  it('returns true when spent exceeds cap', () => {
    expect(isAnonymousBudgetExceeded(25, 20)).toBe(true)
  })
})
