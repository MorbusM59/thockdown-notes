import { describe, it, expect } from 'vitest'
import { selectPreviewAnchorCandidate } from './PreviewAnchorSelection'

/** Blocks as the preview measures them: `top`/`bottom` relative to the container's top edge. */
const block = (line: number, top: number, height: number) => ({ entry: line, top, bottom: top + height })

describe('selectPreviewAnchorCandidate', () => {
  it('picks the block the top edge cuts through', () => {
    const selected = selectPreviewAnchorCandidate([
      block(10, -400, 170),
      block(12, -120, 170), // straddles: starts above, reaches to +50
      block(14, 50, 170),
    ])
    expect(selected?.entry).toBe(12)
  })

  it('does not pick a block that has scrolled exactly past the edge', () => {
    // Block 12 ends flush at the edge -- the reader can no longer see any of
    // it, so block 14 is what is actually at the top.
    const selected = selectPreviewAnchorCandidate([
      block(10, -340, 170),
      block(12, -170, 170),
      block(14, 0, 170),
    ])
    expect(selected?.entry).toBe(14)
  })

  it('picks the first block below the edge when the viewport starts in a gap', () => {
    const selected = selectPreviewAnchorCandidate([
      block(10, -300, 100),
      block(12, 20, 170),
      block(14, 200, 170),
    ])
    expect(selected?.entry).toBe(12)
  })

  it('picks the lowest straddling block when several start above the edge', () => {
    // A short block nested inside a tall one (a list item inside a list):
    // the nearest one to the edge is the more precise answer.
    const selected = selectPreviewAnchorCandidate([
      block(4, -900, 1200),
      block(20, -60, 100),
      block(22, 40, 100),
    ])
    expect(selected?.entry).toBe(20)
  })

  it('falls back to the closest block above when nothing reaches the edge', () => {
    const selected = selectPreviewAnchorCandidate([
      block(10, -800, 100),
      block(12, -400, 100),
    ])
    expect(selected?.entry).toBe(12)
  })

  it('returns null for no candidates', () => {
    expect(selectPreviewAnchorCandidate([])).toBeNull()
  })

  it('handles a single block covering the whole viewport', () => {
    expect(selectPreviewAnchorCandidate([block(0, -50, 2000)])?.entry).toBe(0)
  })

  describe('reference offset', () => {
    // Restores land the target one line-height below the top edge, so the
    // reading has to be taken there too -- otherwise every switch shifts by
    // that difference and a round trip walks.
    const LINE = 24

    it('reads at the reference line, not the container top', () => {
      // Block 12 owns the container's top edge, but block 14 is what sits on
      // the reference line one line-height down -- and 14 is where a restore
      // would have put the reader.
      const candidates = [block(10, -300, 150), block(12, -150, 160), block(14, 10, 170)]
      expect(selectPreviewAnchorCandidate(candidates, 0)?.entry).toBe(12)
      expect(selectPreviewAnchorCandidate(candidates, LINE)?.entry).toBe(14)
    })

    it('round-trips a landing back to the same element', () => {
      // What a restore produces: the target's top sits exactly on the
      // reference line. Reading that state must name the target again.
      const landedTarget = block(20, LINE, 200)
      const previous = block(18, LINE - 180, 180) // ends exactly on the line
      expect(selectPreviewAnchorCandidate([previous, landedTarget], LINE)?.entry).toBe(20)
    })

    it('still falls back below the reference line when nothing straddles it', () => {
      expect(selectPreviewAnchorCandidate([block(10, -300, 100), block(12, LINE + 30, 100)], LINE)?.entry).toBe(12)
    })
  })
})
