// The curtain that covers the cut in a long journey.
//
// ## What it is
//
// A band of spoof text (scrollBridgeTexture.ts) that sweeps through the pane
// at the journey's own speed. Its top edge enters from the far side, it covers
// the viewport for a moment, and its trailing edge leaves the way it came. The
// real scroller does its jump underneath while the viewport is fully covered,
// so the substitution is never seen -- the reader sees text scroll away, text
// scroll past, and text scroll in.
//
// The seams are the whole trick. A curtain that simply appeared would be a cut
// with extra steps; one whose edges sweep at the same speed as everything else
// is just more travel.
//
// ## Why it moves the way it does
//
// By `top`, not by `transform`. A transform promotes the element onto its own
// compositing layer, and this repository has two commits fixing a BLACK EDIT
// PANE caused by exactly that -- a composited layer underneath the edge-fade
// mask, at some border radii. `top` on a single childless element is a layout
// of one box and a clipped repaint, which is cheap, and it keeps the pane out
// of the compositor entirely.
//
// The band is clipped by a viewport-sized host rather than being laid out at
// its full height, so a bridge that is eighteen thousand pixels long costs the
// same as one that is two thousand.

import { drawBridgeTile, sampleDocumentLineRhythm } from './scrollBridgeTexture'
import { traceScroll } from '@thockdown/interaction/scrollTrace'
import { provideScrollBridge, type ScrollBridge } from '@thockdown/interaction/scrollBridgeRegistry'

export interface ScrollBridgeStyle {
  /** The document's own text, for its line rhythm. */
  text: string
  charsPerLine: number
  lineHeightPx: number
  fontPx: number
  fontFamily: string
  color: string
  paddingLeftPx: number
  paddingRightPx: number
  /** Set only by a pane with a character-cell grid -- see the texture module. */
  cellWidthPx?: number
  /**
   * The row grid the curtain must land on, where the pane has one.
   *
   * Edit view only, and not the same thing as drawing the tile on a grid --
   * that got the glyphs right within the band while the band itself slid
   * continuously underneath them, so the spoof sat at a different sub-row
   * offset every frame and matched the real rows only by luck. Measured
   * across a journey: the document's own phase was 0 on all 34 frames, the
   * curtain's ran through 1, 5, 7, 9, 15, 19, 21, 23, 25.
   *
   * `phasePx` is where the document's rows actually sit within the host, so
   * the curtain snaps to the reader's grid rather than to a grid of its own.
   */
  rowGrid?: { heightPx: number; phasePx: number }
}

export interface ScrollBridgeSurface {
  /**
   * The non-scrolling box to draw into.
   *
   * NOT the scroller: an element inside it would scroll with the content and
   * extend its scrollable height, which on a bridge this tall would be
   * catastrophic rather than merely wrong.
   */
  host: HTMLElement
  /**
   * The layer holding the real text, which is clipped away wherever the band
   * covers it.
   *
   * This is how the bridge gets the pane's background exactly right: it does
   * not paint one. Reconstructing it was tried and is not reliably possible --
   * the backdrop is a gradient and a tint on ancestors rather than a flat
   * colour anywhere, so reading a background-color up the tree returns white
   * and the bridge showed a visibly different paper for its duration. Clipping
   * the text instead leaves the real background and the real texture showing
   * through, and nothing has to be reproduced to match.
   */
  textLayer: HTMLElement
  /** Read fresh each journey, so typography changes need no invalidation. */
  readStyle: () => ScrollBridgeStyle | null
}

/**
 * Attaches a bridge surface to a scroller. Returns a function that detaches it.
 *
 * The smooth-scroll engines live in `@thockdown/interaction` and know only the
 * `ScrollBridge` interface; this registers the text-texture implementation of
 * it with that package's registry, so the engines never import editor code.
 */
export function registerScrollBridge(scroller: HTMLElement, surface: ScrollBridgeSurface): () => void {
  return provideScrollBridge(scroller, () => openScrollBridge(surface))
}

interface TileCache {
  key: string
  dataUri: string
  heightPx: number
}

const tiles = new WeakMap<HTMLElement, TileCache>()

/**
 * How much longer than the viewport the sweep must be.
 *
 * The band is `sweep - viewport` tall and has to cover a whole viewport, so
 * the sweep needs two viewports at the very least; a third gives the cover a
 * few frames of margin at either end rather than existing for one instant.
 */
const MINIMUM_SWEEP_VIEWPORTS = 3

