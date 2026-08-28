import { describe, expect, it } from 'vitest'
import { countWrappedLines, resolveThumbLineRatio } from './scrollThumbMetrics'

describe('countWrappedLines', () => {
  it('counts a short line as one line', () => {
    expect(countWrappedLines('hello', 80)).toBe(1)
  })

  it('counts the lines a long line wraps onto', () => {
    expect(countWrappedLines('x'.repeat(240), 80)).toBe(3)
    expect(countWrappedLines('x'.repeat(241), 80)).toBe(4)
  })

  it('gives an empty line its own line box', () => {
    expect(countWrappedLines('a\n\nb', 80)).toBe(3)
    expect(countWrappedLines('', 80)).toBe(1)
  })

  it('counts a document of many short lines by its lines, not its characters', () => {
    // The case that rules character-counting out: little text, many screens.
    const toc = Array.from({ length: 500 }, (_, i) => `- item ${i}`).join('\n')
    expect(countWrappedLines(toc, 80)).toBe(500)
    expect(toc.length / 80).toBeLessThan(100)
  })

  it('counts wrapped prose by its wrapped lines, not its source lines', () => {
    // The case that rules source-line-counting out.
    const prose = Array.from({ length: 100 }, () => 'x'.repeat(400)).join('\n')
    expect(countWrappedLines(prose, 80)).toBe(500)
  })

  it('falls back to source lines rather than dividing by nothing', () => {
    expect(countWrappedLines('a\nb\nc', 0)).toBe(3)
    expect(countWrappedLines('a\nb\nc', Number.NaN)).toBe(3)
  })

  it('never reports less than one line', () => {
    expect(countWrappedLines('', 0)).toBe(1)
  })
})

describe('resolveThumbLineRatio', () => {
  it('is the share of the document one screen holds', () => {
    // 45 lines on screen out of 450 in the document.
    expect(resolveThumbLineRatio({ viewportHeightPx: 900, lineHeightPx: 20, documentLines: 450 }))
      .toBeCloseTo(0.1, 6)
  })

  it('fills the track when the document fits on screen', () => {
    expect(resolveThumbLineRatio({ viewportHeightPx: 900, lineHeightPx: 20, documentLines: 10 })).toBe(1)
  })

  it('stays positive on a document far longer than the screen', () => {
    const ratio = resolveThumbLineRatio({ viewportHeightPx: 900, lineHeightPx: 20, documentLines: 5_000_000 })!
    expect(ratio).toBeGreaterThan(0)
    expect(ratio).toBeLessThan(0.001)
  })

  it('declines to answer rather than answering wrongly', () => {
    // A caller with no line height yet should keep what it last drew.
    expect(resolveThumbLineRatio({ viewportHeightPx: 900, lineHeightPx: 0, documentLines: 100 })).toBeNull()
    expect(resolveThumbLineRatio({ viewportHeightPx: 0, lineHeightPx: 20, documentLines: 100 })).toBeNull()
    expect(resolveThumbLineRatio({ viewportHeightPx: 900, lineHeightPx: 20, documentLines: 0 })).toBeNull()
  })

  it('does not move when the document is re-measured, only when it changes', () => {
    // The whole point: the inputs are the text and the typography, neither of
    // which changes because the app finished measuring something.
    const before = resolveThumbLineRatio({ viewportHeightPx: 900, lineHeightPx: 20, documentLines: 450 })
    const after = resolveThumbLineRatio({ viewportHeightPx: 900, lineHeightPx: 20, documentLines: 450 })
    expect(after).toBe(before)
  })
})
