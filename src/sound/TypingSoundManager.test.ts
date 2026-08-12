import { describe, expect, it } from 'vitest'
import {
  shouldBakeReverbIntoTransient,
  shouldSuppressPlainTypingSoundForInsertion,
  suppressNextPlainTypingSoundOnce,
} from './TypingSoundManager'

describe('typing sounds', () => {
  it('suppresses the plain key-hit when Enter inserts a newline', () => {
    expect(
      shouldSuppressPlainTypingSoundForInsertion({
        source: 'user-input',
        text: 'a\n',
        previousText: 'a',
        selection: { start: 2 },
      })
    ).toBe(true)
  })

  it('suppresses the follow-on plain click after a dedicated Tab sound', () => {
    suppressNextPlainTypingSoundOnce()
    expect(
      shouldSuppressPlainTypingSoundForInsertion({
        source: 'user-input',
        text: '    a',
        previousText: 'a',
        selection: { start: 5 },
      })
    ).toBe(true)
  })

  it('keeps normal character taps for ordinary letters', () => {
    expect(
      shouldSuppressPlainTypingSoundForInsertion({
        source: 'user-input',
        text: 'ab',
        previousText: 'a',
        selection: { start: 2 },
      })
    ).toBe(false)
  })

  it('keeps reverb live instead of baking it into each transient sample', () => {
    expect(shouldBakeReverbIntoTransient(0.4)).toBe(false)
    expect(shouldBakeReverbIntoTransient(0)).toBe(false)
  })
})
