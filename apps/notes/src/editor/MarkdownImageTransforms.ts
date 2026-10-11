import type { EditorSelectionState, EditorTransformResult } from './EditorContract'
import { buildTransformResult } from './TransformResult'
import {
  EMPTY_IMAGE_LAYOUT,
  formatImageLayout,
  parseImageTitle,
  type ImageAlignment,
  type ImageLayout,
  type ImageLength,
} from '../shared/imageLayout'

/**
 * The edit view's image keys: shaping an image the way the table keys shape a
 * table (MarkdownTableTransforms.ts), by rewriting its Markdown. Each is a
 * pure transform of the note text and selection that acts only while the
 * caret is inside an image (`![alt](destination "title")`, not in a code
 * block) and returns null everywhere else, so the key does what it does
 * anywhere else. What they write is the title grammar in
 * shared/imageLayout.ts, so nobody has to type it.
 *
 * An image whose title is an ordinary tooltip, or a malformed layout, is left
 * alone: rewriting it would throw away words the reader wrote.
 */

type FenceCheck = (offset: number) => boolean

export interface MarkdownImageSpan {
  /** `!` */
  from: number
  /** One past `)`. */
  to: number
  altFrom: number
  altTo: number
  destinationFrom: number
  destinationTo: number
  /** The title's text, inside its quotes; null when the image has no title. */
  titleFrom: number | null
  titleTo: number | null
  title: string | null
}

