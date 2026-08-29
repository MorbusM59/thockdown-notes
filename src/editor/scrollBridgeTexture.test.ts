import { describe, expect, it } from 'vitest'
import {
  BRIDGE_DECLARATION_TEXT,
  buildBridgeLineText,
  sampleDocumentLineRhythm,
} from './scrollBridgeTexture'

const random = () => 0.25

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
  it('fills a binary line with ones and zeroes only', () => {
    const text = buildBridgeLineText('binary', 20, random, { at: 0 })
    expect(text).toHaveLength(20)
    expect(text).toMatch(/^[01]+$/)
  })

  it('reads the Declaration in order rather than shuffling its words', () => {
    const cursor = { at: 0 }
    const first = buildBridgeLineText('declaration', 30, random, cursor)
    expect(BRIDGE_DECLARATION_TEXT.startsWith(first.slice(0, 20))).toBe(true)
    // The cursor carries on, so the next line continues the sentence.
    const second = buildBridgeLineText('declaration', 30, random, cursor)
    expect(second).not.toBe(first)
  })

  it('cycles rather than running out', () => {
    const text = buildBridgeLineText('declaration', 4000, random, { at: 0 })
    expect(text.length).toBeGreaterThanOrEqual(4000)
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
    expect(buildBridgeLineText('binary', 0, random, { at: 0 })).toBe('')
    expect(buildBridgeLineText('declaration', -5, random, { at: 0 })).toBe('')
  })
})
