// The spoof text that covers the cut in a long journey.
//
// ## Why there is anything here at all
//
// The cut has to be covered by something, and "nothing" is not an option: the
// screen's average brightness would jump the moment the text left it, which
// reads as a flash whether or not the text was legible at the time. So the
// bridge shows text-shaped ink of the same density as the document it is
// standing in for.
//
// ## The rhythm is load-bearing; the glyphs are not
//
// Everything that makes this work is the TYPOGRAPHY: the same line height,
// the same left margin, the same distribution of line lengths, the same
// paragraph gaps. Match those and the substitution is invisible at any speed.
// Miss them -- fill every line to the right margin, say -- and the bridge is
// twice the ink of real prose, which is the brightness jump it exists to
// prevent, just moved.
//
// The glyphs themselves are free, and are an easter egg. Edit mode gets ones
// and zeroes, which suit a monospace grid exactly: every glyph is one cell
// wide, so the bridge lands on the same character grid the text does. Render
// view gets the Universal Declaration of Human Rights, which suits a
// proportional face and is, on the whole, a nicer thing to be carrying
// through a document than lorem ipsum.
//
// At the default speed a frame advances more than a viewport, so none of this
// is readable in flight. It becomes legible only for a reader who has turned
// the scroll speed down -- which is the right audience for it to find.

import declarationMarkdown from '../assets/hrd.md?raw'

/**
 * The Universal Declaration of Human Rights, in full.
 *
 * Published by the United Nations and freely reproducible with attribution;
 * the attribution belongs in the help guide rather than on the bridge, which
 * is meant to be glimpsed rather than read.
 *
 * In full rather than as one quoted article because one tile holds most of it
 * anyway -- ninety-seven lines at the width of an ordinary pane is around ten
 * thousand characters, and the Declaration is eleven -- so a reader who slows
 * the scroll down enough to read the bridge gets something that carries on
 * rather than something that loops every other line.
 *
 * The markdown is stripped rather than rendered: the bridge draws plain lines
 * of text, so heading hashes and rules would appear as literal characters in
 * the middle of the prose.
 */
