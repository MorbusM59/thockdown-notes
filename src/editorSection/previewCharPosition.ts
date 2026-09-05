// The preview's position in CHARACTER space rather than pixel space.
//
// WHY THIS EXISTS
// A scrollbar thumb driven by pixels answers "how far down the rendered
// document am I", and to answer it the renderer has to know how tall every
// block is -- including the thousands nobody has looked at yet. That is the
// whole reason this app ever measured a document in the background, and every
// symptom that came with it: a thumb that creeps while heights are discovered,
// a thumb that jumps when a font changes, an "end of the document" that is
// wrong until it is measured.
//
// A Kindle does not have any of those problems, because its position is a
// *location* -- an offset into the source file. Nothing about a location
// depends on layout, so nothing about it changes when the layout does.
//
// This module is that: the block list, prefix-summed into character offsets,
// with the two conversions the scrollbar needs. This keeps the THUMB honest:
// exact by construction rather than accurate to within a fitted percent.
//
// The pixel substrate it interpolates through is now honest too, and for a
// better reason than it once was. A chunked document is windowed
// (previewWindow.ts), so every measurement this module is handed describes a
// block that is actually mounted -- there is no modelled height left anywhere
// for it to interpolate against.
//
// INTERPOLATION IS NOT OPTIONAL
// Block-granular position alone would freeze the thumb while the reader
// scrolls through one tall block and then snap it, which reads as a broken
// scrollbar. Every conversion here interpolates through the block it lands in,
// using the pixel geometry of THAT block only -- which is known, because it is
// on screen.

/** The subset of react-virtual's measurements this module needs. */
export interface PreviewBlockMeasurement {
  index: number
  start: number
  size: number
}

export interface PreviewCharViewport {
  startChar: number
  visibleChars: number
  totalChars: number
}

/**
 * Prefix-sums the block list into character offsets.
 *
 * Length is `blocks.length + 1`: the last entry is the document total, so
 * every block's span is `offsets[i + 1] - offsets[i]` with no special case at
 * the end. Each block also counts for one character more than its text, so a
 * genuinely empty block still occupies a position of its own rather than
 * sharing one with its neighbour (which would make the mapping non-monotone).
 */
export function buildBlockCharOffsets(blocks: readonly { text: string }[]): Float64Array {
  const offsets = new Float64Array(blocks.length + 1)
  let total = 0
  for (let index = 0; index < blocks.length; index += 1) {
    offsets[index] = total
    total += blocks[index].text.length + 1
  }
  offsets[blocks.length] = total
  return offsets
}

/** Index of the block whose character span contains `charOffset`. */
export function findBlockAtChar(offsets: Float64Array, charOffset: number): number {
  const blockCount = offsets.length - 1
  if (blockCount <= 0) return 0
  if (charOffset <= 0) return 0
  if (charOffset >= offsets[blockCount]) return blockCount - 1

  let low = 0
  let high = blockCount - 1
  while (low < high) {
    const mid = (low + high + 1) >> 1
    if (offsets[mid] <= charOffset) low = mid
    else high = mid - 1
  }
  return low
}

/** Index of the measurement whose pixel span contains `pixel`. */
export function findBlockAtPixel(measurements: readonly PreviewBlockMeasurement[], pixel: number): number {
  if (measurements.length === 0) return -1
  if (pixel <= measurements[0].start) return 0

  let low = 0
  let high = measurements.length - 1
  while (low < high) {
    const mid = (low + high + 1) >> 1
    if (measurements[mid].start <= pixel) low = mid
    else high = mid - 1
  }
  return low
}

/** Where a pixel position falls in character space, interpolated in-block. */
function pixelToChar(
  offsets: Float64Array,
  measurements: readonly PreviewBlockMeasurement[],
  pixel: number,
): number {
  const position = findBlockAtPixel(measurements, pixel)
  if (position < 0) return 0
  const measurement = measurements[position]
  const index = measurement.index
  if (index + 1 >= offsets.length) return offsets[offsets.length - 1]

  const blockChars = offsets[index + 1] - offsets[index]
  const fraction = measurement.size > 0
    ? Math.min(1, Math.max(0, (pixel - measurement.start) / measurement.size))
    : 0
  return offsets[index] + (blockChars * fraction)
}

/**
 * The viewport's span in character space.
 *
 * Returns null when there is nothing to say yet -- no blocks, or the
 * virtualizer has not produced measurements -- so the caller can fall back to
 * the pixel mapping rather than render a thumb from zeroes.
 */
