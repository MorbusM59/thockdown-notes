import { describe, expect, it } from 'vitest'
import { isSingleCellText, singleCellText } from './singleCellText'

describe('singleCellText', () => {
  it('leaves ordinary text alone, accents, box drawing and punctuation included', () => {
    const text = 'Plain ASCII, naïve café, Ωμέγα, привет, ─│┼ → ≠ — “quotes” …\nsecond line'
    expect(isSingleCellText(text)).toBe(true)
    expect(singleCellText(text)).toBe(text)
  })

  it('drops emoji, with their modifiers, joiners and variation selectors', () => {
    expect(singleCellText('a😀b')).toBe('ab')
    expect(singleCellText('a👍🏽b')).toBe('ab')
    expect(singleCellText('a👩‍💻b')).toBe('ab')
    expect(singleCellText('a❤️b')).toBe('ab')
    expect(singleCellText('a🇩🇪b')).toBe('ab')
  })

  it('drops double-width characters', () => {
    expect(singleCellText('a漢字b')).toBe('ab')
    expect(singleCellText('aかなカナb')).toBe('ab')
    expect(singleCellText('a한국어b')).toBe('ab')
    expect(singleCellText('aＡＢｃb')).toBe('ab')
  })

  it('drops zero-width and invisible characters', () => {
    expect(singleCellText('a​b‍c‎d­e﻿f⁠g')).toBe('abcdefg')
    expect(singleCellText('a\u0007b\u001Bc')).toBe('abc')
  })

  it('composes a decomposed accent instead of losing it', () => {
    expect(singleCellText('café')).toBe('café')
    expect(isSingleCellText('café')).toBe(false)
  })

  it('drops a combining mark that has no composed form', () => {
    expect(singleCellText('x́')).toBe('x')
  })

  it('turns other space characters into an ordinary space, keeping newlines', () => {
    expect(singleCellText('a b c d\ne')).toBe('a b c d\ne')
  })

  it('check and cleaning agree, and cleaning is idempotent', () => {
    const samples = ['plain', 'a😀b', 'café', 'a漢b', 'a b', 'x​y', 'naïve\nline', '']
    for (const sample of samples) {
      const cleaned = singleCellText(sample)
      expect(isSingleCellText(cleaned)).toBe(true)
      expect(singleCellText(cleaned)).toBe(cleaned)
      expect(isSingleCellText(sample)).toBe(cleaned === sample)
    }
  })
})
