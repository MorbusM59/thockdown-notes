import { describe, it, expect } from 'vitest'
import { resolvePreviewLandingScrollTop } from './previewLanding'
import { selectPreviewAnchorCandidate } from '../editor/PreviewAnchorSelection'

const MAX_SCROLL = 1_000_000

describe('resolvePreviewLandingScrollTop', () => {
  it('leaves the offset above a block that has content above it', () => {
    expect(resolvePreviewLandingScrollTop({
      blockTopPx: 500,
      contentAbovePx: 482,
      offsetPx: 26,
      maxScrollTopPx: MAX_SCROLL,
    })).toBe(474)
  })

  it('lands the first block at the document top, whatever the restore offset', () => {
    for (const offsetPx of [9.6, 26, 72]) {
      expect(resolvePreviewLandingScrollTop({
        blockTopPx: 18,
        contentAbovePx: 0,
        offsetPx,
        maxScrollTopPx: MAX_SCROLL,
      })).toBe(0)
    }
  })

  /**
   * No offset means "put this block flush against the pane's top", which for
   * the first block means scrolling the page margin away -- a different
   * request from a restore's, and the one find navigation makes before doing
   * its own centering.
   */
  it('top-aligns the block when no offset is asked for', () => {
    expect(resolvePreviewLandingScrollTop({
      blockTopPx: 18,
      contentAbovePx: 0,
      offsetPx: 0,
      maxScrollTopPx: MAX_SCROLL,
    })).toBe(18)
  })

  /**
   * The regression this whole module exists for. With the offset expressed in
   * the EDIT view's line height and applied as a raw subtraction, the first
   * block came out at 0 only while that number happened to exceed the page
   * margin. At the small end of the font-size slider it does not
   * (EDITOR_FONT_SIZE_MIN_PX is 6, so one render line is 9.6px against an
   * 18px margin) and the note opened 8.4px down.
   */
  it('does not eat into the page margin when the offset exceeds the content above', () => {
    expect(resolvePreviewLandingScrollTop({
      blockTopPx: 18,
      contentAbovePx: 0,
      offsetPx: 9.6,
      maxScrollTopPx: MAX_SCROLL,
    })).toBe(0)
  })

  it('shows the document from its start when there is not a full offset of content above', () => {
    // Block 1 of a document whose first block is 20px tall, restored under a
    // 72px offset: there is no 72px of document above it to reveal.
    expect(resolvePreviewLandingScrollTop({
      blockTopPx: 53.75,
      contentAbovePx: 20,
      offsetPx: 72,
      maxScrollTopPx: MAX_SCROLL,
    })).toBe(0)
  })

  it('treats an unbounded content-above (a windowed run that is not at the document start) as satisfying any offset', () => {
    expect(resolvePreviewLandingScrollTop({
      blockTopPx: 400,
      contentAbovePx: Number.POSITIVE_INFINITY,
      offsetPx: 26,
      maxScrollTopPx: MAX_SCROLL,
    })).toBe(374)
  })

  it('clamps to the scroller it is landing in', () => {
    expect(resolvePreviewLandingScrollTop({
      blockTopPx: 9000,
      contentAbovePx: Number.POSITIVE_INFINITY,
      offsetPx: 26,
      maxScrollTopPx: 500,
    })).toBe(500)
    expect(resolvePreviewLandingScrollTop({
      blockTopPx: 10,
      contentAbovePx: Number.POSITIVE_INFINITY,
      offsetPx: 26,
      maxScrollTopPx: 500,
    })).toBe(0)
  })
})

/**
 * The property, not the step (doctrine rule 6).
 *
 * A restore is one half of a round trip: the reader's position is captured as
 * a block, and landing on that block must put the reader back where the
 * capture read them. If the two halves disagree by even a pixel, every note
 * switch moves the reader by that much, cumulatively -- which is exactly how
 * this pane lost a paragraph per switch once before, and eight blocks per
 * switch on the windowed pane.
 *
 * So this iterates the loop rather than checking one landing: capture where
 * the reader is, land on it, capture again. The scroll position must stop
 * moving, and stay stopped.
 */
