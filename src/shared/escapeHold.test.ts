import { describe, expect, it } from 'vitest'
import { didEscapeHoldTrigger } from './escapeHold'

describe('didEscapeHoldTrigger', () => {
  it('returns false before the hold threshold', () => {
    expect(didEscapeHoldTrigger(299)).toBe(false)
  })

  it('returns true at and beyond the hold threshold', () => {
    expect(didEscapeHoldTrigger(300)).toBe(true)
    expect(didEscapeHoldTrigger(500)).toBe(true)
  })
})
