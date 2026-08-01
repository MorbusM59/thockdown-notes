import type { PersistedViewportState } from '../shared/appState'
import type { EditorSelectionState } from './EditorContract'
import { resolvePreviewSourceAnchorEntry } from './PreviewScrollAnchor'

export type EditRestoreSnapshot = {
  noteId: string
  collapsedSelection: EditorSelectionState
  fullSelection: EditorSelectionState
  viewport: PersistedViewportState
  sourceAnchorLine?: number
  sourceAnchorText?: string | null
  // A correction added on top of resolveHeightForSourceLine(sourceAnchorLine)
  // in applySourceAnchorToEditor -- present when sourceAnchorLine came from a
  // "spoofed" preview->edit signal (editSpoofedSignalRef in
  // useEditorSectionMount.ts, recorded at the moment edit itself last
  // genuinely scrolled) rather than a real signal freshly derived from
  // preview's current position. Reconstructs the exact original edit
  // position: resolveHeightForSourceLine is stable for an already-visited
  // line, so re-deriving it and adding this back lands precisely where edit
  // actually was, without needing preview to have moved at all.
  sourceAnchorOffsetPx?: number
  // The preview pane's exact scrollTop this restore was computed from --
  // only set on an actual preview->edit toggle (not note-switch/persisted
  // restores). Lets applySourceAnchorToEditor record a fresh synced pair
  // once it resolves sourceAnchorLine to a real pixel position, so a later
  // return trip to this same preview position can restore losslessly.
  originPreviewScrollTopPx?: number
}

export type EditViewportTelemetry = {
  scrollTopPx: number
  scrollHeightPx: number
  clientHeightPx: number
}

export const ZERO_EDITOR_SELECTION: EditorSelectionState = { anchor: 0, focus: 0, start: 0, end: 0, isCollapsed: true }
export const ZERO_PERSISTED_VIEWPORT: PersistedViewportState = { topBoundaryLines: 0, bottomBoundaryLines: 0, scrollTopLines: 0 }

export function buildSourceAnchorTextSnippet(lines: string[], anchorLine: number): string | null {
  const startLine = Math.max(0, anchorLine - 12)
  const endLine = Math.min(lines.length - 1, anchorLine + 12)
  const snippet = lines.slice(startLine, endLine + 1).join('\n').trim()
  return snippet.length === 0 ? null : snippet.slice(0, 4096)
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
}): { sourceAnchorLine: number; sourceAnchorText: string | null } {
  const { text, lineHeightPx, telemetry, viewport, resolveSourceLineAtHeight } = params
  const lines = text.split('\n')
  const safeLineHeight = Math.max(1, lineHeightPx)

  if (resolveSourceLineAtHeight && viewport) {
    const topBoundaryPx = Math.max(0, Math.round(viewport.topBoundaryLines * safeLineHeight))
    const scrollTopPx = Math.max(0, Math.round(viewport.scrollTopLines * safeLineHeight))
    const resolvedLine = resolveSourceLineAtHeight(scrollTopPx + topBoundaryPx)
    if (resolvedLine !== null) {
      const clampedLine = Math.min(Math.max(0, resolvedLine), Math.max(0, lines.length - 1))
      return {
        sourceAnchorLine: clampedLine,
        sourceAnchorText: buildSourceAnchorTextSnippet(lines, clampedLine),
      }
    }
  }

  const anchorLine = viewport
    ? Math.max(0, Math.round(viewport.scrollTopLines) + Math.round(viewport.topBoundaryLines))
    :
    (telemetry ? Math.max(0, Math.floor(telemetry.scrollTopPx / safeLineHeight)) : 0)
  const clampedLine = Math.min(Math.max(0, anchorLine), Math.max(0, lines.length - 1))

  const sourceAnchorText = buildSourceAnchorTextSnippet(lines, clampedLine)

  return {
    sourceAnchorLine: clampedLine,
    sourceAnchorText,
  }
}

export function resolveEditSourceAnchorLineFromUiState(text: string, uiState: { sourceAnchorLine?: unknown; sourceAnchorText?: unknown } | null | undefined): number | null {
  const totalLines = Math.max(1, text.split('\n').length)
  const sourceAnchorLine = typeof uiState?.sourceAnchorLine === 'number' && Number.isFinite(uiState.sourceAnchorLine)
    ? Math.max(0, Math.round(uiState.sourceAnchorLine))
    : null

  if (sourceAnchorLine !== null) {
    return Math.min(sourceAnchorLine, totalLines - 1)
  }

  return null
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
  uiState: { scrollTop?: unknown; cursorPos?: unknown; sourceAnchorLine?: unknown; sourceAnchorText?: unknown } | null | undefined
  fallbackViewport: PersistedViewportState | null
  lineHeightPx: number
  overrideCursorPos?: number
}): EditRestoreSnapshot {
  const { noteId, text, uiState, fallbackViewport, lineHeightPx, overrideCursorPos } = params
  // Default to 0 lines for both boundaries when nothing is stored (per spec:
  // a fresh/never-dragged note has no reserved top/bottom zones).
  const fallbackTopBoundaryLines = fallbackViewport?.topBoundaryLines ?? 0
  const fallbackBottomBoundaryLines = fallbackViewport?.bottomBoundaryLines ?? 0
  const selectionTextLength = Math.max(0, text.length)
  const persistedCursor =
    typeof overrideCursorPos === 'number' && Number.isFinite(overrideCursorPos)
      ? Math.max(0, Math.min(Math.round(overrideCursorPos), selectionTextLength))
      : typeof uiState?.cursorPos === 'number' && Number.isFinite(uiState.cursorPos)
        ? Math.max(0, Math.min(Math.round(uiState.cursorPos), selectionTextLength))
        : 0
  const anchorLine = resolveEditSourceAnchorLineFromUiState(text, uiState)
  const storedScrollTopLines =
    anchorLine !== null
      ? Math.max(0, anchorLine - fallbackTopBoundaryLines)
      : typeof uiState?.scrollTop === 'number' && Number.isFinite(uiState.scrollTop)
        ? scrollTopPxToLines(Math.max(0, uiState.scrollTop), lineHeightPx)
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
    sourceAnchorText: typeof uiState?.sourceAnchorText === 'string' ? uiState.sourceAnchorText : null,
    ...(anchorLine !== null ? { sourceAnchorLine: anchorLine } : {}),
  }
}