describe('capture/restore round trip', () => {
  interface Doc {
    edgePaddingPx: number
    offsetPx: number
    blockHeightsPx: number[]
  }

  const blockTops = (doc: Doc): number[] => {
    const tops: number[] = []
    let cursor = doc.edgePaddingPx
    for (const height of doc.blockHeightsPx) {
      tops.push(cursor)
      cursor += height
    }
    return tops
  }

  const maxScrollTop = (doc: Doc, viewportPx: number): number => {
    const tops = blockTops(doc)
    const contentBottom = tops[tops.length - 1] + doc.blockHeightsPx[doc.blockHeightsPx.length - 1] + doc.edgePaddingPx
    return Math.max(0, contentBottom - viewportPx)
  }

  /** The capture half: which block the reader is on, read at the same reference the landing uses. */
  const captureBlockIndex = (doc: Doc, scrollTopPx: number): number => {
    const tops = blockTops(doc)
    const selected = selectPreviewAnchorCandidate(
      tops.map((top, index) => ({
        entry: index,
        top: top - scrollTopPx,
        bottom: top + doc.blockHeightsPx[index] - scrollTopPx,
      })),
      doc.offsetPx,
    )
    return selected?.entry ?? 0
  }

  /** The landing half, as the panes call it. */
  const landOnBlock = (doc: Doc, blockIndex: number, viewportPx: number): number => {
    const top = blockTops(doc)[blockIndex]
    return resolvePreviewLandingScrollTop({
      blockTopPx: top,
      contentAbovePx: top - doc.edgePaddingPx,
      offsetPx: doc.offsetPx,
      maxScrollTopPx: maxScrollTop(doc, viewportPx),
    })
  }

  /**
   * Typography at both ends of the sliders, since the page margin scales with
   * the spacing multiplier alone (`11.25 * multiplier`) while a line of text
   * scales with the font size too -- so which of the two is larger flips
   * across the slider's range, and the old arithmetic was only ever correct
   * on one side of that flip.
   */
  const typographies = [
    { name: 'smallest font, tightest spacing', fontSizePx: 6, spacing: 0.8 },
    { name: 'smallest font, airiest spacing', fontSizePx: 6, spacing: 3 },
    { name: 'default', fontSizePx: 16, spacing: 1.6 },
    { name: 'largest font, airiest spacing', fontSizePx: 24, spacing: 3 },
    { name: 'largest font, tightest spacing', fontSizePx: 24, spacing: 0.8 },
  ]

  /**
   * First-block shapes that matter: a tall heading, an ordinary paragraph, and
   * a near-empty block (a rule), which is the one that can be shorter than the
   * offset itself.
   */
  const firstBlockShapes = [
    { name: 'heading first', firstBlockLines: 2 },
    { name: 'paragraph first', firstBlockLines: 1 },
    { name: 'rule first', firstBlockLines: 0.25 },
  ]

  for (const typography of typographies) {
    for (const shape of firstBlockShapes) {
      const linePx = typography.fontSizePx * typography.spacing
      const doc: Doc = {
        edgePaddingPx: 11.25 * typography.spacing,
        offsetPx: linePx,
        blockHeightsPx: [
          Math.max(1, shape.firstBlockLines * linePx),
          ...Array.from({ length: 40 }, (_unused, index) => (1 + (index % 4)) * linePx),
        ],
      }
      const viewportPx = 24 * linePx

      /**
       * The round trip is IDEMPOTENT: doing it twice lands where doing it once
       * did. That is the no-walk property stated directly, and it is stronger
       * than "it eventually settles" -- a walk also eventually settles, at the
       * top of the document.
       *
       * One round trip is allowed to move the reader, and at exactly one place
       * does: against the document's end, where the scroller has no room to
       * put the anchor a line down and the landing clamps. The reader is then
       * a fraction of a block above where the clamp held them, which is a real
       * boundary rather than a drift -- so the SECOND trip must already be
       * still, and every one after it.
       */
      const roundTrip = (scrollTopPx: number) =>
        landOnBlock(doc, captureBlockIndex(doc, scrollTopPx), viewportPx)

      it(`round trip is idempotent (${typography.name}, ${shape.name})`, () => {
        const startingPoints = [
          ...doc.blockHeightsPx.map((_unused, index) => landOnBlock(doc, index, viewportPx)),
          // Arbitrary reader positions too, not only landings -- a reader who
          // scrolled by hand and then switched notes goes through the same
          // trip.
          ...Array.from({ length: 25 }, (_unused, step) => step * 0.37 * viewportPx),
        ]

        for (const start of startingPoints) {
          // Two trips is the bound, not a budget to grow: the only position
          // the first trip is allowed to move is one the scroller clamped.
          const settled = roundTrip(roundTrip(start))

          for (let round = 0; round < 8; round += 1) {
            expect(roundTrip(settled)).toBe(settled)
          }
        }
      })

      it(`opens the document at its very top (${typography.name}, ${shape.name})`, () => {
        expect(landOnBlock(doc, 0, viewportPx)).toBe(0)
      })
    }
  }
})