export function resolvePreviewCharViewport(options: {
  offsets: Float64Array | null
  measurements: readonly PreviewBlockMeasurement[]
  scrollTop: number
  clientHeight: number
}): PreviewCharViewport | null {
  const { offsets, measurements, scrollTop, clientHeight } = options
  if (!offsets || offsets.length < 2 || measurements.length === 0) return null

  const totalChars = offsets[offsets.length - 1]
  if (!(totalChars > 0)) return null

  const startChar = pixelToChar(offsets, measurements, scrollTop)
  const endChar = pixelToChar(offsets, measurements, scrollTop + clientHeight)
  return {
    startChar: Math.min(startChar, totalChars),
    visibleChars: Math.max(0, Math.min(endChar, totalChars) - startChar),
    totalChars,
  }
}

/**
 * The pixel offset that puts `charOffset` at the top of the viewport.
 *
 * The inverse of the mapping above, and it has to stay the inverse: a drag
 * that reads position one way and writes it another puts the thumb somewhere
 * the reader did not drop it.
 */
export function resolvePreviewCharScrollOffset(options: {
  offsets: Float64Array | null
  measurements: readonly PreviewBlockMeasurement[]
  charOffset: number
}): number | null {
  const { offsets, measurements, charOffset } = options
  if (!offsets || offsets.length < 2 || measurements.length === 0) return null

  const blockIndex = findBlockAtChar(offsets, charOffset)
  // The measurements array is indexed by block index in this virtualizer (no
  // lanes, no filtering), but read it defensively -- an off-by-one here would
  // scroll to the wrong part of the document, silently.
  const measurement = measurements[blockIndex]?.index === blockIndex
    ? measurements[blockIndex]
    : measurements.find((entry) => entry.index === blockIndex)
  if (!measurement) return null

  const blockChars = offsets[blockIndex + 1] - offsets[blockIndex]
  const fraction = blockChars > 0
    ? Math.min(1, Math.max(0, (charOffset - offsets[blockIndex]) / blockChars))
    : 0
  return measurement.start + (measurement.size * fraction)
}

/**
 * How many characters the document's LAST screenful holds.
 *
 * The one number that makes the scrollbar exact at both ends. A reader's
 * furthest position is not the end of the document, it is the START of its last
 * screen -- so the span a scroll position moves through is
 * `totalChars - lastScreenChars`, and dividing by that gives a reading of
 * exactly 1 when the reader has arrived and exactly 0 when they have not left.
 * Every earlier attempt at this approximated the same quantity: a fraction of
 * the track subtracted from the span, or a midpoint blend between two readings
 * that each fell short at one end. This measures it instead.
 *
 * INTERPOLATED, not counted in blocks. Taking the last screen as "whole blocks
 * until they cover a viewport" is wrong in a way that has teeth: a document can
 * be a SINGLE top-level block -- markdown parses a list whose items are
 * separated by blank lines as one node, so a 400,000-character list is one
 * block a million pixels tall -- and counting that block in full reports the
 * whole document as its own last screen. The span then collapses to zero and
 * the thumb is pinned at the top of its track for the entire document. Found
 * exactly that way, by a test document that happened to be a loose list.
 *
 * So this asks where the screen's top edge falls in PIXELS and converts that
 * one position into characters, through the same in-block interpolation every
 * other reading here uses.
 *
 * Returns null when the measurements do not reach the document's last block,
 * which is the honest answer rather than a guess drawn from the wrong end of
 * the document. The caller stands in something approximate until they do.
 */
export function resolveLastScreenChars(options: {
  offsets: Float64Array | null
  measurements: readonly PreviewBlockMeasurement[]
  blockCount: number
  clientHeightPx: number
}): number | null {
  const { offsets, measurements, blockCount, clientHeightPx } = options
  if (!offsets || offsets.length < 2 || blockCount <= 0) return null
  if (measurements.length === 0 || !(clientHeightPx > 0)) return null

  const last = measurements[measurements.length - 1]
  if (last.index !== blockCount - 1) return null

  const totalChars = offsets[blockCount]
  const documentBottomPx = last.start + last.size
  const lastScreenTopPx = documentBottomPx - clientHeightPx

  // The measured tail is itself shorter than a screen. If it starts at the
  // document's first block then one screen holds the whole document; if it
  // does not, the measurements simply do not reach far enough back to say.
  if (lastScreenTopPx <= measurements[0].start) {
    return measurements[0].index === 0 ? totalChars : null
  }

  const startChar = pixelToChar(offsets, measurements, lastScreenTopPx)
  return Math.max(0, Math.min(totalChars, totalChars - startChar))
}
