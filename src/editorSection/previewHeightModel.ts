// A height model for preview blocks: predicts how tall a block will render
// from its SOURCE TEXT, without rendering it.
//
// WHY THIS EXISTS
// The preview's scrollbar is a pixel quantity -- react-virtual's offsets are a
// running sum of block heights -- so "where does the end of the document sit"
// used to require measuring every block. On a 1.5M-character note that is
// 18,000 markdown renders, and the background survey that did it took tens of
// seconds (minutes, on the machine that reported it). The reader spends that
// whole time with a scrollbar that is quietly wrong.
//
// An e-reader does not do this. A Kindle's progress is a *location* -- a fixed
// slice of the source file, assigned at import -- so changing the font
// repaginates the screen you are on and nothing else: the progress metric was
// never a pixel quantity to begin with. Its page numbers, when it shows any,
// are looked up from a precomputed map, not computed on the device.
//
// This module is that idea in the shape this app needs. Heights stay pixels
// (so the thumb stays visually proportional -- a picture-heavy page really is
// taller than a page of prose), but they are DERIVED from the source text
// through a small model that is fitted, once, from a sample of ~100 real
// rendered blocks. Re-casting the whole document after a font change is then
// arithmetic over the block list -- microseconds -- instead of a re-survey.
//
// WHY IT IS FITTED RATHER THAN CALCULATED
// Deriving heights from font metrics means knowing the line-box rounding, the
// margin collapsing, the per-element padding and the wrap points of every
// block type this app can render, and being wrong about any of them silently
// biases the whole document. Fitting sidesteps all of it: measure a sample,
// solve for the two numbers that describe each block SHAPE, and let the
// residual tell you how much to trust the result (see fitPreviewHeightModel's
// `medianErrorPct`, which the caller uses to decide whether to fall back to
// measuring everything).

/** Block shapes that render differently enough to need their own parameters. */
export type PreviewBlockShape =
  | 'heading1'
  | 'heading2'
  | 'heading3plus'
  | 'quote'
  | 'list'
  | 'code'
  | 'table'
  | 'media'
  | 'rule'
  | 'paragraph'

export interface PreviewHeightSample {
  text: string
  heightPx: number
}

export interface PreviewShapeModel {
  /** Fixed cost of the block: margins, padding, borders. */
  interceptPx: number
  /** Cost of one rendered line. */
  perLinePx: number
  /** How many source characters fit on a rendered line, for this shape. */
  charsPerLine: number
  sampleCount: number
}

export interface PreviewHeightModel {
  shapes: Partial<Record<PreviewBlockShape, PreviewShapeModel>>
  /** Used for shapes with too few samples of their own to fit. */
  fallback: PreviewShapeModel
  /** Median absolute error across the fitted samples, as a percent of height. */
  medianErrorPct: number
  /**
   * Signed error of the model's SUM over the samples, as a percent.
   *
   * This is the number the scrollbar actually cares about. Per-block error is
   * mostly the word wrap falling a line either side of where arithmetic says,
   * which is unbiased and cancels across thousands of blocks; a systematic
   * bias does not cancel, and is what would put the end of the document in the
   * wrong place. A model can be honestly useful with a 20% median block error
   * and a 1% bias, and useless the other way around.
   */
  biasPct: number
  sampleCount: number
}

/**
 * Candidate characters-per-line values for the grid search.
 *
 * Wide, because this is not the same number for every shape: an h1 at double
 * size fits a third of what a paragraph does, and a code block does not wrap
 * at all (it overflows horizontally), which the search expresses by picking a
 * value larger than any line in it.
 */
const CHARS_PER_LINE_CANDIDATES: number[] = (() => {
  const out: number[] = []
  for (let value = 8; value <= 400; value += 4) out.push(value)
  return out
})()

/**
 * How many blocks of each shape to measure for the fit, and the ceiling on the
 * whole calibration sample.
 *
 * The fit needs enough of each shape to separate the fixed cost from the
 * per-line cost, and enough spread through the document that a novel is not
 * modelled from its title page. It does NOT need thousands: the parameters
 * stop moving long before that, and every extra sample is a markdown render
 * the reader is waiting through.
 */
export const PREVIEW_CALIBRATION_SAMPLES_PER_SHAPE = 6
export const PREVIEW_CALIBRATION_MAX_SAMPLES = 160

