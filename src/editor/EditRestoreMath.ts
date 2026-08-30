import type { PersistedViewportState } from '../shared/appState'
import type { EditorSelectionState } from './EditorContract'
import { resolvePreviewSourceAnchorEntry } from './PreviewScrollAnchor'
import { splitMarkdownIntoPreviewBlocks, type PreviewMarkdownBlock } from './PreviewBlockSplit'
import { resolveSourceLineForAnchorBlockIndex } from './PreviewBlockIndex'

export type EditRestoreSnapshot = {
  noteId: string
  collapsedSelection: EditorSelectionState
  fullSelection: EditorSelectionState
  viewport: PersistedViewportState
  // The logical source line the canonical BLOCK resolves to, when known.
  // `viewport.scrollTopLines` is a naive line-COUNT (source line minus
  // boundary lines) computed without the adapter, which is wrong under
  // soft-wrapping -- a logical line can span many visual rows, so "line N"
  // is not the same as "N line-heights of scroll" (this is Bug 5's own
  // finding, docs/cm6-parity-hardening-plan.md). When present,
  // applyEditRestoreSnapshot uses this to correct that rough placement to
  // an analytically exact one via the adapter's own resolveHeightForSourceLine,
  // one frame later once the adapter is confirmed mounted -- not a raw/cached
  // pixel value, a fresh deterministic computation from the same block every
  // time, so it carries none of the round-trip-drift risk the pre-rewrite
  // sync/spoof caching existed to paper over.
  sourceAnchorLine?: number
}

export type EditViewportTelemetry = {
  scrollTopPx: number
  scrollHeightPx: number
  clientHeightPx: number
}

export const ZERO_EDITOR_SELECTION: EditorSelectionState = { anchor: 0, focus: 0, start: 0, end: 0, isCollapsed: true }
export const ZERO_PERSISTED_VIEWPORT: PersistedViewportState = { topBoundaryLines: 0, bottomBoundaryLines: 0, scrollTopLines: 0 }

/**
 * The single reference point both panes use to answer "where am I?" and to
 * act on "put me here" -- expressed in line-heights below the top of the
 * pane's own content area (below the top boundary, in edit mode's case).
 *
 * One constant, four operations: each mode *reads* its current position by
 * asking which source line sits at this offset, and *lands* a restore by
 * putting the target line at this same offset. That symmetry is the whole
 * point. When reading and landing disagree -- as they did while edit read at
 * the boundary top but landed one line-height below it, and preview read at
 * the container top but landed one line-height below that -- every mode
 * switch shifts the position by the difference, and a round trip walks. The
 * `+ 1 block` fudge that used to sit in toggleRenderViewMode existed to
 * cancel that walk one block at a time; with the reference point shared,
 * there is nothing left to cancel.
 *
 * The value itself (one line-height, rather than flush at 0) is the
 * user-confirmed convention for every restore -- see docs/editor-contract.md's
 * Viewport Model section.
 */
export const RESTORE_OFFSET_LINES = 1

/**
 * The two halves of that reference point, as functions.
 *
 * Sharing the constant was supposed to keep reading and landing in step. It
 * did not, because each call site still wrote its own arithmetic around it,
 * and the sign is the whole content of that arithmetic: reading ADDS the
 * offset, landing SUBTRACTS it, because landing is the read solved for the
 * scroll position. Four sites wrote it; three added it in both directions,
 * and a note switch walked the viewport down a row each time -- most visibly
 * on a wrapped paragraph, where it settled on the paragraph's second visual
 * row and looked like nothing at all.
 *
 * So the arithmetic lives here once and nobody writes the sign by hand again.
 * `read(land(x)) === x` is asserted in this module's tests.
 */
export function readSourceAnchorLine(scrollTopLines: number, topBoundaryLines: number): number {
  return Math.max(0, Math.round(scrollTopLines) + Math.round(topBoundaryLines) + RESTORE_OFFSET_LINES)
}

export function landScrollTopLines(anchorLine: number, topBoundaryLines: number): number {
  return Math.max(0, Math.round(anchorLine) - Math.round(topBoundaryLines) - RESTORE_OFFSET_LINES)
}