// One image on one line. The alt text may not contain brackets and the title
// is double- or single-quoted, which covers what this app writes and what
// people type; anything more exotic is simply not shaped by these keys.
const IMAGE_PATTERN = /!\[([^\]\n]*)\]\(([ \t]*)(<[^>\n]*>|[^\s()]+)(?:([ \t]+)(?:"([^"\n]*)"|'([^'\n]*)'))?[ \t]*\)/g

/** Every image on the line holding `offset`. */
function imagesOnLine(text: string, offset: number): MarkdownImageSpan[] {
  const lineFrom = text.lastIndexOf('\n', offset - 1) + 1
  const lineEndIndex = text.indexOf('\n', offset)
  const lineTo = lineEndIndex === -1 ? text.length : lineEndIndex
  const line = text.slice(lineFrom, lineTo)
  const spans: MarkdownImageSpan[] = []
  IMAGE_PATTERN.lastIndex = 0
  for (let match = IMAGE_PATTERN.exec(line); match; match = IMAGE_PATTERN.exec(line)) {
    const [whole, alt, leading, destination, separator, doubleQuoted, singleQuoted] = match
    const from = lineFrom + match.index
    const altFrom = from + 2
    const destinationFrom = altFrom + alt.length + 2 + leading.length
    const destinationTo = destinationFrom + destination.length
    const title = doubleQuoted ?? singleQuoted ?? null
    const titleFrom = title === null ? null : destinationTo + separator.length + 1
    spans.push({
      from,
      to: from + whole.length,
      altFrom,
      altTo: altFrom + alt.length,
      destinationFrom,
      destinationTo,
      titleFrom,
      titleTo: titleFrom === null || title === null ? null : titleFrom + title.length,
      title,
    })
  }
  return spans
}

/** The image the caret at `offset` is strictly inside (after its `!`, before its `)`), or null. */
export function findImageAt(text: string, offset: number, isInFencedCodeBlock: FenceCheck): MarkdownImageSpan | null {
  const image = imagesOnLine(text, offset).find((span) => offset > span.from && offset < span.to) ?? null
  if (!image || isInFencedCodeBlock(image.from)) return null
  return image
}

function caretImage(text: string, selection: EditorSelectionState, isInFencedCodeBlock: FenceCheck): { image: MarkdownImageSpan; layout: ImageLayout } | null {
  const image = findImageAt(text, selection.start, isInFencedCodeBlock)
  if (!image || selection.end > image.to) return null
  const parsed = parseImageTitle(image.title)
  if (parsed.kind !== 'layout') return null
  return { image, layout: parsed.layout }
}

/**
 * Writes `layout` as the image's title (removing the title when there is
 * nothing to say), keeping the selection where it was relative to the text
 * around it.
 */
function rewriteLayout(text: string, selection: EditorSelectionState, image: MarkdownImageSpan, layout: ImageLayout): EditorTransformResult | null {
  const formatted = formatImageLayout(layout)
  const from = image.destinationTo
  const to = image.to - 1
  const insert = formatted ? ` "${formatted}"` : ''
  if (text.slice(from, to) === insert) return null
  const shift = insert.length - (to - from)
  // The caret stays put in the text around the title; inside it, it is
  // clamped to the end of what replaced it.
  const place = (offset: number) => (offset <= from ? offset : offset >= to ? offset + shift : Math.min(offset, from + insert.length))
  return buildTransformResult(text, { from, to, insert }, {
    anchor: place(selection.anchor),
    focus: place(selection.focus),
    start: place(selection.start),
    end: place(selection.end),
    isCollapsed: selection.isCollapsed,
  })
}

// Left and right step through these positions; an image with no alignment
// (inline, in the flow of the text) steps from the middle.
const ALIGNMENT_LADDER: ImageAlignment[] = ['left', 'center', 'right']

// What the first resize of an image with no size gives it, in em: a little
// over a third of a typical text column either way.
const FIRST_WIDTH_EM = { up: 20, down: 10 }

const STEP_BY_UNIT: Record<ImageLength['unit'], number> = { em: 1, px: 10, '%': 5 }

function stepLength(length: ImageLength, direction: 'up' | 'down'): ImageLength {
  const step = STEP_BY_UNIT[length.unit]
  const ceiling = length.unit === '%' ? 100 : Infinity
  // The floor and ceiling only stop a step; they never turn a shrink into a
  // grow (3% down stays 3%) or a grow into a shrink (120% up stays 120%).
  const value = direction === 'up'
    ? Math.max(length.value, Math.min(ceiling, length.value + step))
    : Math.min(length.value, Math.max(step, length.value - step))
  return { value, unit: length.unit }
}

/**
 * Ctrl+Shift+Arrow with the caret in an image. Left and right move its
 * alignment along left, center, right; up and down grow and shrink it by one
 * step of its own unit (1em, 10px, 5%) -- the width when it has one, else
 * the height, and an image with no size gets a first width in em.
 */
export function resolveImageArrowTransform(
  event: { direction: 'left' | 'right' | 'up' | 'down'; text: string; selection: EditorSelectionState },
  isInFencedCodeBlock: FenceCheck,
): EditorTransformResult | null {
  const { direction, text, selection } = event
  const found = caretImage(text, selection, isInFencedCodeBlock)
  if (!found) return null
  const { image, layout } = found

  if (direction === 'left' || direction === 'right') {
    const index = layout.align === null ? 1 : ALIGNMENT_LADDER.indexOf(layout.align)
    const nextIndex = direction === 'left'
      ? (layout.align === null ? 0 : Math.max(0, index - 1))
      : (layout.align === null ? 2 : Math.min(2, index + 1))
    const align = ALIGNMENT_LADDER[nextIndex]
    if (align === layout.align) return null
    return rewriteLayout(text, selection, image, { ...layout, align })
  }

  if (layout.width) return rewriteLayout(text, selection, image, { ...layout, width: stepLength(layout.width, direction) })
  if (layout.height) return rewriteLayout(text, selection, image, { ...layout, height: stepLength(layout.height, direction) })
  return rewriteLayout(text, selection, image, { ...layout, width: { value: FIRST_WIDTH_EM[direction], unit: 'em' } })
}

/** Shift+Backspace with the caret in an image: clears its size and alignment, keeping its id. */
export function resolveImageClearLayoutTransform(
  event: { text: string; selection: EditorSelectionState },
  isInFencedCodeBlock: FenceCheck,
): EditorTransformResult | null {
  const found = caretImage(event.text, event.selection, isInFencedCodeBlock)
  if (!found) return null
  return rewriteLayout(event.text, event.selection, found.image, { ...EMPTY_IMAGE_LAYOUT, id: found.layout.id })
}

/**
 * The right-click ladder inside an image: the alt text, then the image's id
 * (the `&NAME` token, in the title or as the destination), then the whole
 * image. A right-click while one step is selected takes the next, like the
 * table's ladder (resolveTableSelectionStep).
 */
export function resolveImageSelectionStep(
  event: { text: string; clickOffset: number; selection: EditorSelectionState },
  isInFencedCodeBlock: FenceCheck,
): { start: number; end: number } | null {
  const { text, clickOffset, selection } = event
  const image = findImageAt(text, clickOffset, isInFencedCodeBlock)
  if (!image) return null

  const steps: Array<{ start: number; end: number }> = []
  if (image.altTo > image.altFrom) steps.push({ start: image.altFrom, end: image.altTo })
  const destination = text.slice(image.destinationFrom, image.destinationTo)
  if (destination.startsWith('&')) {
    steps.push({ start: image.destinationFrom, end: image.destinationTo })
  } else if (image.title !== null && image.titleFrom !== null) {
    const idMatch = /(^|\s)(&[^\s]+)/.exec(image.title)
    if (idMatch && parseImageTitle(image.title).kind === 'layout') {
      const start = image.titleFrom + idMatch.index + idMatch[1].length
      steps.push({ start, end: start + idMatch[2].length })
    }
  }
  steps.push({ start: image.from, end: image.to })

  // The steps are a sequence rather than nested ranges (the id is not inside
  // the alt text), so a right-click on the current step takes the one after
  // it, wherever in the image the click lands.
  const current = steps.findIndex((step) => step.start === selection.start && step.end === selection.end)
  if (!selection.isCollapsed && current !== -1) return steps[Math.min(current + 1, steps.length - 1)]
  return steps.find((step) => clickOffset >= step.start && clickOffset < step.end) ?? steps[steps.length - 1]
}

/**
 * The titles on one line that look like layout but do not parse
 * (parseImageTitle's `malformed`), as offsets into the line, so the edit view
 * can mark a typo that would otherwise silently do nothing. Says nothing
 * about code blocks: the caller decides whether the line is in one.
 */
export function malformedImageTitlesOnLine(line: string): Array<{ from: number; to: number }> {
  const ranges: Array<{ from: number; to: number }> = []
  if (!line.includes('![')) return ranges
  for (const image of imagesOnLine(line, 0)) {
    if (image.titleFrom === null || image.titleTo === null) continue
    if (parseImageTitle(image.title).kind === 'malformed') ranges.push({ from: image.titleFrom, to: image.titleTo })
  }
  return ranges
}

/**
 * The parts of one image written as `![alt](destination "title")`, when
 * `source` is exactly that (the shape the keys and the store/restore rewrite
 * understand); null for anything more exotic, which is then left alone.
 */
export function parseImageMarkdown(source: string): { alt: string; destination: string; title: string | null; quote: '"' | "'" } | null {
  const [image] = imagesOnLine(source, 0)
  if (!image || image.from !== 0 || image.to !== source.length) return null
  const rawDestination = source.slice(image.destinationFrom, image.destinationTo)
  const destination = rawDestination.startsWith('<') ? rawDestination.slice(1, -1) : rawDestination
  const quote = image.titleFrom !== null && source[image.titleFrom - 1] === "'" ? "'" : '"'
  return { alt: source.slice(image.altFrom, image.altTo), destination, title: image.title, quote }
}