/**
 * When to trust a fitted model instead of measuring the document the slow way.
 *
 * Both bars matter, and they say different things. The bias bar is tight
 * because a systematic offset is exactly the defect this feature exists to
 * remove -- a 6% bias on a 50,000px document puts the end of it 3,000px from
 * where the scrollbar says. The per-block bar is loose because wrap-point
 * noise is unbiased and cancels: a 25% median error on 56px blocks is ±14px
 * per block, random sign, which over 18,000 blocks is a rounding error in the
 * total.
 */
export const PREVIEW_MODEL_MAX_BIAS_PCT = 4
export const PREVIEW_MODEL_MAX_MEDIAN_ERROR_PCT = 30

/** Below this many samples a shape cannot be fitted and borrows the fallback. */
const MIN_SAMPLES_PER_SHAPE = 4

/** Nothing renders shorter than this; a model that says otherwise is wrong. */
const MIN_PREDICTED_HEIGHT_PX = 8

/**
 * Classifies a block by its first line's markdown sigil.
 *
 * Deliberately a string test rather than a parse: this runs over every block
 * of the document, and the parse result is not needed -- only which bucket the
 * block's height belongs in. A misclassified block costs one block's accuracy,
 * not correctness.
 */
export function resolvePreviewBlockShape(text: string): PreviewBlockShape {
  const firstLine = text.slice(0, text.indexOf('\n') === -1 ? undefined : text.indexOf('\n')).trim()
  if (firstLine.length === 0) return 'paragraph'

  if (/^#{3,6}\s/.test(firstLine)) return 'heading3plus'
  if (/^##\s/.test(firstLine)) return 'heading2'
  if (/^#\s/.test(firstLine)) return 'heading1'
  if (/^(?:```|~~~)/.test(firstLine)) return 'code'
  if (/^(?:[-*_]\s*){3,}$/.test(firstLine)) return 'rule'
  if (/^>/.test(firstLine)) return 'quote'
  if (/^!\[/.test(firstLine)) return 'media'
  if (/^\|/.test(firstLine)) return 'table'
  if (/^[-*+]\s/.test(firstLine)) return 'list'
  if (/^\d+[.)]\s/.test(firstLine)) return 'list'
  return 'paragraph'
}

/** Strips the markdown that will not be rendered as text on the line. */
function visibleLineLength(line: string): number {
  const stripped = line
    .replace(/^\s*>+\s?/, '')
    .replace(/^\s*#{1,6}\s+/, '')
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+/, '')
    .replace(/^\s*\|/, '')
  return stripped.trim().length
}

/**
 * How many rendered lines a block's source will occupy.
 *
 * Per SOURCE LINE, not per block: a five-item list is five lines however short
 * the items are, and summing the block's characters instead would call it one.
 * Hard line structure in the source is the one thing about the rendered result
 * that is knowable for free, so it is worth using.
 */
export function predictPreviewBlockLines(text: string, charsPerLine: number): number {
  if (!(charsPerLine > 0)) return 1
  let lines = 0
  let start = 0
  while (start <= text.length) {
    let end = text.indexOf('\n', start)
    if (end === -1) end = text.length
    const length = visibleLineLength(text.slice(start, end))
    // An empty source line inside a block (a blank line in a code fence, a
    // list item's continuation) still occupies a line box.
    lines += length === 0 ? 1 : Math.ceil(length / charsPerLine)
    start = end + 1
  }
  return Math.max(1, lines)
}

/** Ordinary least squares through (x, y); returns a zero slope if degenerate. */
function fitLine(xs: number[], ys: number[]): { intercept: number; slope: number } {
  const n = xs.length
  let sumX = 0
  let sumY = 0
  let sumXY = 0
  let sumXX = 0
  for (let i = 0; i < n; i += 1) {
    sumX += xs[i]
    sumY += ys[i]
    sumXY += xs[i] * ys[i]
    sumXX += xs[i] * xs[i]
  }
  const denominator = (n * sumXX) - (sumX * sumX)
  const mean = n > 0 ? sumY / n : 0
  // Every sample predicted the same line count (a document of one-line
  // paragraphs), so there is no slope to find -- the mean IS the model.
  if (Math.abs(denominator) < 1e-9) return { intercept: mean, slope: 0 }

  const slope = ((n * sumXY) - (sumX * sumY)) / denominator
  if (slope <= 0) return { intercept: mean, slope: 0 }
  return { intercept: (sumY - (slope * sumX)) / n, slope }
}

function fitShape(samples: PreviewHeightSample[]): PreviewShapeModel | null {
  if (samples.length === 0) return null

  let best: PreviewShapeModel | null = null
  let bestError = Number.POSITIVE_INFINITY

  // The two free parameters (intercept, per-line) are solved exactly by least
  // squares for any given charsPerLine, so only charsPerLine needs searching --
  // one cheap 1-D grid instead of a three-parameter optimizer.
  for (const charsPerLine of CHARS_PER_LINE_CANDIDATES) {
    const xs = samples.map((sample) => predictPreviewBlockLines(sample.text, charsPerLine))
    const ys = samples.map((sample) => sample.heightPx)
    const { intercept, slope } = fitLine(xs, ys)

    let sse = 0
    for (let i = 0; i < xs.length; i += 1) {
      const residual = ys[i] - (intercept + (slope * xs[i]))
      sse += residual * residual
    }
    if (sse < bestError) {
      bestError = sse
      best = { interceptPx: intercept, perLinePx: slope, charsPerLine, sampleCount: samples.length }
    }
  }

  return best
}

function predictWithShapeModel(model: PreviewShapeModel, text: string): number {
  const lines = predictPreviewBlockLines(text, model.charsPerLine)
  return Math.max(MIN_PREDICTED_HEIGHT_PX, model.interceptPx + (model.perLinePx * lines))
}

/**
 * Fits a model from measured samples.
 *
 * Returns null when there is nothing to fit. The caller is expected to look at
 * `medianErrorPct` before trusting the result: a document whose height is
 * genuinely not a function of its source text -- images, embeds, anything
 * whose size arrives from outside the markdown -- will fit badly, and that is
 * the signal to measure it the slow way instead of guessing confidently.
 */
export function fitPreviewHeightModel(samples: readonly PreviewHeightSample[]): PreviewHeightModel | null {
  const usable = samples.filter((sample) => sample.heightPx > 0)
  if (usable.length === 0) return null

  const fallback = fitShape([...usable])
  if (!fallback) return null

  const byShape = new Map<PreviewBlockShape, PreviewHeightSample[]>()
  for (const sample of usable) {
    const shape = resolvePreviewBlockShape(sample.text)
    const bucket = byShape.get(shape)
    if (bucket) bucket.push(sample)
    else byShape.set(shape, [sample])
  }

  const shapes: Partial<Record<PreviewBlockShape, PreviewShapeModel>> = {}
  for (const [shape, shapeSamples] of byShape) {
    if (shapeSamples.length < MIN_SAMPLES_PER_SHAPE) continue
    const fitted = fitShape(shapeSamples)
    if (fitted) shapes[shape] = fitted
  }

  const model: PreviewHeightModel = { shapes, fallback, medianErrorPct: 0, biasPct: 0, sampleCount: usable.length }

  let predictedTotal = 0
  let measuredTotal = 0
  const errors = usable.map((sample) => {
    const predicted = predictPreviewBlockHeight(model, sample.text)
    predictedTotal += predicted
    measuredTotal += sample.heightPx
    return sample.heightPx > 0 ? Math.abs(predicted - sample.heightPx) / sample.heightPx * 100 : 0
  }).sort((a, b) => a - b)
  model.medianErrorPct = errors[Math.floor(errors.length / 2)] ?? 0
  model.biasPct = measuredTotal > 0 ? ((predictedTotal - measuredTotal) / measuredTotal) * 100 : 0

  return model
}

/** Predicted rendered height, in pixels, of a block with this source text. */
export function predictPreviewBlockHeight(model: PreviewHeightModel, text: string): number {
  const shape = resolvePreviewBlockShape(text)
  return predictWithShapeModel(model.shapes[shape] ?? model.fallback, text)
}

/**
 * Picks which blocks to measure for the fit.
 *
 * Stratified by shape and spread evenly through the document, because both
 * axes matter: a sample of only paragraphs cannot fit a heading, and a sample
 * taken entirely from the first screen would fit whatever that screen happens
 * to be (a title page, a table of contents) and apply it to a novel.
 *
 * The budget is then split PROPORTIONALLY to how much of the document each
 * shape actually occupies, over a floor of `perShape`. Measured: an even split
 * left the dominant shape with a dozen samples to fit a slope that then
 * multiplies ten thousand blocks, and the resulting sampling error showed up
 * as a 2.6% bias on the document total -- 3,300px on a 400k-character note.
 * Spending the same budget where the blocks are took that to well under a
 * percent, for the same number of renders.
 *
 * Block 0 is always included -- it carries a first-child margin reset the rest
 * of the document does not, so it is the one block whose height is reliably
 * not like its neighbours'.
 */
export function planPreviewHeightSample(options: {
  blockCount: number
  shapeAt: (index: number) => PreviewBlockShape
  perShape: number
  maxTotal: number
}): number[] {
  const { blockCount, shapeAt, perShape, maxTotal } = options
  if (blockCount <= 0 || perShape <= 0 || maxTotal <= 0) return []

  const byShape = new Map<PreviewBlockShape, number[]>()
  for (let index = 0; index < blockCount; index += 1) {
    const shape = shapeAt(index)
    const bucket = byShape.get(shape)
    if (bucket) bucket.push(index)
    else byShape.set(shape, [index])
  }

  // Floor first, so a shape that appears twice in the document is still
  // represented; then hand what is left out by share of the document.
  const quota = new Map<PreviewBlockShape, number>()
  let spent = 0
  for (const [shape, indices] of byShape) {
    const take = Math.min(perShape, indices.length)
    quota.set(shape, take)
    spent += take
  }
  let remaining = maxTotal - spent
  if (remaining > 0) {
    const shareable = [...byShape.entries()]
      .map(([shape, indices]) => ({ shape, indices, headroom: indices.length - (quota.get(shape) ?? 0) }))
      .filter((entry) => entry.headroom > 0)
    const totalWeight = shareable.reduce((sum, entry) => sum + entry.indices.length, 0)
    for (const entry of shareable) {
      if (remaining <= 0) break
      const share = Math.min(
        entry.headroom,
        Math.min(remaining, Math.round((entry.indices.length / Math.max(1, totalWeight)) * (maxTotal - spent))),
      )
      quota.set(entry.shape, (quota.get(entry.shape) ?? 0) + share)
      remaining -= share
    }
  }

  const picked = new Set<number>([0])
  for (const [shape, indices] of byShape) {
    const take = Math.min(quota.get(shape) ?? 0, indices.length)
    for (let i = 0; i < take; i += 1) {
      // Evenly spaced through this shape's own occurrences, not the first N of
      // them, so a shape that only appears late in the document is still
      // sampled where it lives.
      const position = take === 1 ? 0 : Math.round((i * (indices.length - 1)) / (take - 1))
      picked.add(indices[position])
    }
  }

  const ordered = [...picked].sort((a, b) => a - b)
  if (ordered.length <= maxTotal) return ordered

  // Thin evenly rather than truncating, which would drop every late block.
  const thinned: number[] = []
  for (let i = 0; i < maxTotal; i += 1) {
    thinned.push(ordered[Math.round((i * (ordered.length - 1)) / (maxTotal - 1))])
  }
  return [...new Set(thinned)]
}

/**
 * Whether a fitted model is good enough to hand to the scrollbar.
 *
 * A document whose heights genuinely are not a function of its source text --
 * one full of images, embeds, or anything sized from outside the markdown --
 * fails this, and the caller measures it block by block instead. Being wrong
 * confidently is worse than being slow: a bad model would hold a precise,
 * incorrect scrollbar forever, where the flat estimate it replaced at least
 * corrected itself as the reader scrolled.
 */
export function isPreviewHeightModelTrustworthy(model: PreviewHeightModel | null): model is PreviewHeightModel {
  if (!model) return false
  if (model.sampleCount < MIN_SAMPLES_PER_SHAPE) return false
  return Math.abs(model.biasPct) <= PREVIEW_MODEL_MAX_BIAS_PCT
    && model.medianErrorPct <= PREVIEW_MODEL_MAX_MEDIAN_ERROR_PCT
}
