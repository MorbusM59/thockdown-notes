import { describe, expect, it } from 'vitest'
import {
  resolveKeyboardPanForCode,
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

  describe('spatial mode A: keyboard-position pan', () => {
    it('pans the far corners of the keyboard to the far edges', () => {
      expect(resolveKeyboardPanForCode('Backquote')).toBe(-1)
      expect(resolveKeyboardPanForCode('Equal')).toBe(1)
      expect(resolveKeyboardPanForCode('Slash')).toBe(1)
    })

    it('centers the space bar', () => {
      expect(resolveKeyboardPanForCode('Space')).toBe(0)
    })

    it('centers non-character keys (arrows, tab, backspace, modified keys)', () => {
      expect(resolveKeyboardPanForCode('ArrowLeft')).toBe(0)
      expect(resolveKeyboardPanForCode('Tab')).toBe(0)
      expect(resolveKeyboardPanForCode('Backspace')).toBe(0)
      expect(resolveKeyboardPanForCode('ControlLeft')).toBe(0)
      expect(resolveKeyboardPanForCode(undefined)).toBe(0)
    })

    // The whole point of keying this table by KeyboardEvent.code rather
    // than by the produced character: `code` identifies a physical key and
    // is reported the same way regardless of the OS keyboard layout. A US
    // (QWERTY) and German (QWERTZ) layout both report `code: "KeyY"` for
    // the physical key that sits left-of-center on row 2 -- even though
    // QWERTY produces "y" there and QWERTZ produces "z". If this table were
    // keyed by character instead, German Z/Y would pan on the swapped
    // (wrong) side relative to a US keyboard.
    it('pans a physical key the same regardless of what character the active layout produces there (QWERTY vs QWERTZ)', () => {
      const physicalKeyLeftOfCenterRow2 = resolveKeyboardPanForCode('KeyY')
      const physicalKeyLeftmostRow4 = resolveKeyboardPanForCode('KeyZ')
      expect(physicalKeyLeftOfCenterRow2).toBeLessThan(0)
      expect(physicalKeyLeftmostRow4).toBeLessThan(physicalKeyLeftOfCenterRow2)
    })

    it('gives the German/ISO-only extra key (left of Z) its own left-of-Z position instead of colliding with KeyZ', () => {
      const intlBackslashPan = resolveKeyboardPanForCode('IntlBackslash')
      const keyZPan = resolveKeyboardPanForCode('KeyZ')
      expect(intlBackslashPan).toBeLessThan(keyZPan)
    })
  })
})