export function resolveSourceAnchorFromEditState(params: {
  text: string
  lineHeightPx: number
  telemetry?: EditViewportTelemetry | null
  viewport?: PersistedViewportState | null
  /**
   * Adapter-provided precise line-at-height resolver
   * (EditorAdapter.resolveSourceLineAtHeight) -- preferred whenever
   * available. Exact and wrapping-aware: a "source line" is a logical text
   * line, which under soft-wrapping can span many visual rows, so it is
   * *not* the same thing as "how many line-heights of pixels are scrolled"
   * (the crude fallback below). Works regardless of whether the target
   * line is currently mounted, since the adapter answers analytically from
   * its own layout info, not by measuring the live DOM.
   */
  resolveSourceLineAtHeight?: (heightPx: number) => number | null
}): { sourceAnchorLine: number } {
  const { text, lineHeightPx, telemetry, viewport, resolveSourceLineAtHeight } = params
  const lines = text.split('\n')
  const safeLineHeight = Math.max(1, lineHeightPx)

  if (resolveSourceLineAtHeight && viewport) {
    const topBoundaryPx = Math.max(0, Math.round(viewport.topBoundaryLines * safeLineHeight))
    const scrollTopPx = Math.max(0, Math.round(viewport.scrollTopLines * safeLineHeight))
    // Read at the same offset a restore lands on -- see RESTORE_OFFSET_LINES.
    const referenceOffsetPx = RESTORE_OFFSET_LINES * safeLineHeight
    const resolvedLine = resolveSourceLineAtHeight(scrollTopPx + topBoundaryPx + referenceOffsetPx)
    if (resolvedLine !== null) {
      const clampedLine = Math.min(Math.max(0, resolvedLine), Math.max(0, lines.length - 1))
      return { sourceAnchorLine: clampedLine }
    }
  }

  const anchorLine = viewport
    ? readSourceAnchorLine(viewport.scrollTopLines, viewport.topBoundaryLines)
    :
    (telemetry ? Math.max(0, Math.floor(telemetry.scrollTopPx / safeLineHeight)) : 0)
  const clampedLine = Math.min(Math.max(0, anchorLine), Math.max(0, lines.length - 1))

  return { sourceAnchorLine: clampedLine }
}

/**
 * Resolves the source line to land on from a note/snapshot's persisted UI
 * state (`anchorBlockIndex` -- the canonical mode-agnostic BLOCK, see
 * docs/editor-contract.md's Viewport Model section) via the block-identity
 * primitive in PreviewBlockIndex.ts. Mode-agnostic: used for both edit-mode
 * and preview-mode restore. Returns null only when `uiState` itself carries
 * no anchor at all (e.g. a failed/mocked IPC call) -- an out-of-range index
 * still resolves to a real line (0, via resolveSourceLineForAnchorBlockIndex's
 * own fallback), it just doesn't return null.
 */
export function resolveEditSourceAnchorLineFromUiState(
  text: string,
  uiState: { anchorBlockIndex?: unknown } | null | undefined,
  blocks?: Pick<PreviewMarkdownBlock, 'startLine'>[] | null,
): number | null {
  if (!uiState || typeof uiState.anchorBlockIndex !== 'number' || !Number.isFinite(uiState.anchorBlockIndex)) {
    return null
  }

  const totalLines = Math.max(1, text.split('\n').length)
  const resolvedBlocks = blocks ?? splitMarkdownIntoPreviewBlocks(text)
  const sourceLine = resolveSourceLineForAnchorBlockIndex(resolvedBlocks, Math.round(uiState.anchorBlockIndex))
  return Math.min(Math.max(0, sourceLine), totalLines - 1)
}

export function findPreviewSourceAnchorElement(container: HTMLElement, sourceLine: number): HTMLElement | null {
  const anchors = Array.from(container.querySelectorAll<HTMLElement>('[data-source-line-start], [data-source-line]'))
  if (anchors.length === 0) {
    return null
  }

  type AnchorEntry = { element: HTMLElement; tagName: string; line: number; lineStart: number; lineEnd: number; text: string | null }
  const entries: AnchorEntry[] = []

  for (const element of anchors) {
    const startValue = Number(element.dataset.sourceLineStart)
    const endValue = Number(element.dataset.sourceLineEnd)
    const fallbackStartValue = Number(element.dataset.sourceLine)
    const lineStart = Number.isFinite(startValue)
      ? Math.max(0, Math.round(startValue))
      : Number.isFinite(fallbackStartValue)
        ? Math.max(0, Math.round(fallbackStartValue))
        : null
    const lineEnd = Number.isFinite(endValue)
      ? Math.max(0, Math.round(endValue))
      : lineStart

    if (lineStart === null) continue

    entries.push({
      element,
      tagName: element.tagName,
      line: lineStart,
      lineStart,
      lineEnd: lineEnd ?? lineStart,
      text: element.textContent?.trim() ?? null,
    })
  }

  if (entries.length === 0) return null

  const resolvedEntry = resolvePreviewSourceAnchorEntry(entries, sourceLine)
  if (!resolvedEntry) {
    return null
  }

  return resolvedEntry.element
}

