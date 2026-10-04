import { describe, expect, it } from 'vitest'
import { normalizeInternalText } from './TextPolicy'

describe('normalizeInternalText', () => {
  it('normalizes CRLF and lone CR to LF', () => {
    expect(normalizeInternalText('a\r\nb\rc')).toBe('a\nb\nc')
  })

  it('normalizes unicode line/paragraph separators to LF', () => {
    expect(normalizeInternalText('a b c')).toBe('a\nb\nc')
  })

  it('expands tabs to three spaces', () => {
    expect(normalizeInternalText('a\tb')).toBe('a   b')
  })

  it('strips a leading BOM', () => {
    expect(normalizeInternalText('﻿hello')).toBe('hello')
  })
})
