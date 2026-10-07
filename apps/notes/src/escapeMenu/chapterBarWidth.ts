// HOW WIDE A MODE'S CHAPTER-BAR STRIP IS, computed without a browser.
//
// The strip (EscapeMenuStatus.tsx's `EscapeMenuChromeBarRow`) is narration
// pills followed by the dashed pill previewing the cell the ring sits on. A
// strip wider than the bar scrolls sideways, and a reader who has to scroll to
// see what a choice does is a reader who will not. So whether a mode's text
// FITS is a property worth a test -- and a test has no layout engine.
//
// This module is that layout, restated for exactly one axis: it walks the
// same spans the renderer walks (`parseNarration`, `splitNarration`, the same
// separator) and adds up advances measured from the real stylesheet in a real
// Chromium (`scripts/adventure/calibrateChapterBar.ts`, which writes
// chapterBarMetrics.json and checks this estimate against the DOM it
// measured). It mirrors the DOM's STRUCTURE on purpose -- which box is an
// inline run and which a flex item with a gap beside it -- because that is
// where an estimate built from the words alone goes wrong.
//
// WHAT IT CANNOT SEE: kerning (advances are summed per character), and fonts
// other than the one it was calibrated with. The reference font is the one the
// calibration machine resolves `system-ui` to; the metrics file names it.

import { DETAIL_SEPARATOR, parseNarration, splitNarration, type NarrationSpan } from './narrationMarkup'
import metrics from './chapterBarMetrics.json'

export interface ChapterBarMetrics {
  /** What the numbers below were measured against, in words. */
  reference: string
  /** The font `system-ui` resolved to on the calibration machine. */
  font: string
  /** The strip's own client width at the reference layout. */
  stripPx: number
  /** The gap between two pills on the strip. */
  stripGapPx: number
  /** A narration pill with nothing in it: padding and border. */
  narrationPillPx: number
  /** The dashed detail pill with nothing in it: padding and border. */
  detailPillPx: number
  /** The gap between two lines in the detail pill, and between items in one line. */
  detailGapPx: number
  /** Per character, per text style; `fallback` for one never measured. */
  advances: Record<TextStyle, Record<string, number>>
  fallbackAdvancePx: number
  /** Per icon class string; `fallbackIconPx` for one never measured. */
  icons: Record<string, number>
  fallbackIconPx: number
}

export type TextStyle = 'regular' | 'strong' | 'em' | 'strongEm'

export const CHAPTER_BAR_METRICS = metrics as ChapterBarMetrics

function styleOf(span: Extract<NarrationSpan, { kind: 'text' }>): TextStyle {
  if (span.bold && span.italic) return 'strongEm'
  if (span.bold) return 'strong'
  if (span.italic) return 'em'
  return 'regular'
}

/** One run of text in one style, its whitespace already collapsed as the renderer's would be. */
export function textWidth(text: string, style: TextStyle, at: ChapterBarMetrics = CHAPTER_BAR_METRICS): number {
  let width = 0
  for (const char of text) width += at.advances[style][char] ?? at.fallbackAdvancePx
  return width
}

export function iconWidth(icon: string, at: ChapterBarMetrics = CHAPTER_BAR_METRICS): number {
  return at.icons[icon] ?? at.fallbackIconPx
}

/**
 * Inline runs inside ONE box, as both pills lay out a line: one
 * `white-space: pre-wrap` span, so spaces are kept as written.
 */
function inlineWidth(spans: readonly NarrationSpan[], at: ChapterBarMetrics): number {
  let width = 0
  for (const span of spans) {
    width += span.kind === 'icon' ? iconWidth(span.icon, at) : textWidth(span.text, styleOf(span), at)
  }
  return width
}

/** One narration entry's pill. Only the LINE is drawn; the rest is tooltip. */
export function narrationPillWidth(entry: string, at: ChapterBarMetrics = CHAPTER_BAR_METRICS): number {
  return at.narrationPillPx + inlineWidth(parseNarration(splitNarration(entry).line), at)
}

/**
 * The dashed preview pill. Every line is an inline-flex box holding the
 * separator (after the first) and ONE inline run of the line's spans, with
 * the pill's gap between lines and between the separator and the run.
 */
export function detailPillWidth(lines: readonly string[], at: ChapterBarMetrics = CHAPTER_BAR_METRICS): number {
  const drawn = lines.filter((line) => line.trim().length > 0)
  if (drawn.length === 0) return 0
  const separator = textWidth(DETAIL_SEPARATOR, 'regular', at) + at.detailGapPx
  return at.detailPillPx
    + at.detailGapPx * (drawn.length - 1)
    + separator * (drawn.length - 1)
    + drawn.reduce((sum, line) => sum + inlineWidth(parseNarration(line), at), 0)
}

/** The whole strip: the pills in order, and the gaps between them. */
export function stripWidth(narration: readonly string[], detailLines: readonly string[], at: ChapterBarMetrics = CHAPTER_BAR_METRICS): number {
  const pills = narration.map((entry) => narrationPillWidth(entry, at))
  const detail = detailPillWidth(detailLines, at)
  if (detail > 0) pills.push(detail)
  return pills.reduce((sum, pill) => sum + pill, 0) + at.stripGapPx * Math.max(0, pills.length - 1)
}
