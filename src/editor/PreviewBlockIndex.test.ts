import { describe, expect, it } from 'vitest'
import { resolvePreviewBlockIndexForSourceLine } from './PreviewBlockIndex'

describe('resolvePreviewBlockIndexForSourceLine', () => {
  const blocks = [
    { startLine: 0 },
    { startLine: 5 },
    { startLine: 12 },
    { startLine: 20 },
  ]

  it('returns -1 for an empty block list', () => {
    expect(resolvePreviewBlockIndexForSourceLine([], 3)).toBe(-1)
  })

  it('clamps a line before the first block to the first block', () => {
    expect(resolvePreviewBlockIndexForSourceLine(blocks, -5)).toBe(0)
  })

  it('resolves an exact startLine match to that block', () => {
    expect(resolvePreviewBlockIndexForSourceLine(blocks, 5)).toBe(1)
    expect(resolvePreviewBlockIndexForSourceLine(blocks, 12)).toBe(2)
  })

  it('resolves a line strictly between two blocks to the earlier one', () => {
    expect(resolvePreviewBlockIndexForSourceLine(blocks, 8)).toBe(1)
    expect(resolvePreviewBlockIndexForSourceLine(blocks, 19)).toBe(2)
  })

  it('clamps a line past the last block to the last block', () => {
    expect(resolvePreviewBlockIndexForSourceLine(blocks, 999)).toBe(3)
  })

  it('resolves correctly for a single-block list', () => {
    expect(resolvePreviewBlockIndexForSourceLine([{ startLine: 0 }], 100)).toBe(0)
  })
})