// Converts a pixel scroll position (e.g. from the legacy per-note SQLite
// scrollTop column) to an integer line count for storage in
// PersistedViewportState/EditRestoreSnapshot.viewport.
export function scrollTopPxToLines(scrollTopPx: number, lineHeightPx: number): number {
  const safeLineHeight = Math.max(1, lineHeightPx)
  return Math.max(0, Math.round(scrollTopPx / safeLineHeight))
}

// Converts an integer line count back to a pixel scroll position, e.g. for
// writing back to the legacy per-note SQLite scrollTop column.
export function scrollTopLinesToPx(scrollTopLines: number, lineHeightPx: number): number {
  const safeLineHeight = Math.max(1, lineHeightPx)
  return Math.max(0, Math.round(scrollTopLines)) * safeLineHeight
}

export function buildEditRestoreSnapshotFromUiState(params: {
  noteId: string
  text: string
  uiState: { cursorPos?: unknown; anchorBlockIndex?: unknown } | null | undefined
  fallbackViewport: PersistedViewportState | null
  overrideCursorPos?: number
  /**
   * Where to land instead of the note's own persisted position -- set when
   * the note is being opened *at* a specific place rather than resumed
   * where it was left (following an anchor/TOC link into it). Without this
   * the note restores to its stored position first and only then gets
   * scrolled to the target, so the reader sees a place they didn't ask for
   * before arriving at the one they did.
   */
  overrideSourceAnchorLine?: number
  previewBlocks?: Pick<PreviewMarkdownBlock, 'startLine'>[] | null
}): EditRestoreSnapshot {
  const { noteId, text, uiState, fallbackViewport, overrideCursorPos, overrideSourceAnchorLine, previewBlocks } = params
  // Default to 0 lines for both boundaries when nothing is stored (per spec:
  // a fresh/never-dragged note has no reserved top/bottom zones).
  const fallbackTopBoundaryLines = fallbackViewport?.topBoundaryLines ?? 0
  const fallbackBottomBoundaryLines = fallbackViewport?.bottomBoundaryLines ?? 0
  const selectionTextLength = Math.max(0, text.length)
  // No persisted cursor at all (e.g. a note that's never been in edit mode
  // this session, such as one just created while in preview mode) falls back
  // to the end of the note rather than its start -- landing at 0 put the
  // caret in front of a just-created chapter's leading #/## instead of
  // behind it.
  const persistedCursor =
    typeof overrideCursorPos === 'number' && Number.isFinite(overrideCursorPos)
      ? Math.max(0, Math.min(Math.round(overrideCursorPos), selectionTextLength))
      : typeof uiState?.cursorPos === 'number' && Number.isFinite(uiState.cursorPos)
        ? Math.max(0, Math.min(Math.round(uiState.cursorPos), selectionTextLength))
        : selectionTextLength
  const hasOverrideAnchorLine = typeof overrideSourceAnchorLine === 'number' && Number.isFinite(overrideSourceAnchorLine)
  const anchorLine = hasOverrideAnchorLine
    ? Math.max(0, Math.round(overrideSourceAnchorLine as number))
    : resolveEditSourceAnchorLineFromUiState(text, uiState, previewBlocks)
  // MINUS the offset, because this is the inverse of the read above.
  //
  // Reading asks which line sits RESTORE_OFFSET_LINES below the top of the
  // content area: anchorLine = scrollTopLines + topBoundaryLines + offset.
  // Landing has to solve that same equation for scrollTopLines, and solving
  // it moves the offset to the other side. This added it instead, so every
  // round trip through a note switch walked the viewport down by two lines,
  // quantized by the anchor's block: a document resting at the very top came
  // back one line down (0 - 0 + 1), then again, and then stopped once the
  // walk stayed inside one block -- which is why it settled on a heading and
  // looked deliberate. RESTORE_OFFSET_LINES' own doc comment describes this
  // exact failure as the thing the shared constant was meant to end; the
  // constant was shared, but one of the two sites kept the wrong sign.
  const storedScrollTopLines =
    anchorLine !== null
      ? landScrollTopLines(anchorLine, fallbackTopBoundaryLines)
      : Math.max(0, Math.round(fallbackViewport?.scrollTopLines ?? 0))

  const collapsedSelection: EditorSelectionState = {
    anchor: persistedCursor,
    focus: persistedCursor,
    start: persistedCursor,
    end: persistedCursor,
    isCollapsed: true,
  }

  return {
    noteId,
    collapsedSelection,
    fullSelection: collapsedSelection,
    viewport: {
      topBoundaryLines: fallbackTopBoundaryLines,
      bottomBoundaryLines: fallbackBottomBoundaryLines,
      scrollTopLines: storedScrollTopLines,
    },
    ...(anchorLine !== null ? { sourceAnchorLine: anchorLine } : {}),
  }
}
