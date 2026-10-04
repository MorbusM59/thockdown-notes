import { describe, expect, it } from 'vitest'
import {
  BRIDGE_DECLARATION_TEXT,
  buildBridgeLineText,
  resolveBridgeBaselineOffsetPx,
  sampleDocumentLineRhythm,
} from './scrollBridgeTexture'

describe('sampleDocumentLineRhythm', () => {
  it('keeps blank lines as gaps, because the gaps are part of the texture', () => {
    const rhythm = sampleDocumentLineRhythm({ text: 'abcde\n\nabcde', charsPerLine: 10 })
    expect(rhythm.map((line) => line.fill)).toEqual([0.5, 0, 0.5])
  })

  it('wraps a long source line into full lines plus a remainder', () => {
    // 25 characters at 10 per line: two full lines and half of a third.
    const rhythm = sampleDocumentLineRhythm({ text: 'x'.repeat(25), charsPerLine: 10 })
    expect(rhythm.map((line) => line.fill)).toEqual([1, 1, 0.5])
  })

  it('takes its rhythm from the document rather than inventing one', () => {
    const sparse = sampleDocumentLineRhythm({ text: '- a\n- b\n- c', charsPerLine: 40 })
    const dense = sampleDocumentLineRhythm({ text: 'y'.repeat(200), charsPerLine: 40 })
    const meanFill = (lines: { fill: number }[]) =>
      lines.reduce((sum, line) => sum + line.fill, 0) / lines.length
    // The whole point: a document of one-word list items must not produce the
    // same ink as one of full paragraphs.
    expect(meanFill(sparse)).toBeLessThan(0.2)
    expect(meanFill(dense)).toBe(1)
  })

  it('stops at its sample bound rather than walking a whole document', () => {
    const rhythm = sampleDocumentLineRhythm({
      text: 'a\n'.repeat(5000),
      charsPerLine: 40,
      sampleLines: 24,
    })
    expect(rhythm).toHaveLength(24)
  })

  it('answers something usable for input it cannot read', () => {
    expect(sampleDocumentLineRhythm({ text: '', charsPerLine: 40 }).length).toBeGreaterThan(0)
    expect(sampleDocumentLineRhythm({ text: 'abc', charsPerLine: 0 }).length).toBeGreaterThan(0)
  })
})

describe('buildBridgeLineText', () => {
  it('reads the Declaration in order rather than shuffling its words', () => {
    const cursor = { at: 0 }
    const first = buildBridgeLineText(30, cursor)
    expect(BRIDGE_DECLARATION_TEXT.startsWith(first.slice(0, 20))).toBe(true)
    // The cursor carries on, so the next line continues the sentence.
    const second = buildBridgeLineText(30, cursor)
    expect(second).not.toBe(first)
  })

  it('cycles rather than running out', () => {
    const text = buildBridgeLineText(4000, { at: 0 })
    expect(text.length).toBeGreaterThan(3960)
  })

  it('never runs past the width it was given', () => {
    // On a character grid an overrun is not a rounding error, it is a line
    // sticking out past the margin -- which is what the first edit-view
    // bridge did.
    const cursor = { at: 0 }
    for (let i = 0; i < 40; i += 1) {
      expect(buildBridgeLineText(37, cursor).length).toBeLessThanOrEqual(37)
    }
  })

  it('leaves a word that did not fit for the next line', () => {
    const cursor = { at: 0 }
    const first = buildBridgeLineText(12, cursor)
    const second = buildBridgeLineText(60, cursor)
    // Whatever fell off the end of the first line opens the second, exactly as
    // wrapping means -- rather than being dropped.
    expect(`${first} ${second}`.startsWith(BRIDGE_DECLARATION_TEXT.slice(0, 40))).toBe(true)
  })

  it('carries the whole Declaration, not one article of it', () => {
    // A tile is around ten thousand characters wide by tall, so anything much
    // shorter than this would visibly loop within a single bridge.
    expect(BRIDGE_DECLARATION_TEXT.length).toBeGreaterThan(9000)
    expect(BRIDGE_DECLARATION_TEXT).toContain('Preamble')
    expect(BRIDGE_DECLARATION_TEXT).toContain('Article 30')
  })

  it('strips the markdown, which the bridge would otherwise draw literally', () => {
    expect(BRIDGE_DECLARATION_TEXT).not.toMatch(/#/)
    expect(BRIDGE_DECLARATION_TEXT).not.toMatch(/---/)
    expect(BRIDGE_DECLARATION_TEXT).not.toMatch(/\n/)
    expect(BRIDGE_DECLARATION_TEXT.startsWith('Universal Declaration')).toBe(true)
  })

  it('draws nothing for a gap', () => {
    expect(buildBridgeLineText(0, { at: 0 })).toBe('')
    expect(buildBridgeLineText(-5, { at: 0 })).toBe('')
  })
})

describe('resolveBridgeBaselineOffsetPx', () => {
  it('puts the baseline where the editor actually puts its own', () => {
    // Measured against the running editor: line height 26, font 16, ascent 14,
    // descent 4. A Range around the document's own first characters puts its
    // baseline 18px into the row, and this has to agree exactly -- a page of
    // spoof a pixel and a half low reads as text off the grid, because it is.
    expect(resolveBridgeBaselineOffsetPx({ lineHeightPx: 26, ascentPx: 14, descentPx: 4 })).toBe(18)
  })

  it('splits the leftover space evenly, which is what makes it agree', () => {
    // The same rule CSS uses for inline text in a line box, rather than a
    // fitted constant: half the leftover above, half below.
    expect(resolveBridgeBaselineOffsetPx({ lineHeightPx: 40, ascentPx: 10, descentPx: 10 })).toBe(20)
    expect(resolveBridgeBaselineOffsetPx({ lineHeightPx: 20, ascentPx: 10, descentPx: 10 })).toBe(10)
  })

  it('falls back rather than drawing nothing when the font will not say', () => {
    expect(resolveBridgeBaselineOffsetPx({ lineHeightPx: 26 })).toBe(19.5)
    expect(resolveBridgeBaselineOffsetPx({ lineHeightPx: 26, ascentPx: 0, descentPx: 0 })).toBe(19.5)
  })
})
