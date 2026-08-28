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
// with the two conversions the scrollbar needs. `previewHeightModel.ts` keeps
// the pixel substrate honest (native wheel scrolling and scrollToIndex both
// run on pixels); this keeps the THUMB honest, which is a stronger guarantee
// -- it is exact by construction, not accurate to within a fitted percent.
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