/** Opens a bridge over `surface`. */
function openScrollBridge(surface: ScrollBridgeSurface): ScrollBridge | null {

  let root: HTMLElement | null = null
  let band: HTMLElement | null = null
  let bandHeightPx = 0
  let viewportHeightPx = 0
  let sweepDistancePx = 0
  let direction: -1 | 1 = 1
  let rowGrid: { heightPx: number; phasePx: number } | null = null
  // Trace-only bookkeeping; costs two assignments per frame when the flag is
  // off, which is cheaper than the branch that would avoid them.
  let lastTravelledPx: number | null = null
  let wasCovering = false
  let tileHeightForTrace = 1

  /**
   * Where the band may actually sit.
   *
   * On a row grid the curtain moves the way the text under it does -- a row at
   * a time, on the reader's own rows. Off one it moves continuously, as that
   * pane's text does.
   *
   * `round` is what a sweep wants: the nearest row to where the motion says it
   * should be. The parked start needs `out` instead -- the row on the far side
   * of where it was asked to sit, so a band waiting out the ramp-up cannot
   * round a pixel INTO the pane and show a hairline of spoof over real text
   * with no clip yet applied to hide it.
   */
  const placeBandTopPx = (topPx: number, mode: 'round' | 'out' = 'round'): number => {
    if (!rowGrid) return topPx
    const { heightPx, phasePx } = rowGrid
    const rows = (topPx - phasePx) / heightPx
    const snappedRows = mode === 'round'
      ? Math.round(rows)
      : (direction > 0 ? Math.ceil(rows) : Math.floor(rows))
    return phasePx + (snappedRows * heightPx)
  }

  const teardown = () => {
    if (root) {
      traceScroll(() => `bridge end     last travelled=${lastTravelledPx === null ? 'never advanced' : Math.round(lastTravelledPx)}`
        + ` of sweep=${Math.round(sweepDistancePx)}`
        + (lastTravelledPx === null ? ' <-- curtain was raised but NEVER MOVED' : ''))
    }
    lastTravelledPx = null
    wasCovering = false
    root?.remove()
    root = null
    band = null
    // Whatever happened, the reader gets their whole document back.
    surface.textLayer.style.clipPath = ''
  }

  return {
    begin: (requestedDistancePx, nextDirection) => {
      const host = surface.host
      viewportHeightPx = host.clientHeight
      const widthPx = host.clientWidth
      if (!(viewportHeightPx > 0) || !(widthPx > 0)) {
        traceScroll(() => `bridge DECLINED host has no box (${widthPx}x${viewportHeightPx})`)
        return null
      }

      const style = surface.readStyle()
      if (!style) {
        traceScroll(() => 'bridge DECLINED readStyle() returned null')
        return null
      }

      const key = [
        widthPx, style.lineHeightPx, style.fontPx, style.fontFamily,
        style.color, style.paddingLeftPx, style.paddingRightPx, style.charsPerLine,
        style.cellWidthPx,
        style.text.length,
      ].join('|')
      let tile = tiles.get(host)
      if (!tile || tile.key !== key) {
        const drawn = drawBridgeTile({
          rhythm: sampleDocumentLineRhythm({ text: style.text, charsPerLine: style.charsPerLine }),
          widthPx,
          lineHeightPx: style.lineHeightPx,
          fontPx: style.fontPx,
          fontFamily: style.fontFamily,
          color: style.color,
          paddingLeftPx: style.paddingLeftPx,
          paddingRightPx: style.paddingRightPx,
          cellWidthPx: style.cellWidthPx,
          devicePixelRatio: typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1,
        })
        if (!drawn) {
          traceScroll(() => 'bridge DECLINED drawBridgeTile() returned null')
          return null
        }
        tile = { key, dataUri: drawn.dataUri, heightPx: drawn.heightPx }
        tiles.set(host, tile)
      }
      tileHeightForTrace = Math.max(1, tile.heightPx)

      rowGrid = style.rowGrid && style.rowGrid.heightPx > 0 ? style.rowGrid : null
      direction = nextDirection
      sweepDistancePx = Math.max(requestedDistancePx, viewportHeightPx * MINIMUM_SWEEP_VIEWPORTS)
      bandHeightPx = sweepDistancePx - viewportHeightPx

      teardown()
      root = document.createElement('div')
      root.className = 'scroll-bridge'
      root.setAttribute('aria-hidden', 'true')
      band = document.createElement('div')
      band.className = 'scroll-bridge-band'
      band.style.height = `${bandHeightPx}px`

      // Glyphs on transparency, and nothing else. The band paints no
      // background of its own -- the real one, texture and all, shows straight
      // through it, because the real TEXT is clipped away wherever the band
      // is (see advance below). That is the only way to be certain the paper
      // matches: nothing is reproduced, so nothing can fail to match.
      band.style.backgroundImage = `url(${tile.dataUri})`
      band.style.backgroundSize = `100% ${tile.heightPx}px`
      root.appendChild(band)
      host.appendChild(root)

      // Place it before the first frame, so it never paints at a default
      // position first.
      const startTop = placeBandTopPx(direction > 0 ? viewportHeightPx : -bandHeightPx, 'out')
      band.style.top = `${startTop}px`

      // The three numbers that decide whether the curtain can read as text at
      // all. It sweeps at the journey's peak speed, so at 60fps it advances
      // `sweep/duration/60` per frame; when that is more than a viewport the
      // reader sees disjoint slices rather than motion, and when it is near a
      // half-multiple of the tile period the slices alternate between two
      // phases and it reads as a flicker -- the wagon-wheel case
      // BRIDGE_TILE_LINES was chosen to avoid. `requested` vs `sweep` also
      // shows when MINIMUM_SWEEP_VIEWPORTS had to stretch a short bridge.
      traceScroll(() => {
        const tileHeightPx = tile ? tile.heightPx : 0
        return `bridge begin   requested=${Math.round(requestedDistancePx)}`
          + ` sweep=${Math.round(sweepDistancePx)} band=${Math.round(bandHeightPx)}`
          + ` viewport=${Math.round(viewportHeightPx)} tile=${Math.round(tileHeightPx)}`
          + ` dir=${direction} grid=${rowGrid ? 'rows' : 'free'}`
      })
      return sweepDistancePx
    },

    resizeSweep: (nextSweepPx) => {
      if (!band) return sweepDistancePx
      const nextSweep = Math.max(nextSweepPx, viewportHeightPx * MINIMUM_SWEEP_VIEWPORTS)
      if (Math.abs(nextSweep - sweepDistancePx) < 1) return sweepDistancePx
      sweepDistancePx = nextSweep
      bandHeightPx = sweepDistancePx - viewportHeightPx
      band.style.height = `${bandHeightPx}px`
      traceScroll(() => `bridge resize  sweep=${Math.round(sweepDistancePx)} band=${Math.round(bandHeightPx)}`)
      return sweepDistancePx
    },

    advance: (travelledPx) => {
      if (!band) return
      const travelled = Math.max(0, Math.min(sweepDistancePx, travelledPx))
      // Per-frame advance, measured rather than assumed: this is the number
      // that says whether the spoof could be seen. Logged on the first
      // advance and then only when cover starts or ends, so a bridge costs a
      // handful of lines rather than one per frame.
      if (lastTravelledPx === null) {
        traceScroll(() => `bridge advance first travelled=${Math.round(travelled)}`)
      } else if (travelled !== lastTravelledPx) {
        const stepPx = travelled - lastTravelledPx
        const covering = travelled >= viewportHeightPx && travelled <= bandHeightPx
        if (covering !== wasCovering) {
          wasCovering = covering
          traceScroll(() => `bridge ${covering ? 'COVERS ' : 'uncover'} travelled=${Math.round(travelled)}`
            + ` step=${Math.round(stepPx)}px/frame`
            + ` =${(stepPx / Math.max(1, viewportHeightPx)).toFixed(2)} viewports`
            + `, ${(stepPx / Math.max(1, tileHeightForTrace)).toFixed(3)} tiles`
            + (Math.abs((stepPx / Math.max(1, tileHeightForTrace)) % 1 - 0.5) < 0.12
              ? ' <-- near half a tile per frame: reads as a two-state flicker'
              : ''))
        }
      }
      lastTravelledPx = travelled
      // Downward journeys move content up the screen, so the band comes up
      // from below; upward journeys are the mirror.
      const topPx = placeBandTopPx(direction > 0
        ? viewportHeightPx - travelled
        : -bandHeightPx + travelled)
      band.style.top = `${topPx}px`

      // Hide the real text exactly where the band is. The band always covers a
      // strip running to one edge of the pane -- it enters from one side and
      // leaves by the other -- so what remains visible is always a single
      // rectangle, and an inset clip can say it. Written from the band's own
      // edges rather than per direction, so a journey up the document and one
      // down it are the same arithmetic.
      const bottomPx = topPx + bandHeightPx
      surface.textLayer.style.clipPath = topPx > 0
        ? `inset(0px 0px ${Math.max(0, viewportHeightPx - topPx)}px 0px)`
        : `inset(${Math.max(0, bottomPx)}px 0px 0px 0px)`
    },

    isCovering: (travelledPx) => (
      bandHeightPx > 0
      && travelledPx >= viewportHeightPx
      && travelledPx <= bandHeightPx
    ),

    end: teardown,
  }
}