export const BRIDGE_DECLARATION_TEXT = declarationMarkdown
  .replace(/^#{1,6}\s+/gm, '')
  .replace(/^-{3,}$/gm, '')
  .replace(/\s+/g, ' ')
  .trim()

export type ScrollBridgeAlphabet = 'binary' | 'declaration'

export interface BridgeLine {
  /** Fraction of the available width this line fills, 0..1. Zero is a gap. */
  fill: number
}

/**
 * A deterministic pseudo-random source.
 *
 * Deterministic so a given document and geometry always produce the same
 * bridge -- a texture that reshuffled itself between journeys would be one
 * more thing moving on screen for no reason the reader can see.
 */
function makeRandom(seed: number): () => number {
  let state = (seed | 0) || 1
  return () => {
    state = (state * 1664525 + 1013904223) | 0
    return ((state >>> 8) & 0xffffff) / 0xffffff
  }
}

/**
 * The line rhythm of a document, as fractions of the usable width.
 *
 * Sampled from the real thing rather than invented: the point is to match the
 * ink the reader is looking at, and a document of one-word list items has a
 * very different rhythm from one of full paragraphs. Blank lines are kept as
 * zero-fill entries, because the gaps between paragraphs are as much a part
 * of the texture as the lines are.
 */
export function sampleDocumentLineRhythm(options: {
  text: string
  charsPerLine: number
  sampleLines?: number
}): BridgeLine[] {
  const { text, charsPerLine, sampleLines = 240 } = options
  if (!(charsPerLine > 0)) return [{ fill: 0.9 }]

  const lines: BridgeLine[] = []
  let start = 0
  while (start <= text.length && lines.length < sampleLines) {
    let end = text.indexOf('\n', start)
    if (end === -1) end = text.length
    const length = end - start
    if (length === 0) {
      lines.push({ fill: 0 })
    } else {
      // A source line longer than one rendered line wraps: every full line but
      // the last runs to the margin, and the last one holds the remainder.
      let remaining = length
      while (remaining > charsPerLine && lines.length < sampleLines) {
        lines.push({ fill: 1 })
        remaining -= charsPerLine
      }
      if (lines.length < sampleLines) lines.push({ fill: remaining / charsPerLine })
    }
    start = end + 1
  }

  return lines.length > 0 ? lines : [{ fill: 0.9 }]
}

/**
 * The average advance width of a character in this face, in CSS pixels.
 *
 * Sampled from a mixed-case pangram rather than from one glyph: in a
 * proportional face an 'i' and a 'W' differ by a factor of four, and what the
 * rhythm needs is how many characters of ordinary prose fit on a line. In a
 * monospace face every sample gives the same answer anyway.
 *
 * Returns null where there is no canvas, which the caller should treat as
 * "no bridge" rather than guessing.
 */
export function measureAverageCharWidthPx(fontPx: number, fontFamily: string): number | null {
  if (typeof document === 'undefined') return null
  const context = document.createElement('canvas').getContext('2d')
  if (!context) return null
  const sample = 'the quick brown fox jumps over the lazy dog'
  context.font = `${fontPx}px ${fontFamily}`
  const width = context.measureText(sample).width
  if (!(width > 0)) return null
  return width / sample.length
}

/**
 * How tall the repeating tile should be, in lines.
 *
 * Deliberately not a round number, and deliberately large. A repeating pattern
 * scrolled at high speed can appear to freeze or run backwards when the
 * distance travelled per frame is close to a multiple of its period -- the
 * wagon-wheel effect -- and the one time the bridge is on screen is the one
 * time the scrolling is fastest. A tall, awkwardly-sized period keeps the
 * beat frequency far away from anything a frame rate can land on.
 */
export const BRIDGE_TILE_LINES = 97

export interface BridgeTextureRequest {
  alphabet: ScrollBridgeAlphabet
  /** The document's own rhythm, from sampleDocumentLineRhythm. */
  rhythm: BridgeLine[]
  widthPx: number
  lineHeightPx: number
  fontPx: number
  fontFamily: string
  color: string
  /**
   * What the text sits on.
   *
   * The tile has to be OPAQUE. A transparent one lets the real document show
   * through the spoof, which reads as a double exposure rather than as a
   * curtain -- the two texts interleaved, both legible, which is worse than
   * either the cut or the bridge on its own. Found by looking at it.
   */
  backgroundColor: string
  /** Left inset, matching the document's own text origin. */
  paddingLeftPx: number
  /** Right inset, so lines end where the document's do. */
  paddingRightPx: number
  devicePixelRatio: number
  seed: number
}

/** The text a line of the bridge is filled with, for the given alphabet. */
export function buildBridgeLineText(
  alphabet: ScrollBridgeAlphabet,
  approximateChars: number,
  random: () => number,
  wordCursor: { at: number },
): string {
  const chars = Math.max(0, Math.round(approximateChars))
  if (chars === 0) return ''

  if (alphabet === 'binary') {
    let out = ''
    for (let i = 0; i < chars; i += 1) out += random() < 0.5 ? '0' : '1'
    return out
  }

  // Words are taken in order and cycled, so the Declaration reads as itself
  // rather than as a bag of its words for anyone who slows down enough to look.
  const words = BRIDGE_DECLARATION_TEXT.split(' ')
  let out = ''
  while (out.length < chars) {
    const word = words[wordCursor.at % words.length]
    wordCursor.at += 1
    out = out.length === 0 ? word : `${out} ${word}`
  }
  return out
}

/**
 * Draws the repeating tile, returning a data URI for use as a background.
 *
 * A canvas rather than an SVG data URI because canvas can use the fonts the
 * page has already loaded, and the whole point is to match the ink of the real
 * text. An SVG background is loaded in its own document and would fall back to
 * a system face.
 *
 * Returns null where there is no canvas to draw on, which the caller should
 * treat as "no bridge available" rather than substituting something else.
 */
export function drawBridgeTile(request: BridgeTextureRequest): { dataUri: string; heightPx: number } | null {
  const {
    alphabet, rhythm, widthPx, lineHeightPx, fontPx, fontFamily, color,
    backgroundColor, paddingLeftPx, paddingRightPx, devicePixelRatio, seed,
  } = request
  if (typeof document === 'undefined') return null
  if (!(widthPx > 0) || !(lineHeightPx > 0) || rhythm.length === 0) return null

  const heightPx = BRIDGE_TILE_LINES * lineHeightPx
  const scale = Math.max(1, devicePixelRatio)
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(widthPx * scale))
  canvas.height = Math.max(1, Math.round(heightPx * scale))
  const context = canvas.getContext('2d')
  if (!context) return null

  context.scale(scale, scale)
  context.fillStyle = backgroundColor
  context.fillRect(0, 0, widthPx, heightPx)
  context.font = `${fontPx}px ${fontFamily}`
  context.fillStyle = color
  context.textBaseline = 'alphabetic'

  const usableWidthPx = Math.max(1, widthPx - paddingLeftPx - paddingRightPx)
  const glyphWidthPx = Math.max(1, context.measureText('0').width)
  const random = makeRandom(seed)
  const wordCursor = { at: 0 }

  for (let line = 0; line < BRIDGE_TILE_LINES; line += 1) {
    const { fill } = rhythm[line % rhythm.length]
    if (!(fill > 0)) continue
    const text = buildBridgeLineText(alphabet, (usableWidthPx * fill) / glyphWidthPx, random, wordCursor)
    if (text.length === 0) continue
    // Baseline sits where a real line's does: the font's own descent below the
    // line box's bottom is what keeps the bridge's rows on the same rhythm as
    // the document's.
    const baselineY = (line * lineHeightPx) + (lineHeightPx * 0.75)
    context.fillText(text, paddingLeftPx, baselineY, usableWidthPx)
  }

  return { dataUri: canvas.toDataURL('image/png'), heightPx }
}
