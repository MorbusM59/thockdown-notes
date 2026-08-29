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

import {
  drawBridgeTile,
  sampleDocumentLineRhythm,
  type ScrollBridgeAlphabet,
} from './scrollBridgeTexture'

export interface ScrollBridgeStyle {
  alphabet: ScrollBridgeAlphabet
  /** The document's own text, for its line rhythm. */
  text: string
  charsPerLine: number
  lineHeightPx: number
  fontPx: number
  fontFamily: string
  color: string
  /**
   * The flat editor background the pane's own layers are built on.
   *
   * Applied to the band rather than painted into the glyph tile: the tile is
   * only the text, so the band can stack the same background, texture and text
   * the pane does.
   */
  backgroundColor: string
  paddingLeftPx: number
  paddingRightPx: number
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
  /** Read fresh each journey, so typography changes need no invalidation. */
  readStyle: () => ScrollBridgeStyle | null
}

export interface ScrollBridge {
  /**
   * Opens the curtain for a journey.
   *
   * Returns the distance it will actually take to sweep through, which may be
   * longer than asked: the band has to be at least a viewport tall to cover
   * anything, and the sweep has to be at least a viewport longer than that.
   * Returns null when no curtain can be drawn, which the caller must treat as
   * "do not cut" rather than cutting without cover.
   */
  begin: (requestedDistancePx: number, direction: -1 | 1) => number | null
  /** Moves the curtain to `travelledPx` into its sweep. */
  advance: (travelledPx: number) => void
  /** Whether the viewport is fully covered, and so safe to jump underneath. */
  isCovering: (travelledPx: number) => boolean
  end: () => void
}

const surfaces = new WeakMap<HTMLElement, ScrollBridgeSurface>()

/** Attaches a bridge surface to a scroller. Returns a function that detaches it. */
export function registerScrollBridge(scroller: HTMLElement, surface: ScrollBridgeSurface): () => void {
  surfaces.set(scroller, surface)
  return () => {
    if (surfaces.get(scroller) === surface) surfaces.delete(scroller)
  }
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

/** The bridge for a scroller, or null if nothing has registered one. */
export function resolveScrollBridge(scroller: HTMLElement): ScrollBridge | null {
  const surface = surfaces.get(scroller)
  if (!surface) return null

  let root: HTMLElement | null = null
  let band: HTMLElement | null = null
  let bandHeightPx = 0
  let viewportHeightPx = 0
  let sweepDistancePx = 0
  let direction: -1 | 1 = 1

  const teardown = () => {
    root?.remove()
    root = null
    band = null
  }

  return {
    begin: (requestedDistancePx, nextDirection) => {
      const host = surface.host
      viewportHeightPx = host.clientHeight
      const widthPx = host.clientWidth
      if (!(viewportHeightPx > 0) || !(widthPx > 0)) return null

      const style = surface.readStyle()
      if (!style) return null

      const key = [
        style.alphabet, widthPx, style.lineHeightPx, style.fontPx, style.fontFamily,
        style.color, style.backgroundColor, style.paddingLeftPx, style.paddingRightPx, style.charsPerLine,
        style.text.length,
      ].join('|')
      let tile = tiles.get(host)
      if (!tile || tile.key !== key) {
        const drawn = drawBridgeTile({
          alphabet: style.alphabet,
          rhythm: sampleDocumentLineRhythm({ text: style.text, charsPerLine: style.charsPerLine }),
          widthPx,
          lineHeightPx: style.lineHeightPx,
          fontPx: style.fontPx,
          fontFamily: style.fontFamily,
          color: style.color,
          paddingLeftPx: style.paddingLeftPx,
          paddingRightPx: style.paddingRightPx,
          devicePixelRatio: typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1,
          seed: style.text.length || 1,
        })
        if (!drawn) return null
        tile = { key, dataUri: drawn.dataUri, heightPx: drawn.heightPx }
        tiles.set(host, tile)
      }

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

      // The pane's own three layers, in the pane's own order: the flat editor
      // background, the tinted mask texture over it, then the text. Painting
      // a single flat colour instead -- which is what this did first -- shows
      // a visibly different background for the length of the bridge, because
      // the texture tint is missing from it.
      //
      // The texture layer reuses the REAL texture element's class rather than
      // restating its declarations, so the tint, mask image, tile size and
      // repeat can never drift from the ones the document is sitting on. Its
      // mask is anchored to the band, so the grain travels with the spoof
      // text the same way the document's travels with the document.
      band.style.backgroundColor = style.backgroundColor
      const texture = document.createElement('div')
      texture.className = 'markdown-preview-texture'
      const glyphs = document.createElement('div')
      glyphs.className = 'scroll-bridge-band-text'
      glyphs.style.backgroundImage = `url(${tile.dataUri})`
      glyphs.style.backgroundSize = `100% ${tile.heightPx}px`
      band.appendChild(texture)
      band.appendChild(glyphs)
      root.appendChild(band)
      host.appendChild(root)

      // Place it before the first frame, so it never paints at a default
      // position first.
      const startTop = direction > 0 ? viewportHeightPx : -bandHeightPx
      band.style.top = `${startTop}px`
      return sweepDistancePx
    },

    advance: (travelledPx) => {
      if (!band) return
      const travelled = Math.max(0, Math.min(sweepDistancePx, travelledPx))
      // Downward journeys move content up the screen, so the band comes up
      // from below; upward journeys are the mirror.
      const top = direction > 0
        ? viewportHeightPx - travelled
        : -bandHeightPx + travelled
      band.style.top = `${top}px`
    },

    isCovering: (travelledPx) => (
      bandHeightPx > 0
      && travelledPx >= viewportHeightPx
      && travelledPx <= bandHeightPx
    ),

    end: teardown,
  }
}
