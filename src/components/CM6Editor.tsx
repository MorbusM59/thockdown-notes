import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { EditorState, EditorSelection, Prec, RangeSetBuilder } from '@codemirror/state';
import type { Extension } from '@codemirror/state';
import { EditorView, Decoration, ViewPlugin, keymap, type DecorationSet } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { buildTokenPresentation } from '../editor/MarkdownLineClassification';
import { typingSoundManager } from '../sound/TypingSoundManager';
import { readSelectionRect, type SelectionRect } from '../editor/CaretRect';
import { readSelectionLineRects } from '../editor/SelectionRects';
import { PIXELS_PER_WHEEL_UNIT } from '../editor/LayoutConstants';
import {
  buildReleaseRampDownPlanFromCurrentParams,
  CONTINUOUS_SCROLL_APEX_SPEED_MULTIPLIER,
  resolveApexSpeedPxPerSecFromCurrentParams,
  resolveRampCrossingTimeSecFromCurrentParams,
  sampleReleaseRampDownPlan,
} from '../editor/NonQuantizedSmoothScroll';
import { cancelQuantizedSmoothScroll, scrollToQuantizedSmooth } from '../editor/QuantizedSmoothScroll';
import { resolveCagedScrollTarget } from '../editor/CageMath';
import { sanitizeDocumentText, sanitizeDocumentTextExtended } from '../shared/textSanitization';
import type {
  EditorAdapter,
  EditorBindings,
  EditorSelectionState,
  EditorSnapshot,
  EditorSnapshotApplyRequest,
  EditorTextChangeEvent,
  EditorViewportLines,
  EditorViewportState,
} from '../editor/EditorContract';

/**
 * Phase 2, slice 1 of the CM6 migration spike (see
 * docs/document-scale-performance-philosophy.md and the large-document
 * performance handover doc's own history): a CodeMirror 6-backed
 * implementation of the SAME EditorAdapter/EditorBindings contract
 * Editor.tsx (Lexical) implements, built alongside it rather than replacing
 * it -- exactly what EditorContract.ts's "implementations may be partial
 * while the rewrite is in flight" rule exists for.
 *
 * Slices so far: mount, initial-text hydration, typing/selection tracking,
 * Tab/Enter/markdown-shortcut transforms, typing sounds, scroll/viewport
 * reporting + restore, the block-grid caret and multi-line selection
 * overlays, cage-quantized wheel scroll + PageUp/PageDown paging, the
 * keyboard caret-refocus caging intent, paste sanitization, drag-selection
 * scroll quantization, and (this slice) the fixed-focus caging boundary UI
 * itself: draggable top/bottom padding-zone handles, backed by real
 * topBoundaryPx/bottomBoundaryPx (no longer hardcoded 0) applied as content
 * padding on view.contentDOM, round-tripped through the viewport-lines
 * snapshot path. This closes out CagedScrollPlugin.tsx/Editor.tsx's boundary
 * system in full.
 *
 * Since then (product-identity fidelity pass, at the user's explicit
 * request): fixed the --editor-font/--editor-font-size/--editor-line-height/
 * --editor-glyph-width/--editor-cell-width CSS custom property chain (was
 * silently falling back to :root defaults instead of real runtime metrics --
 * see the git history for the live-confirmed bug this was), fixed a z-index
 * gap that put the caret/selection above the text instead of behind it,
 * ported the background box-grid lines (thockdown-grid-outline-lines/
 * thockdown-grid-lines), ported the custom scrollbar in full (rendering
 * via a portal into scrollbarHost, passive geometry sync, thumb drag, track
 * click-to-jump, and track right-click-hold-to-page), hid CM6's own native
 * scrollbars (this app draws its own; native ones were pure visual noise),
 * and fixed two more real CM6-base-theme defaults (.cm-line's 6px left
 * padding, .cm-content's 4px top/bottom padding) that were silently
 * shifting rendered glyphs away from the box grid's own origin -- confirmed
 * live via Range.getBoundingClientRect() on individual characters, not
 * assumed. Deliberately NOT snapping the editor's rendered size to exact
 * cell/line multiples the way Editor.tsx's own updateSize does: at the
 * user's explicit direction, a partially-cut-off cell at the far edge is
 * fine (an "infinity grid" -- the pattern simply tiles as far as the
 * container happens to extend); the one real requirement is that whatever
 * cells DO render land exactly on the real glyph positions, which the fixes
 * above now guarantee. Also fixed since: the native OS caret was still
 * showing through despite caret-color: transparent on .editor-text -- CM6's
 * own base theme sets caret-color via a higher-specificity descendant
 * selector (`.ͼN .cm-content`), which was silently winning regardless of
 * source order; forced with !important. And: changing the y-box (line-
 * height) slider while scrolled into a large document could leave every
 * visible line PERSISTENTLY (not just for a frame) off the grid until the
 * user scrolled -- CM6's own scrollTop/scrollHeight reconciliation across
 * the reflow wasn't settling on its own in a useful timeframe. Fixed with
 * view.requestMeasure() in the effect reacting to lineHeightPx/cellWidthPx
 * changes, forcing that settle to happen immediately. And: scrolled all the
 * way to the end of a note, the grid broke because the DOM's own natural
 * max scrollTop (scrollHeight - clientHeight) is essentially never itself a
 * multiple of lineHeightPx -- clientHeight is arbitrary window/pane sizing,
 * not something under this app's control. Fixed at the root by padding the
 * content's bottom by (clientHeight mod lineHeightPx), so the DOM's own
 * natural max-scroll already lands on a grid-quantized value; every other
 * scroll-math call site in this file inherits the fix for free since all of
 * them read scrollHeight/clientHeight fresh from the DOM already. And: at
 * the user's request, shifted the whole grid + text by half a cell
 * (halfCellWidthPx, halfLineHeightPx) in the positive x/y direction, so
 * content no longer starts flush against the container's top-left edge --
 * still an "infinity grid" conceptually extending past the container, cells
 * cut off at the far edges still fine/expected. Implemented as
 * view.contentDOM.style.paddingLeft (new) plus an extra halfLineHeightPx
 * folded into the existing paddingTop, with the grid overlay divs'
 * backgroundPosition shifted by the identical amount so the grid's phase
 * and the content's row/column positions move together and stay aligned.
 * The bottom max-scroll alignment padding above had to be re-derived to
 * account for the extra non-grid-quantized halfLineHeightPx now added to
 * scrollHeight from the top side (see alignmentPaddingBottomPx's own
 * comment). The shift also broke every place that snaps a real, measured
 * DOM position (caret, selection highlight, the caged-scroll target in
 * CageMath.ts) onto the row/column grid via a plain "round to the nearest
 * multiple of lineHeightPx/cellWidthPx" -- found live as two concrete bugs
 * (arrow-key caret-refocus caging settling on a small nonzero scrollTop
 * instead of exactly 0 at document start; the caret rendering inside a
 * boundary zone instead of stopping above it), both root-caused to the same
 * thing: real rows/columns now sit at (phase + N*unit), phase = half a
 * line/cell, not at plain multiples, so naive rounding picked the wrong
 * neighbor. Fixed with a phase-aware quantizeToPhase() helper (below) used
 * everywhere a raw DOM position gets snapped to the grid, and a matching
 * rowPhaseOffsetPx parameter threaded into the shared CageMath.ts (default
 * 0, so Lexical/Editor.tsx's own calls are untouched). Scroll TARGET values
 * themselves stay phase-0 by design -- the content's phase offset and the
 * grid overlay's matching backgroundPosition shift cancel out of that one
 * invariant -- confirmed by a from-scratch re-derivation, not by assuming
 * the fix that worked for row/column identification also applied to scroll
 * targets. Separately, root-caused a live oscillation between this app's
 * own caged-scroll reconcile and CM6's native scroll-into-view (each
 * undoing the other every keystroke near the bottom of the cage): the
 * bottom-clamp branch's final "round to nearest multiple of lineHeightPx"
 * could round down and clip the very last row it was trying to keep fully
 * visible, since scrollerClientHeightPx has no reason to be a multiple of
 * lineHeightPx. Changed to round up (never clip) in that branch only, in
 * the shared CageMath.ts -- a real, pre-existing latent bug independent of
 * the half-cell shift, just newly exposed by it in this file's own test
 * viewport size. And: at the default font settings halfCellWidthPx/
 * halfLineHeightPx happen to be clean whole pixels, but at other settings
 * (e.g. any y-box multiplier landing on an odd lineHeightPx) their true
 * half is fractional -- found live via a before/after screenshot pixel
 * scan showing the shifted grid line rendering visibly wider/blurrier than
 * every other line in the same grid, from the fractional pixel forcing the
 * grid's own hard color-stop edges to sub-pixel blend. Fixed by rounding
 * both to the nearest whole pixel everywhere they're used (padding, grid
 * backgroundPosition, every quantizeToPhase call, and the rowPhaseOffsetPx
 * passed into CageMath.ts) -- the shift only needs to be "about half a
 * cell" for breathing room, not exactly half, so rounding costs nothing.
 *
 * Production flip (0.5.4): the hasViewportLines/isSnapshotRestorePending
 * gating that avoids a "wrong boundary frame, then corrected" flash on first
 * restore, previously flagged here as not-yet-ported, is now in place --
 * mirrors Editor.tsx's own mechanism exactly (same two pieces of state, same
 * one-rAF settle window after applySnapshot, same set of gated visuals: grid
 * lines, boundary-zone backgrounds, drag handles, the caret overlay, and the
 * selection highlight). New `fontReady`/`caretSuspended` props (both
 * optional, defaulting to "already ready"/"not suspended" so every existing
 * caller -- the perf harness, the verify*.mjs regression scripts -- keeps its
 * prior always-visible behavior unless it opts in) let the real app wire
 * these the same way it already does for Editor.tsx.
 *
 * Performance audit pass (per docs/document-scale-performance-philosophy.md's
 * "computational scope must track the viewed slice" principle, checked here
 * against a synthetic 1.5M-character note via scripts/perf/
 * measureCM6RealApp.mjs -- a variant of the committed perf harness that
 * forces this dev-only path on in a real app instance, not the standalone
 * scripts/perf/cm6-spike/ prototype): found and fixed several O(document
 * length) operations this file was running on every keystroke/transform/
 * paste, despite CM6's own virtualized rendering already keeping DOM cost
 * viewport-bound. `view.state.doc.toString()` (a full-document string
 * allocation) was called on every caret update via updateCaret's rAF
 * (docChanged/selectionSet/viewportChanged all schedule one), every
 * keyboard-refocus-caging reconcile, and every paste, purely to feed
 * CaretVisualPosition.ts/CaretTerminalOffset.ts's rawText parameter -- code
 * written for Lexical, where that's the cheapest available source. Replaced
 * with resolveCM6CaretTopInScroll, a CM6-local equivalent using
 * view.state.doc.length and view.state.selection (both O(1)) plus a
 * bounded-length Text.sliceString tail probe instead of the whole document.
 * Separately, applyTransformResult (Tab/Enter/markdown-shortcut/character-
 * insert transforms) always dispatched `{from: 0, to: doc.length}` -- a
 * full-document replace on every one of these very common keys regardless of
 * how small the actual edit was -- now dispatches a minimal
 * common-prefix/common-suffix-diffed range instead (same technique already
 * proven in PreviewBlockSplit.ts/MarkdownContext.ts/
 * canonicalizeParagraphSegmentsIncremental). The four pre-commit transform
 * handlers (Tab/Enter/shortcut/character-insert) also no longer call
 * view.state.doc.toString() to build the `text` passed into the
 * EditorBindings callbacks -- they reuse previousTextRef.current, which the
 * updateListener below and the hydration effect keep synchronously in sync,
 * mirroring the exact pattern already proven for Lexical's own
 * ContractBridgePlugin.tsx (see the handover doc's readCanonicalRootText
 * fix). And the paste handler no longer materializes the full document to
 * splice a string by hand -- it dispatches the sanitized clipboard text as a
 * targeted `{from: selection.from, to: selection.to}` range change directly.
 * Verified via `npx tsc --noEmit`, `npm run lint`, the full unit suite
 * (unchanged, 251/251), a live-browser functional pass exercising typing/
 * Tab/Enter/Ctrl+B/paste/undo plus the caret-at-document-end-with-trailing-
 * blank-lines case the terminal-offset rewrite specifically targets
 * (scripts/perf/verifyCM6PostFix.mjs), and an A/B `git stash` burst
 * comparison isolating applyTransformResult's own effect (Enter-key burst,
 * 1.5M-char note, caret at end: 81.6ms/keystroke mean before this round's
 * diff-based replace, 73.5ms/keystroke after).
 *
 * What's still open, found by the same audit but out of scope for this pass
 * (not CM6Editor.tsx's own defect): CM6Editor is gated behind
 * `import.meta.env.DEV` in SectionEditorArea.tsx and a localStorage opt-in --
 * none of CM6's own ~2x keystroke-latency win over Lexical on a 1.5M-char
 * note (measured here: ~45ms/keystroke mean plain-typing burst vs. the
 * ~85-170ms Lexical baseline in docs/large-document-performance-handover.md)
 * nor any fix in this pass reaches a real packaged build yet. The remaining
 * per-keystroke cost on the CM6 path, per this round's profiling, is not
 * dominated by anything left in this file -- it's diffuse across the same
 * shared downstream pipeline documented in the handover doc for Lexical
 * (EditorSection.tsx's hook fan-out off `currentEditorText`: useNoteSnapshots,
 * useDocumentFind, usePreviewMarkdownRendering, useMarkdownFormattingToolbar,
 * noteTitle derivation, useNoteSaveQueue), which both editors route through
 * identically and which this pass didn't touch.
 */
export interface CM6EditorProps {
  bindings?: EditorBindings;
  adapterRef?: React.MutableRefObject<EditorAdapter | null>;
  noteId?: string | null;
  initialText?: string;
  scrollbarHost?: HTMLElement | null;
  fontFamily: string;
  fontSizePx: number;
  lineHeightPx: number;
  glyphWidthPx?: number;
  cellWidthPx?: number;
  editorReadOnly?: boolean;
  spellCheckEnabled?: boolean;
  // True once the editor font has loaded and glyph metrics (cellWidthPx,
  // glyphWidthPx) have been measured against the real font face -- same
  // semantics as Editor.tsx's own fontReady prop. Gated content waits for
  // both this and hasViewportLines (below).
  fontReady?: boolean;
  caretSuspended?: boolean;
}

function toSelectionState(range: { anchor: number; head: number; from: number; to: number; empty: boolean }): EditorSelectionState {
  return {
    anchor: range.anchor,
    focus: range.head,
    start: range.from,
    end: range.to,
    isCollapsed: range.empty,
  };
}

function commonPrefixLen(a: string, b: string): number {
  const max = Math.min(a.length, b.length);
  let i = 0;
  while (i < max && a.charCodeAt(i) === b.charCodeAt(i)) i += 1;
  return i;
}

function commonSuffixLen(a: string, b: string, maxLen: number): number {
  let i = 0;
  while (i < maxLen && a.charCodeAt(a.length - 1 - i) === b.charCodeAt(b.length - 1 - i)) i += 1;
  return i;
}

/**
 * Applies a transform's `{text, selection}` result -- the CM6 equivalent of
 * ContractBridgePlugin.tsx's replaceEditorTextFromCanonical +
 * scheduleTransformSelectionReplay, collapsed into a single atomic dispatch
 * since CM6 (unlike Lexical) applies a change and its selection together
 * without a deferred-DOM-commit race to work around.
 *
 * Dispatches only the minimal `{from, to, insert}` range covering where
 * `oldText` and `next.text` actually differ (common-prefix/common-suffix
 * diff -- the same technique PreviewBlockSplit.ts/MarkdownContext.ts/
 * canonicalizeParagraphSegmentsIncremental already use elsewhere in this
 * codebase), not a blanket `{from: 0, to: doc.length}` replace of the whole
 * document. The EditorBindings transform contract (onTabIndentTransform/
 * onEnterTransform/onMarkdownShortcutTransform/onCharacterInsertTransform)
 * only ever changes a small localized region -- a full-document replace on
 * every Tab/Enter/formatting-shortcut keystroke forced CM6 to treat the
 * entire document as changed (undo-history entry size, decoration/measure
 * invalidation) regardless of how small the actual edit was, on every one of
 * these very common keys. Provably exact by construction: prefixLen and
 * suffixLen are literal matching runs of `oldText`/`next.text`, so
 * `oldText.slice(0, prefixLen) + insert + oldText.slice(oldText.length -
 * suffixLen)` reconstructs `next.text` exactly -- not a "trust prior
 * computation" cache with a hazard class to verify, just a minimal-range
 * encoding of the same already-known target string.
 */
function applyTransformResult(view: EditorView, oldText: string, next: { text: string; selection: EditorSelectionState }): void {
  const anchor = Math.max(0, Math.min(next.text.length, next.selection.anchor));
  const focus = Math.max(0, Math.min(next.text.length, next.selection.focus));

  if (oldText === next.text) {
    view.dispatch({ selection: EditorSelection.single(anchor, focus) });
    return;
  }

  const prefixLen = commonPrefixLen(oldText, next.text);
  const maxSuffixLen = Math.min(oldText.length, next.text.length) - prefixLen;
  const suffixLen = commonSuffixLen(oldText, next.text, maxSuffixLen);

  view.dispatch({
    changes: {
      from: prefixLen,
      to: oldText.length - suffixLen,
      insert: next.text.slice(prefixLen, next.text.length - suffixLen),
    },
    selection: EditorSelection.single(anchor, focus),
  });
}

const TERMINAL_TRAILING_NEWLINE_PROBE_CHARS = 256;

/**
 * CM6-native replacement for CaretVisualPosition.ts's resolveCaretTopInScroll
 * + CaretTerminalOffset.ts's getTerminalTrailingVisualOffsetPx (both written
 * for Lexical, and still used as-is by Editor.tsx/BlockCaretPlugin.tsx/
 * CagedScrollPlugin.tsx, which have a different, already-cheap rawText
 * source and don't share this defect -- kept CM6-local rather than changed
 * in those shared files).
 *
 * The Lexical version needs the full canonical text string because Lexical
 * selection offsets are DOM-derived and the terminal-blank-line check has no
 * cheaper source there. CM6's own EditorState already carries both facts
 * that check needs as O(1) values -- total document length
 * (view.state.doc.length) and whether the caret sits at that length
 * (view.state.selection.main) -- so this never needs
 * view.state.doc.toString() (an O(document length) allocation) at all. Only
 * the trailing-newline COUNT needs to touch real document content, and only
 * a small bounded tail slice (Text.sliceString), never the whole document --
 * this was previously the single highest-frequency O(document length) call
 * in this file, hit on every caret update (i.e. essentially every keystroke,
 * scroll tick, and selection change via scheduleCaretUpdate's rAF), every
 * keyboard-refocus-caging reconcile, and every paste.
 */
function resolveCM6CaretTopInScroll(
  view: EditorView,
  caretRect: SelectionRect,
  scrollerRectTop: number,
  scrollerScrollTop: number,
  lineHeightPx: number,
): number {
  let terminalOffsetPx = 0;
  // Matches getTerminalTrailingVisualOffsetPx's own gate: only fallback
  // geometry sources need this compensation, primary rects are authoritative.
  if (caretRect.source === 'adjacent-probe' || caretRect.source === 'anchor-fallback') {
    const selection = view.state.selection.main;
    const docLength = view.state.doc.length;
    if (selection.empty && selection.head === docLength) {
      const tailStart = Math.max(0, docLength - TERMINAL_TRAILING_NEWLINE_PROBE_CHARS);
      const tail = view.state.doc.sliceString(tailStart);
      const trailingNewlines = tail.match(/\n+$/)?.[0].length ?? 0;
      const trailingExtraRows = Math.max(0, trailingNewlines - 1);
      terminalOffsetPx = trailingExtraRows * lineHeightPx;
    }
  }

  return (caretRect.top - scrollerRectTop) + scrollerScrollTop + terminalOffsetPx;
}

const CARET_INSET_PX = 1;
const EMPTY_LINE_TOP_TOLERANCE_PX = 2;
const EDITOR_PAGE_CONTINUOUS_SCROLL_APEX_MULTIPLIER = CONTINUOUS_SCROLL_APEX_SPEED_MULTIPLIER;

/** Ported verbatim from Editor.tsx -- the custom scrollbar's own geometry constants. */
const SCROLL_TRACK_MIN_THUMB_HEIGHT_PX = 28;
const SCROLL_TRACK_EDGE_GAP_PX = 3;

type ScrollbarGeometry = {
  viewportHeight: number;
  contentHeight: number;
  trackHeight: number;
  usableTrackHeight: number;
  thumbHeightPx: number;
  maxThumbTravelPx: number;
  maxScrollTopPx: number;
};

/**
 * Ported verbatim from CagedScrollPlugin.tsx's own isRefocusKey: the set of
 * keys whose resulting caret/document movement should be kept inside the
 * cage (scrolled into view if it would otherwise land off-screen). Excludes
 * anything Ctrl/Cmd/Alt-modified (shortcuts, not navigation/typing) and Tab
 * (never a refocus key in the original either -- Tab's own transform
 * handler has its own "preserve scroll" semantics, matching
 * CagedScrollPlugin's shouldBypassRefocusForTransformUpdate bypass for
 * tab-indent/shortcut-transform/character-transform tags: since none of
 * those are refocus keys to begin with under this same check, no separate
 * bypass list is needed here the way the Lexical version needed one --
 * except character-insert transforms (checklist typeover), which use a
 * single unmodified printable key and DO match isRefocusKey; that path
 * clears the intent explicitly before dispatching, see inputHandler below.
 */
function isRefocusKey(event: KeyboardEvent): boolean {
  if (
    event.key === 'ArrowUp' ||
    event.key === 'ArrowDown' ||
    event.key === 'ArrowLeft' ||
    event.key === 'ArrowRight' ||
    event.key === 'Home' ||
    event.key === 'End'
  ) {
    return true;
  }
  if (event.ctrlKey || event.metaKey || event.altKey) return false;
  if (event.key.length === 1) return true;
  return event.key === 'Enter' || event.key === 'Backspace' || event.key === 'Delete';
}

/** Ported verbatim from CagedScrollPlugin.tsx. topBoundaryPx/bottomBoundaryPx are always 0 here (see the file-level doc comment) until the boundary UI slice lands. */
function computeVisibleMiddleRows(
  scrollerClientHeightPx: number,
  topBoundaryPx: number,
  bottomBoundaryPx: number,
  lineHeightPx: number,
): number {
  const middleHeightPx = Math.max(
    lineHeightPx,
    Math.round(scrollerClientHeightPx) - Math.round(topBoundaryPx) - Math.round(bottomBoundaryPx),
  );
  return Math.max(1, Math.floor(middleHeightPx / lineHeightPx));
}

/** Ported verbatim from CagedScrollPlugin.tsx. */
const isAlignedToRowGrid = (valuePx: number, lineHeightPx: number) => Math.abs(valuePx % lineHeightPx) < 0.01;

// Rounds `value` to the nearest multiple of `unit`, offset by `phase` --
// i.e. the nearest value congruent to `phase` (mod unit), not to 0. Needed
// wherever this file snaps a real, measured DOM position (caret/selection
// rect) onto the row/column grid: since the half-cell edge-breathing-room
// shift moved every real row/column's true position from a plain multiple
// of lineHeightPx/cellWidthPx to (phase + N*unit), naively rounding to the
// nearest plain multiple would round every real position to the WRONG
// neighbor whenever phase is exactly half a unit (the real positions then
// sit precisely ON the phase-0 rounding tie line). Plain scrollTop values
// are NOT affected by this -- they stay phase-0 regardless (the content's
// own phase offset and the grid overlay's matching backgroundPosition
// shift cancel out of that particular invariant, see the alignment-padding
// comment above) -- only absolute row/column positions read directly off
// rendered DOM geometry need this.
const quantizeToPhase = (value: number, unit: number, phase: number) => (
  phase + Math.round((value - phase) / unit) * unit
);

/** Ported verbatim from CagedScrollPlugin.tsx's own resolveDirectionalQuantizedScrollTop. */
function resolveDirectionalQuantizedScrollTop(
  currentScrollTopPx: number,
  previousScrollTopPx: number,
  maxScrollTopPx: number,
  lineHeightPx: number,
): number {
  const delta = currentScrollTopPx - previousScrollTopPx;
  if (Math.abs(delta) < 0.01) {
    return Math.max(0, Math.min(maxScrollTopPx, Math.round(currentScrollTopPx / lineHeightPx) * lineHeightPx));
  }

  if (delta > 0) {
    return Math.max(0, Math.min(maxScrollTopPx, Math.ceil(currentScrollTopPx / lineHeightPx) * lineHeightPx));
  }

  return Math.max(0, Math.min(maxScrollTopPx, Math.floor(currentScrollTopPx / lineHeightPx) * lineHeightPx));
}

/** Ported verbatim from Editor.tsx. */
const quantizeTopEdge = (valuePx: number, lineHeightPx: number) => Math.max(0, Math.round(valuePx / lineHeightPx) * lineHeightPx);

/** Ported verbatim from Editor.tsx. */
const quantizeViewportHeightToGrid = (heightPx: number, lineHeightPx: number) => {
  const h = Math.max(0, Math.round(heightPx));
  const line = Math.max(1, Math.round(lineHeightPx));
  return Math.floor(h / line) * line;
};

/** Ported verbatim from Editor.tsx's own normalizeEditorBoundaryPair. */
function normalizeEditorBoundaryPair(params: {
  topBoundaryPx: number;
  bottomBoundaryPx: number;
  lineHeightPx: number;
  viewportHeightPx: number;
  preserve?: 'top' | 'bottom';
}) {
  const lineHeightPx = Math.max(1, Math.round(params.lineHeightPx));
  const viewportHeightPx = Math.max(0, Math.round(params.viewportHeightPx));
  const maxSum = Math.max(0, viewportHeightPx - lineHeightPx);
  const topBoundaryPx = Math.min(
    Math.max(0, quantizeTopEdge(params.topBoundaryPx, lineHeightPx)),
    maxSum,
  );
  const bottomBoundaryPx = Math.min(
    Math.max(0, quantizeTopEdge(params.bottomBoundaryPx, lineHeightPx)),
    maxSum,
  );

  if (topBoundaryPx + bottomBoundaryPx <= maxSum) {
    return { topBoundaryPx, bottomBoundaryPx };
  }

  const overflow = topBoundaryPx + bottomBoundaryPx - maxSum;
  if (params.preserve === 'bottom') {
    return {
      topBoundaryPx: Math.max(0, topBoundaryPx - overflow),
      bottomBoundaryPx,
    };
  }

  return {
    topBoundaryPx,
    bottomBoundaryPx: Math.max(0, bottomBoundaryPx - overflow),
  };
}

/**
 * Ported verbatim from Editor.tsx's own clampBoundaryLines: pure derivation
 * from stored (persisted) boundary line counts to displayed line counts,
 * given how many lines are currently available in the viewport. Never
 * mutates the stored values -- clamping is recomputed fresh from
 * (storedTopLines, storedBottomLines, availableLines) on every render. At
 * least one line must remain for the middle (text) section; top boundary has
 * priority for the available budget, bottom boundary gets whatever remains.
 */
function clampBoundaryLines(
  storedTopLines: number,
  storedBottomLines: number,
  availableLines: number,
): { topLines: number; bottomLines: number } {
  const safeTop = Math.max(0, Math.round(storedTopLines));
  const safeBottom = Math.max(0, Math.round(storedBottomLines));
  const safeAvailable = Math.max(0, Math.round(availableLines));
  const maxCombined = Math.max(0, safeAvailable - 1);

  const topLines = Math.min(safeTop, maxCombined);
  const bottomLines = Math.min(safeBottom, maxCombined - topLines);

  return { topLines, bottomLines };
}

interface HighlightRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

/** Ported verbatim from BlockSelectionPlugin.tsx -- walks up from `node` to the .cm-line element that's a direct child of `rootEl` (view.contentDOM), mirroring that file's own "top-level child" notion. */
function findTopLevelChild(rootEl: HTMLElement, node: Node | null): HTMLElement | null {
  let current: Node | null = node;
  while (current && current.parentElement !== rootEl) {
    current = current.parentElement;
  }
  return current instanceof HTMLElement ? current : null;
}

/**
 * Ported verbatim from BlockSelectionPlugin.tsx's own collectEmptyLineTops:
 * top (viewport) coordinates of every empty line spanned by the selection,
 * start to end inclusive -- a Range crossing an empty line still yields a
 * full-width client rect for it, which would otherwise paint a stray
 * full-row highlight on a line with nothing selected.
 */
function collectEmptyLineTops(rootEl: HTMLElement, domSelection: Selection): number[] {
  const startEl = findTopLevelChild(rootEl, domSelection.anchorNode);
  const endEl = findTopLevelChild(rootEl, domSelection.focusNode);
  if (!startEl || !endEl) return [];

  const children = Array.from(rootEl.children);
  const startIndex = children.indexOf(startEl);
  const endIndex = children.indexOf(endEl);
  if (startIndex === -1 || endIndex === -1) return [];

  const lo = Math.min(startIndex, endIndex);
  const hi = Math.max(startIndex, endIndex);

  const tops: number[] = [];
  for (let i = lo; i <= hi; i++) {
    const child = children[i];
    if (child.textContent === '') {
      tops.push(child.getBoundingClientRect().top);
    }
  }

  return tops;
}

const lineTokenPlugin = ViewPlugin.fromClass(class {
  decorations: DecorationSet;
  constructor(view: EditorView) {
    this.decorations = this.buildDecorations(view);
  }
  update(update: { docChanged: boolean; viewportChanged: boolean; view: EditorView }) {
    if (update.docChanged || update.viewportChanged) {
      this.decorations = this.buildDecorations(update.view);
    }
  }
  buildDecorations(view: EditorView): DecorationSet {
    const builder = new RangeSetBuilder<Decoration>();
    for (const { from, to } of view.visibleRanges) {
      let pos = from;
      while (pos <= to) {
        const line = view.state.doc.lineAt(pos);
        const presentation = buildTokenPresentation(line.text);
        if (presentation) {
          builder.add(line.from, line.from, Decoration.line({ class: presentation.classes.join(' ') }));
        }
        pos = line.to + 1;
      }
    }
    return builder.finish();
  }
}, {
  decorations: (pluginValue) => pluginValue.decorations,
});

export function CM6Editor({
  bindings,
  adapterRef,
  noteId,
  initialText = '',
  scrollbarHost = null,
  fontFamily,
  fontSizePx,
  lineHeightPx,
  glyphWidthPx = 0,
  cellWidthPx = 0,
  editorReadOnly = false,
  spellCheckEnabled = false,
  fontReady = true,
  caretSuspended = false,
}: CM6EditorProps) {
  const layerRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const bindingsRef = useRef(bindings);
  const previousTextRef = useRef('');
  const previousSelectionRef = useRef<EditorSelectionState>({ anchor: 0, focus: 0, start: 0, end: 0, isCollapsed: true });
  const lastHydratedNoteIdRef = useRef<string | null>(null);
  const lineHeightPxRef = useRef(lineHeightPx);
  const cellWidthPxRef = useRef(cellWidthPx);
  const [caretStyle, setCaretStyle] = useState<React.CSSProperties | null>(null);
  const caretAnimationFrameRef = useRef<number | null>(null);
  // scrollerRect/layerRect don't change on a plain text keystroke -- only
  // the selection Range rect does. Cached across updateCaret calls and only
  // re-measured when a resize invalidates the cache -- same optimization
  // BlockCaretPlugin.tsx uses ("cutting 2 of the ~4 forced synchronous
  // layout reads paid on every keystroke").
  const scrollerRectRef = useRef<DOMRect | null>(null);
  const caretLayerRectRef = useRef<DOMRect | null>(null);
  const [highlightRects, setHighlightRects] = useState<HighlightRect[]>([]);
  const highlightAnimationFrameRef = useRef<number | null>(null);

  // Fixed-focus caging boundary state -- ported from Editor.tsx. Stored as
  // integer line counts (resolution-independent, see EditorViewportLines's
  // own doc comment), with display pixel values derived fresh on every
  // render via clampBoundaryLines against the currently measured scroller
  // height. scrollerClientHeightPx is kept live by the mount effect's
  // existing ResizeObserver (see scheduleCaretUpdateAfterResize's call site).
  const [topBoundaryLines, setTopBoundaryLines] = useState(0);
  const [bottomBoundaryLines, setBottomBoundaryLines] = useState(0);
  // Ported from Editor.tsx's own hasViewportLines/isSnapshotRestorePending
  // gating: boundary-dependent visuals (grid, zone backgrounds, drag
  // handles, caret, selection highlight) render a 0/0 frame that then jumps
  // to the restored values unless suppressed until a real viewportLines
  // snapshot has landed and settled. hasViewportLines flips true (and stays
  // true) the first time applySnapshot receives viewportLines;
  // isSnapshotRestorePending is true only for the one rAF between an
  // applySnapshot call and its own settle, same as Editor.tsx.
  const [hasViewportLines, setHasViewportLines] = useState(false);
  const [isSnapshotRestorePending, setIsSnapshotRestorePending] = useState(false);
  const snapshotRestoreRafRef = useRef<number | null>(null);
  const caretHidden = isSnapshotRestorePending || caretSuspended;
  // Editor.tsx's RichTextPlugin shows/hides its placeholder automatically
  // based on whether Lexical's root node is empty; CM6 has no equivalent
  // built-in behavior, so this is tracked explicitly -- updated wherever the
  // document can change (the updateListener's docChanged branch, and the
  // note-switch hydration effect).
  const [isDocEmpty, setIsDocEmpty] = useState(() => initialText.length === 0);
  const [isDraggingTop, setIsDraggingTop] = useState(false);
  const [isDraggingBottom, setIsDraggingBottom] = useState(false);
  const [scrollerClientHeightPx, setScrollerClientHeightPx] = useState(0);
  const availableBoundaryLines = Math.max(0, Math.floor(scrollerClientHeightPx / lineHeightPx));
  const { topLines: displayTopBoundaryLines, bottomLines: displayBottomBoundaryLines } = clampBoundaryLines(
    topBoundaryLines,
    bottomBoundaryLines,
    availableBoundaryLines,
  );
  const topBoundaryPxDisplay = displayTopBoundaryLines * lineHeightPx;
  const bottomBoundaryPxDisplay = displayBottomBoundaryLines * lineHeightPx;
  // Read by imperative code inside the mount-once effect below (buildViewport,
  // the caging reconcile, PageUp/PageDown paging math), which can't close
  // over the state above directly since it's only set up once at mount.
  const topBoundaryPxRef = useRef(0);
  const bottomBoundaryPxRef = useRef(0);

  // Custom scrollbar state -- ported from Editor.tsx. The rail (track +
  // thumb) renders via a portal into scrollbarHost (a dedicated DOM slot
  // owned by SectionEditorArea.tsx, outside this component's own tree) --
  // same portal target Editor.tsx's own scrollbar rail uses, so switching
  // between the Lexical and CM6 paths doesn't require a different slot.
  const scrollbarTrackRef = useRef<HTMLDivElement | null>(null);
  const [scrollThumbTopPx, setScrollThumbTopPx] = useState(0);
  const [scrollThumbHeightPx, setScrollThumbHeightPx] = useState(0);
  const [isScrollThumbActive, setIsScrollThumbActive] = useState(false);
  const [isDraggingScrollThumb, setIsDraggingScrollThumb] = useState(false);
  // Read inside syncCustomScrollbar instead of closing over the state
  // value directly -- syncCustomScrollbar is called from the mount-once
  // effect's long-lived handleScroll/updateListener closures (captured once,
  // never re-created), so it must have a fully stable identity to avoid
  // those closures forever seeing a stale isDraggingScrollThumb=false and
  // fighting an active thumb drag.
  const isDraggingScrollThumbRef = useRef(false);
  const scrollThumbDragOriginRef = useRef<{ pointerY: number; thumbTopPx: number } | null>(null);
  const lastPassiveScrollbarMetricsRef = useRef<{
    scrollTopPx: number;
    scrollHeightPx: number;
    clientHeightPx: number;
    trackHeightPx: number;
  } | null>(null);
  const scrollbarRightHoldRef = useRef<{
    key: 'PageUp' | 'PageDown';
    direction: 1 | -1;
    cursorYPx: number;
    rafId: number | null;
  } | null>(null);

  const readScrollbarGeometry = useCallback((): ScrollbarGeometry | null => {
    const scroller = viewRef.current?.scrollDOM;
    const track = scrollbarTrackRef.current;
    if (!scroller || !track) return null;

    const viewportHeight = scroller.clientHeight;
    const contentHeight = scroller.scrollHeight;
    const trackHeight = track.clientHeight;
    const usableTrackHeight = Math.max(0, trackHeight - (SCROLL_TRACK_EDGE_GAP_PX * 2));
    const maxScrollTopPx = Math.max(0, contentHeight - viewportHeight);

    if (viewportHeight <= 0 || contentHeight <= 0 || trackHeight <= 0) {
      return {
        viewportHeight,
        contentHeight,
        trackHeight,
        usableTrackHeight,
        thumbHeightPx: 0,
        maxThumbTravelPx: 0,
        maxScrollTopPx,
      };
    }

    if (contentHeight <= viewportHeight) {
      return {
        viewportHeight,
        contentHeight,
        trackHeight,
        usableTrackHeight,
        thumbHeightPx: usableTrackHeight,
        maxThumbTravelPx: 0,
        maxScrollTopPx,
      };
    }

    const visibleRatio = viewportHeight / contentHeight;
    const thumbHeightPx = Math.max(
      SCROLL_TRACK_MIN_THUMB_HEIGHT_PX,
      Math.min(usableTrackHeight, Math.round(usableTrackHeight * visibleRatio)),
    );
    const maxThumbTravelPx = Math.max(0, usableTrackHeight - thumbHeightPx);

    return {
      viewportHeight,
      contentHeight,
      trackHeight,
      usableTrackHeight,
      thumbHeightPx,
      maxThumbTravelPx,
      maxScrollTopPx,
    };
  }, []);

  const syncCustomScrollbar = useCallback((options?: { force?: boolean }) => {
    if (isDraggingScrollThumbRef.current && !options?.force) {
      return;
    }

    const scroller = viewRef.current?.scrollDOM;
    const geometry = readScrollbarGeometry();
    if (!scroller || !geometry) return;

    if (geometry.viewportHeight <= 0 || geometry.contentHeight <= 0 || geometry.trackHeight <= 0) {
      setScrollThumbHeightPx(0);
      setScrollThumbTopPx(0);
      setIsScrollThumbActive(false);
      return;
    }

    if (geometry.contentHeight <= geometry.viewportHeight) {
      setScrollThumbHeightPx(geometry.usableTrackHeight);
      setScrollThumbTopPx(SCROLL_TRACK_EDGE_GAP_PX);
      setIsScrollThumbActive(false);
      return;
    }

    const scrollRatio = geometry.maxScrollTopPx > 0 ? scroller.scrollTop / geometry.maxScrollTopPx : 0;
    const nextThumbTop = SCROLL_TRACK_EDGE_GAP_PX + Math.round(geometry.maxThumbTravelPx * scrollRatio);

    setScrollThumbHeightPx(geometry.thumbHeightPx);
    setScrollThumbTopPx(nextThumbTop);
    setIsScrollThumbActive(true);
  }, [readScrollbarGeometry]);

  const scrollFromThumbTop = useCallback((thumbTopPx: number) => {
    const scroller = viewRef.current?.scrollDOM;
    const geometry = readScrollbarGeometry();
    if (!scroller || !geometry) return;

    const maxThumbTravel = geometry.maxThumbTravelPx;
    const minThumbTop = SCROLL_TRACK_EDGE_GAP_PX;
    const maxThumbTop = SCROLL_TRACK_EDGE_GAP_PX + maxThumbTravel;
    const clampedTop = Math.max(minThumbTop, Math.min(thumbTopPx, maxThumbTop));
    setScrollThumbTopPx(clampedTop);

    const maxScrollTop = geometry.maxScrollTopPx;
    const ratio = maxThumbTravel > 0 ? (clampedTop - SCROLL_TRACK_EDGE_GAP_PX) / maxThumbTravel : 0;
    const targetScrollTop = ratio * maxScrollTop;
    const quantizedScrollTop = Math.max(0, Math.min(maxScrollTop, Math.round(targetScrollTop / lineHeightPxRef.current) * lineHeightPxRef.current));
    scroller.scrollTop = quantizedScrollTop;
  }, [readScrollbarGeometry]);

  useEffect(() => {
    bindingsRef.current = bindings;
  }, [bindings]);

  useEffect(() => {
    isDraggingScrollThumbRef.current = isDraggingScrollThumb;
  }, [isDraggingScrollThumb]);

  useEffect(() => {
    lineHeightPxRef.current = lineHeightPx;
    cellWidthPxRef.current = cellWidthPx;
  }, [lineHeightPx, cellWidthPx]);

  useEffect(() => {
    topBoundaryPxRef.current = topBoundaryPxDisplay;
    bottomBoundaryPxRef.current = bottomBoundaryPxDisplay;
  }, [topBoundaryPxDisplay, bottomBoundaryPxDisplay]);

  // Matches Editor.tsx's own cleanup for its snapshotRestoreRafRef -- avoids
  // a setState-after-unmount if a note switch/section teardown races the
  // one-rAF settle scheduled inside applySnapshot above.
  useEffect(() => {
    return () => {
      if (snapshotRestoreRafRef.current !== null) {
        cancelAnimationFrame(snapshotRestoreRafRef.current);
        snapshotRestoreRafRef.current = null;
      }
    };
  }, []);

  // Found live: scrolled all the way to the end of a note, the last visible
  // rows sat measurably off the fixed grid overlay (up to lineHeightPx-1 px)
  // -- e.g. 11px off on a 26px line height. Root cause: the DOM's own
  // natural max scrollTop is `scrollHeight - clientHeight`, and while
  // scrollHeight is always an exact multiple of lineHeightPx (every boundary
  // and every line is), clientHeight is whatever arbitrary pixel height the
  // window/pane happens to be -- essentially never itself a multiple of
  // lineHeightPx. So the natural max-scroll lands on a non-grid-aligned
  // value, and any way of reaching it (dragging the custom scrollbar thumb
  // to the end, the browser's own resize-triggered scrollTop reclamp when a
  // window shrinks, etc.) breaks the fixed grid overlay's alignment with
  // the now off-grid visible rows.
  //
  // Fixed at the root rather than patched at each call site: padding the
  // bottom of the content by exactly (clientHeight mod lineHeightPx) makes
  // the DOM's OWN natural max-scroll already land on a grid-quantized
  // value. Every piece of this file's scroll math (the caging reconcile,
  // wheel/PageDown/drag-quantization clamps, the custom scrollbar's own
  // geometry) already computes its own max-scroll fresh from
  // scroller.scrollHeight/clientHeight rather than caching it, so all of it
  // inherits the fix automatically -- no other call site needed to change.
  // The added padding is bounded to under one row, so it reads as an
  // ordinary small margin at the end of the document, not a visible gap.
  //
  // The top of the content is ALSO offset by halfLineHeightPx (see the
  // half-cell edge-breathing-room shift below), which adds a non-grid-
  // quantized amount to scrollHeight from the top side. That offset has to
  // be folded into this formula too -- the two offsets don't cancel out on
  // their own since one lands at the top of scrollHeight and the other at
  // the bottom -- via proper (always-non-negative) modulo arithmetic.
  // Rounded to a whole device pixel, not left fractional: a fractional
  // background-position/padding value (e.g. 13.5px, whenever lineHeightPx
  // is odd) forces the grid's own hard color-stop edges to sub-pixel
  // blend, rendering that one line visibly wider/blurrier than the rest of
  // the grid -- confirmed live at an odd line-height setting. The shift
  // only needs to be "about half a cell" for breathing room, not exactly
  // half, so rounding costs nothing and keeps every grid line equally crisp.
  const halfCellWidthPx = Math.round(cellWidthPx / 2);
  const halfLineHeightPx = Math.round(lineHeightPx / 2);
  const alignmentPaddingBottomPx = lineHeightPx > 0
    ? (((scrollerClientHeightPx - halfLineHeightPx) % lineHeightPx) + lineHeightPx) % lineHeightPx
    : 0;

  // Content padding is how the boundary "cage" actually keeps text out of
  // the top/bottom zones -- applied directly to view.contentDOM (CM6's own
  // `.cm-content`) since that DOM node is owned by CM6, not React, matching
  // Editor.tsx's own ContentEditable paddingTop/paddingBottom.
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    // paddingLeft/the extra half-line of paddingTop are the "infinity grid"
    // edge-breathing-room shift: the whole grid + text moves half a cell in
    // the positive x/y direction so content doesn't start flush against the
    // container's top-left edge, while staying a grid that conceptually
    // extends beyond the container in all directions (cut-off boxes at the
    // far edges are expected, not a bug -- see the grid overlay's own
    // backgroundPosition below, which is shifted by the exact same amount
    // so text and grid move together and stay aligned).
    view.contentDOM.style.paddingLeft = `${halfCellWidthPx}px`;
    view.contentDOM.style.paddingTop = `${topBoundaryPxDisplay + halfLineHeightPx}px`;
    view.contentDOM.style.paddingBottom = `${bottomBoundaryPxDisplay + alignmentPaddingBottomPx}px`;
    // Same reasoning as the lineHeightPx/cellWidthPx metrics-change effect
    // further down: an external padding mutation grows/shrinks scrollHeight
    // outside CM6's own dispatch/transaction system, so its scrollTop
    // reconciliation across that needs to be forced rather than left to
    // whatever unforced schedule it would otherwise settle on.
    view.requestMeasure();
  }, [topBoundaryPxDisplay, bottomBoundaryPxDisplay, alignmentPaddingBottomPx, halfCellWidthPx, halfLineHeightPx]);

  // Custom scrollbar sync -- ported from Editor.tsx's own three sync
  // effects. Runs after the portal target (scrollbarHost) or any layout
  // input the thumb geometry depends on changes; the mount-once effect's own
  // scroll/updateListener/resize wiring (below) covers ongoing sync once
  // mounted, and the passive rAF loop further below catches anything those
  // miss (e.g. scrollHeight drift from an async font load reflow).
  useLayoutEffect(() => {
    syncCustomScrollbar();
    requestAnimationFrame(() => syncCustomScrollbar());
  }, [syncCustomScrollbar, scrollbarHost]);

  useEffect(() => {
    syncCustomScrollbar();
  }, [syncCustomScrollbar, scrollerClientHeightPx, initialText, topBoundaryPxDisplay, bottomBoundaryPxDisplay]);

  useEffect(() => {
    let rafId: number | null = null;

    const runPassiveSync = () => {
      const scroller = viewRef.current?.scrollDOM;
      const track = scrollbarTrackRef.current;

      if (scroller && track) {
        const nextMetrics = {
          scrollTopPx: Math.round(scroller.scrollTop),
          scrollHeightPx: Math.round(scroller.scrollHeight),
          clientHeightPx: Math.round(scroller.clientHeight),
          trackHeightPx: Math.round(track.clientHeight),
        };

        const previousMetrics = lastPassiveScrollbarMetricsRef.current;
        const changed =
          !previousMetrics ||
          previousMetrics.scrollTopPx !== nextMetrics.scrollTopPx ||
          previousMetrics.scrollHeightPx !== nextMetrics.scrollHeightPx ||
          previousMetrics.clientHeightPx !== nextMetrics.clientHeightPx ||
          previousMetrics.trackHeightPx !== nextMetrics.trackHeightPx;

        if (changed) {
          lastPassiveScrollbarMetricsRef.current = nextMetrics;
          syncCustomScrollbar();
        }
      }

      rafId = requestAnimationFrame(runPassiveSync);
    };

    rafId = requestAnimationFrame(runPassiveSync);

    return () => {
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
      }
      lastPassiveScrollbarMetricsRef.current = null;
    };
  }, [syncCustomScrollbar]);

  const buildViewport = (view: EditorView): EditorViewportState => ({
    topBoundaryPx: topBoundaryPxRef.current,
    bottomBoundaryPx: bottomBoundaryPxRef.current,
    scrollTopPx: view.scrollDOM.scrollTop,
    lineHeightPx: lineHeightPxRef.current,
    cellWidthPx: cellWidthPxRef.current,
    scrollHeightPx: view.scrollDOM.scrollHeight,
    clientHeightPx: view.scrollDOM.clientHeight,
  });

  const invalidateCaretRectCache = useCallback(() => {
    scrollerRectRef.current = null;
    caretLayerRectRef.current = null;
  }, []);

  /**
   * Ported from BlockCaretPlugin.tsx's own updateCaret -- same algorithm,
   * same pure geometry functions (readSelectionRect, resolveCaretTopInScroll,
   * both already engine-agnostic: they read window.getSelection()/
   * getBoundingClientRect() directly, not any Lexical-specific API), sourced
   * from the CM6 EditorView instead of Lexical's editor state. Two
   * deliberate differences from the original, both noted rather than
   * silently carried over or silently dropped:
   * - No isRefocusTransactionActive/caged-scroll-settling guard yet -- the
   *   fixed-focus caging system (CagedScrollPlugin's own state machine)
   *   isn't ported here, so there's nothing to wait on yet. Revisit once it
   *   is.
   * - resolveRuntimeCellWidthPx's CSS-custom-property runtime lookup is
   *   skipped -- CM6Editor doesn't set --editor-cell-width on its DOM the
   *   way Editor.tsx does, so this uses the cellWidthPx prop directly. Worth
   *   adding if runtime font-metric drift from the prop ever actually
   *   matters here; not assumed to.
   */
  const updateCaret = useCallback(() => {
    const view = viewRef.current;
    const layerEl = layerRef.current;
    if (!view || !layerEl) return;

    const selectionRange = view.state.selection.main;
    if (!selectionRange.empty) {
      setCaretStyle(null);
      return;
    }

    const domSelection = window.getSelection();
    if (!domSelection || domSelection.rangeCount === 0) {
      setCaretStyle(null);
      return;
    }

    if (document.activeElement !== view.contentDOM) {
      setCaretStyle(null);
      return;
    }

    const caretRect = readSelectionRect(domSelection, lineHeightPxRef.current, view.contentDOM);
    if (!caretRect) {
      setCaretStyle(null);
      return;
    }

    const scroller = view.scrollDOM;
    if (!scrollerRectRef.current) {
      scrollerRectRef.current = scroller.getBoundingClientRect();
    }
    if (!caretLayerRectRef.current) {
      caretLayerRectRef.current = layerEl.getBoundingClientRect();
    }
    const scrollerRect = scrollerRectRef.current;
    const caretLayerRect = caretLayerRectRef.current;

    const caretTopInScroll = resolveCM6CaretTopInScroll(
      view,
      caretRect,
      scrollerRect.top,
      scroller.scrollTop,
      lineHeightPxRef.current,
    );

    const lineHeightPxNow = lineHeightPxRef.current;
    // Phase lineHeightPxNow/2, not 0: real rows sit at (halfLine + N*line)
    // now, per the half-cell edge-breathing-room shift -- see
    // quantizeToPhase's own comment.
    const quantizedRowTopInScroll = quantizeToPhase(caretTopInScroll, lineHeightPxNow, Math.round(lineHeightPxNow / 2));
    const topInViewport = quantizedRowTopInScroll - scroller.scrollTop;

    if (topInViewport < 0 || topInViewport > scroller.clientHeight - lineHeightPxNow) {
      setCaretStyle(null);
      return;
    }

    const runtimeCellWidthPx = Math.max(1, cellWidthPxRef.current);
    const scrollerLeftInLayer = scrollerRect.left - caretLayerRect.left;
    const scrollerTopInLayer = scrollerRect.top - caretLayerRect.top;
    let absoluteLeft = caretRect.left - scrollerRect.left;
    absoluteLeft = quantizeToPhase(absoluteLeft, runtimeCellWidthPx, Math.round(runtimeCellWidthPx / 2));

    const caretWidthPx = Math.max(1, runtimeCellWidthPx - CARET_INSET_PX);
    const caretHeightPx = Math.max(1, lineHeightPxNow - CARET_INSET_PX);

    setCaretStyle({
      transform: `translate3d(${scrollerLeftInLayer + absoluteLeft + CARET_INSET_PX}px, ${scrollerTopInLayer + topInViewport + CARET_INSET_PX}px, 0)`,
      width: caretWidthPx,
      height: caretHeightPx,
    });
  }, []);

  const scheduleCaretUpdate = useCallback(() => {
    if (caretAnimationFrameRef.current !== null) {
      cancelAnimationFrame(caretAnimationFrameRef.current);
    }
    caretAnimationFrameRef.current = requestAnimationFrame(() => {
      caretAnimationFrameRef.current = null;
      updateCaret();
    });
  }, [updateCaret]);

  const scheduleCaretUpdateAfterResize = useCallback(() => {
    invalidateCaretRectCache();
    scheduleCaretUpdate();
  }, [invalidateCaretRectCache, scheduleCaretUpdate]);

  /**
   * Ported verbatim from BlockSelectionPlugin.tsx's own updateSelection --
   * same algorithm (readSelectionLineRects, empty-line filtering, quantized
   * row merging, viewport clipping), sourced from the CM6 EditorView instead
   * of Lexical's editor state. Doesn't require focus the way updateCaret
   * does: a read-only note's native text selection still works (and should
   * still highlight) even though it never becomes document.activeElement.
   */
  const updateSelectionHighlight = useCallback(() => {
    const view = viewRef.current;
    const layerEl = layerRef.current;
    if (!view || !layerEl) return;

    const domSelection = window.getSelection();
    if (!domSelection || domSelection.rangeCount === 0 || domSelection.isCollapsed) {
      setHighlightRects([]);
      return;
    }

    const rootEl = view.contentDOM;
    if (!rootEl.contains(domSelection.anchorNode) || !rootEl.contains(domSelection.focusNode)) {
      setHighlightRects([]);
      return;
    }

    const scroller = view.scrollDOM;
    const lineRects = readSelectionLineRects(domSelection.getRangeAt(0));
    if (lineRects.length === 0) {
      setHighlightRects([]);
      return;
    }

    const emptyLineTops = collectEmptyLineTops(rootEl, domSelection);

    const scrollerRect = scroller.getBoundingClientRect();
    const layerRect = layerEl.getBoundingClientRect();
    const scrollerLeftInLayer = scrollerRect.left - layerRect.left;
    const scrollerTopInLayer = scrollerRect.top - layerRect.top;
    const runtimeCellWidthPx = Math.max(1, cellWidthPxRef.current);
    const scrollerWidth = scroller.clientWidth;
    const lineHeightPxNow = lineHeightPxRef.current;

    const rowsByQuantizedTop = new Map<number, { left: number; right: number }>();

    for (const lineRect of lineRects) {
      const isEmptyLine = emptyLineTops.some(
        (top) => Math.abs(top - lineRect.top) < EMPTY_LINE_TOP_TOLERANCE_PX,
      );
      if (isEmptyLine) continue;

      const topInScroll = (lineRect.top - scrollerRect.top) + scroller.scrollTop;
      // Same phase-aware quantization as updateCaret's own -- see
      // quantizeToPhase's comment.
      const quantizedRowTopInScroll = quantizeToPhase(topInScroll, lineHeightPxNow, Math.round(lineHeightPxNow / 2));

      const rawLeft = lineRect.left - scrollerRect.left;
      const rawRight = lineRect.right - scrollerRect.left;
      const quantizedLeft = quantizeToPhase(rawLeft, runtimeCellWidthPx, Math.round(runtimeCellWidthPx / 2));
      const quantizedRight = quantizeToPhase(rawRight, runtimeCellWidthPx, Math.round(runtimeCellWidthPx / 2));

      const existingRow = rowsByQuantizedTop.get(quantizedRowTopInScroll);
      if (existingRow) {
        existingRow.left = Math.min(existingRow.left, quantizedLeft);
        existingRow.right = Math.max(existingRow.right, quantizedRight);
      } else {
        rowsByQuantizedTop.set(quantizedRowTopInScroll, { left: quantizedLeft, right: quantizedRight });
      }
    }

    const nextRects: HighlightRect[] = [];

    for (const [quantizedRowTopInScroll, row] of rowsByQuantizedTop) {
      const topInViewport = quantizedRowTopInScroll - scroller.scrollTop;

      const visibleTop = Math.max(0, topInViewport);
      const visibleBottom = Math.min(scroller.clientHeight, topInViewport + lineHeightPxNow);
      const visibleHeight = visibleBottom - visibleTop;
      if (visibleHeight <= 0) continue;

      const clippedLeft = Math.max(0, row.left);
      const clippedRight = Math.min(scrollerWidth, row.right);
      const width = clippedRight - clippedLeft;
      if (width <= 0) continue;

      nextRects.push({
        top: scrollerTopInLayer + visibleTop,
        left: scrollerLeftInLayer + clippedLeft,
        width,
        height: visibleHeight,
      });
    }

    setHighlightRects(nextRects);
  }, []);

  const scheduleSelectionHighlightUpdate = useCallback(() => {
    if (highlightAnimationFrameRef.current !== null) {
      cancelAnimationFrame(highlightAnimationFrameRef.current);
    }
    highlightAnimationFrameRef.current = requestAnimationFrame(() => {
      highlightAnimationFrameRef.current = null;
      updateSelectionHighlight();
    });
  }, [updateSelectionHighlight]);

  // Found live: changing the y-box (line-height) slider while scrolled into
  // a large (virtualized) document could leave every visible line sitting
  // measurably off the grid -- e.g. 11px off on a 27px line height --
  // self-correcting a beat later on its own, or immediately on the next
  // scroll. Root-caused by polling the actual DOM on a tight interval
  // across a real line-height transition (26px -> 27px): scrollHeight grew
  // (CM6's own layout reflowed to the new line height) BEFORE scrollTop was
  // adjusted to preserve the same visual scroll position -- scrollTop was
  // still observed at its pre-change value up to ~100ms after the CSS
  // custom property had already updated, during which every rendered line
  // was positioned according to a scrollTop CM6 hadn't finished
  // reconciling against the new geometry yet. view.requestMeasure() forces
  // CM6 to settle that reflow (and whatever scroll-position preservation it
  // does across one) synchronously in this same effect, rather than
  // however many frames its own default schedule would otherwise take.
  //
  // Separately (still worth keeping): scheduleCaretUpdateAfterResize/
  // scheduleSelectionHighlightUpdate/syncCustomScrollbar are the exact same
  // three calls the ResizeObserver path elsewhere in this file already
  // makes on a real resize -- a metrics change deserves the same re-sync
  // even though the container's own outer bounding box doesn't move, so
  // these overlays don't paint from a stale pre-change measurement either.
  useEffect(() => {
    viewRef.current?.requestMeasure();
    scheduleCaretUpdateAfterResize();
    scheduleSelectionHighlightUpdate();
    syncCustomScrollbar();
  }, [lineHeightPx, cellWidthPx, scheduleCaretUpdateAfterResize, scheduleSelectionHighlightUpdate, syncCustomScrollbar]);

  useEffect(() => {
    if (!containerRef.current) return;

    // Wheel + PageUp/PageDown scroll physics -- ported from
    // CagedScrollPlugin.tsx's own wheel/page-key handling (same quantized
    // wheel stepping, same continuous-hold-then-release-ramp curve for a
    // held PageUp/PageDown, sharing the exact same pure math modules:
    // ScrollCurvePlan-backed NonQuantizedSmoothScroll/QuantizedSmoothScroll).
    // Deliberately NOT ported yet in this slice: the keyboard caret-refocus
    // caging intent (arrows/Enter keeping the caret pinned inside the cage
    // boundary), paste caret-preservation, and drag-selection scroll
    // quantization -- CagedScrollPlugin's own state machine for those is
    // entangled with Lexical's registerUpdateListener/tags timing model in
    // a way wheel/page scrolling isn't, so it's a separate slice. Because
    // that reconcile system isn't here yet, clearCagedRefocusState() has
    // nothing to clear and is correctly omitted from the wheel handler
    // below (matching what it would be once ported: a no-op today).
    let pendingWheelPx = 0;
    const pageKeysHeld = new Set<string>();
    let pageContinuousDirection: -1 | 0 | 1 = 0;
    let pageContinuousRafId: number | null = null;
    let pageContinuousLastTs: number | null = null;
    let pageContinuousHandoffTimeoutId: number | null = null;
    let pageReleaseRampDownRafId: number | null = null;

    const clearPageContinuousHandoff = () => {
      if (pageContinuousHandoffTimeoutId !== null) {
        window.clearTimeout(pageContinuousHandoffTimeoutId);
        pageContinuousHandoffTimeoutId = null;
      }
    };

    const stopPageContinuousScroll = () => {
      pageContinuousDirection = 0;
      pageContinuousLastTs = null;
      if (pageContinuousRafId !== null) {
        cancelAnimationFrame(pageContinuousRafId);
        pageContinuousRafId = null;
      }
      if (pageReleaseRampDownRafId !== null) {
        cancelAnimationFrame(pageReleaseRampDownRafId);
        pageReleaseRampDownRafId = null;
      }
    };

    const startPageReleaseRampDown = (scroller: HTMLElement, direction: -1 | 1) => {
      const visibleRows = computeVisibleMiddleRows(scroller.clientHeight, topBoundaryPxRef.current, bottomBoundaryPxRef.current, lineHeightPxRef.current);
      const pageStepDistancePx = visibleRows * lineHeightPxRef.current;
      const releaseSpeedPxPerSec = Math.max(
        1,
        resolveApexSpeedPxPerSecFromCurrentParams(pageStepDistancePx)
          * EDITOR_PAGE_CONTINUOUS_SCROLL_APEX_MULTIPLIER,
      );
      const rampDownPlan = buildReleaseRampDownPlanFromCurrentParams(direction, releaseSpeedPxPerSec);
      if (!rampDownPlan) {
        stopPageContinuousScroll();
        return;
      }

      if (pageContinuousRafId !== null) {
        cancelAnimationFrame(pageContinuousRafId);
        pageContinuousRafId = null;
      }
      pageContinuousDirection = 0;
      pageContinuousLastTs = null;

      if (pageReleaseRampDownRafId !== null) {
        cancelAnimationFrame(pageReleaseRampDownRafId);
        pageReleaseRampDownRafId = null;
      }

      const startScrollTop = scroller.scrollTop;
      const maxScrollTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
      let startMs: number | null = null;

      const animateRampDown = (nowMs: number) => {
        if (startMs === null) {
          startMs = nowMs;
        }

        const elapsedSec = Math.max(0, (nowMs - startMs) / 1000);
        const displacement = sampleReleaseRampDownPlan(rampDownPlan, elapsedSec);
        const lineHeightPxNow = lineHeightPxRef.current;
        const nextScrollTop = Math.max(0, Math.min(maxScrollTop, startScrollTop + displacement));
        const quantizedTarget = Math.round(nextScrollTop / lineHeightPxNow) * lineHeightPxNow;

        if (Math.abs(quantizedTarget - scroller.scrollTop) > 0.01) {
          scroller.scrollTop = quantizedTarget;
        }

        const hitBoundary = quantizedTarget <= 0.01 || quantizedTarget >= maxScrollTop - 0.01;
        if (elapsedSec >= rampDownPlan.tailDurationSec || hitBoundary) {
          pageReleaseRampDownRafId = null;
          return;
        }

        pageReleaseRampDownRafId = requestAnimationFrame(animateRampDown);
      };

      pageReleaseRampDownRafId = requestAnimationFrame(animateRampDown);
    };

    const runPageContinuousScroll = (scroller: HTMLElement, nowMs: number) => {
      if (pageContinuousDirection === 0) {
        pageContinuousRafId = null;
        pageContinuousLastTs = null;
        return;
      }

      const previousTs = pageContinuousLastTs;
      pageContinuousLastTs = nowMs;

      if (previousTs !== null) {
        const deltaSec = Math.max(0, (nowMs - previousTs) / 1000);
        const lineHeightPxNow = lineHeightPxRef.current;
        const visibleRows = computeVisibleMiddleRows(scroller.clientHeight, topBoundaryPxRef.current, bottomBoundaryPxRef.current, lineHeightPxNow);
        const pageStepDistancePx = visibleRows * lineHeightPxNow;
        const speedPxPerSec = Math.max(
          1,
          resolveApexSpeedPxPerSecFromCurrentParams(pageStepDistancePx)
            * EDITOR_PAGE_CONTINUOUS_SCROLL_APEX_MULTIPLIER,
        );
        const maxScrollTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
        const nextScrollTop = Math.max(
          0,
          Math.min(maxScrollTop, scroller.scrollTop + pageContinuousDirection * speedPxPerSec * deltaSec),
        );
        const quantizedTarget = Math.round(nextScrollTop / lineHeightPxNow) * lineHeightPxNow;

        if (Math.abs(quantizedTarget - scroller.scrollTop) > 0.01) {
          scroller.scrollTop = quantizedTarget;
        }

        const hitBoundary = (pageContinuousDirection < 0 && quantizedTarget <= 0.01)
          || (pageContinuousDirection > 0 && quantizedTarget >= maxScrollTop - 0.01);
        if (hitBoundary) {
          stopPageContinuousScroll();
          return;
        }
      }

      pageContinuousRafId = requestAnimationFrame((ts) => runPageContinuousScroll(scroller, ts));
    };

    const startPageContinuousScroll = (scroller: HTMLElement, direction: -1 | 1) => {
      cancelQuantizedSmoothScroll(scroller);
      const previousDirection = pageContinuousDirection;
      pageContinuousDirection = direction;
      if (pageContinuousRafId === null || previousDirection !== direction) {
        pageContinuousLastTs = null;
      }
      if (pageContinuousRafId === null) {
        pageContinuousRafId = requestAnimationFrame((ts) => runPageContinuousScroll(scroller, ts));
      }
    };

    // Keyboard caret-refocus caging -- ported from CagedScrollPlugin.tsx's
    // own refocus-caged intent, substantially simplified: CM6 applies a
    // transaction's state AND DOM changes synchronously (unlike Lexical,
    // which defers its own reconciler DOM commit to a microtask -- the
    // entire reason the original needed a bounded retry loop, tracked
    // "pressed keys" set, and a deterministic-Enter-boundary special case,
    // none of which have anything left to work around here). A key that
    // matches isRefocusKey arms `pendingCageIntent`; the updateListener
    // below reconciles the scroll position against the post-transaction
    // caret rect (already settled by the time it runs) and clears the flag.
    // Confirmed live this is genuinely needed, not just theoretical: CM6's
    // own native scrollIntoView on arrow-key movement brings the caret
    // in-bounds but NOT row-grid-quantized, which left the block-caret
    // overlay's own quantized bounds check rejecting it as still (barely)
    // off-screen -- e.g. topInViewport 581 against a 605px-tall/26px-row
    // viewport whose last fully-in-bounds row tops out at 579 -- so the
    // caret overlay simply vanished on every arrow-key scroll past the fold
    // before this reconcile existed.
    let pendingCageIntent = false;

    const reconcileCagedScroll = (view: EditorView) => {
      const scroller = view.scrollDOM;
      const domSelection = window.getSelection();
      if (!domSelection || domSelection.rangeCount === 0) return;

      const lineHeightPxNow = lineHeightPxRef.current;
      const scrollerRect = scroller.getBoundingClientRect();
      const caretRect = readSelectionRect(domSelection, lineHeightPxNow, view.contentDOM);
      if (!caretRect) return;

      const caretTopInScroll = resolveCM6CaretTopInScroll(
        view,
        caretRect,
        scrollerRect.top,
        scroller.scrollTop,
        lineHeightPxNow,
      );

      const { targetScrollTopPx } = resolveCagedScrollTarget({
        caretTopInScrollPx: caretTopInScroll,
        scrollerScrollTopPx: scroller.scrollTop,
        scrollerClientHeightPx: scroller.clientHeight,
        scrollerScrollHeightPx: scroller.scrollHeight,
        topBoundaryPx: topBoundaryPxRef.current,
        bottomBoundaryPx: bottomBoundaryPxRef.current,
        lineHeightPx: lineHeightPxNow,
        rowPhaseOffsetPx: Math.round(lineHeightPxNow / 2),
      });

      if (Math.abs(targetScrollTopPx - scroller.scrollTop) > 0.01) {
        scrollToQuantizedSmooth(scroller, targetScrollTopPx, { lineHeightPx: lineHeightPxNow });
      }
    };

    // Paste sanitization -- ported from PasteSanitizationPlugin.tsx's own
    // PASTE_COMMAND/KEY_DOWN_COMMAND handlers. Strips rich clipboard content
    // down to sanitized plain text (control/invisible chars, emoji, raw HTML
    // tags; the "extended" path additionally reconstructs wrapped-paragraph
    // line breaks and normalizes bullet markers -- see textSanitization.ts).
    // Ctrl+Shift+V requests the non-extended (plain) sanitization, matching
    // the original's own "power paste" escape hatch.
    let plainPasteRequested = false;
    // Set by the paste handler right before it mutates the document, read
    // (and cleared) by the updateListener's own reconcile below -- CM6's
    // synchronous transaction commit means this doesn't need Lexical's
    // onUpdate-callback indirection, just a same-tick handoff.
    let pendingPasteViewportOffsetPx: number | null = null;

    const reconcilePasteScroll = (view: EditorView, viewportOffsetPx: number) => {
      const scroller = view.scrollDOM;
      const domSelection = window.getSelection();
      if (!domSelection || domSelection.rangeCount === 0) return;

      const lineHeightPxNow = lineHeightPxRef.current;
      const scrollerRect = scroller.getBoundingClientRect();
      const caretRect = readSelectionRect(domSelection, lineHeightPxNow, view.contentDOM);
      if (!caretRect) return;

      const caretTopInScroll = resolveCM6CaretTopInScroll(
        view,
        caretRect,
        scrollerRect.top,
        scroller.scrollTop,
        lineHeightPxNow,
      );

      // Keep the caret on the same screen-relative line it occupied before
      // the paste, rather than clamping it to the cage's top/bottom row like
      // a normal refocus reconcile would.
      const maxScrollTopPx = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
      let targetScrollTopPx = caretTopInScroll - viewportOffsetPx;
      targetScrollTopPx = Math.round(targetScrollTopPx / lineHeightPxNow) * lineHeightPxNow;
      targetScrollTopPx = Math.max(0, Math.min(maxScrollTopPx, targetScrollTopPx));

      if (Math.abs(targetScrollTopPx - scroller.scrollTop) > 0.01) {
        scroller.scrollTop = targetScrollTopPx;
      }
    };

    // Drag-selection scroll quantization state -- see handlePointerDown/
    // handleSelectionDragScrollQuantization below (attached after `view`
    // exists) for the ported CagedScrollPlugin.tsx behavior these back.
    let isPrimaryPointerDown = false;
    let lastDragScrollTopPx = 0;
    let isApplyingDragQuantizedCorrection = false;
    let dragCorrectionFrame: number | null = null;

    const extensions: Extension[] = [
      history(),
      keymap.of([...defaultKeymap, ...historyKeymap]),
      lineTokenPlugin,
      EditorView.lineWrapping,
      EditorView.editable.of(!editorReadOnly),
      // CM6's own drawSelection() extension is deliberately NOT included --
      // both the cursor (block-grid caret overlay below) and the
      // non-collapsed selection background (highlightRects overlay below)
      // are this app's own custom rendering now, matching Lexical's
      // BlockCaretPlugin/BlockSelectionPlugin split. Native ::selection is
      // already suppressed for `.editor-text` in index.css (can't stay
      // grid-aligned once padding grows past ~1px), so leaving CM6's native
      // selection rendering on would show nothing for a selection at all.
      // `editor-text` matches the class app-level code outside this
      // component (e.g. App.tsx's "click anywhere near the editor refocuses
      // the real editable surface" affordance) already queries for -- found
      // via live testing, not assumed: without it, every click here gets
      // preventDefault()'d because that code only recognizes Lexical's own
      // `.editor-text[contenteditable]` DOM shape. This is the correct
      // target class going forward, not a workaround -- this element really
      // is "the editor text surface" other app code should find.
      EditorView.contentAttributes.of({ class: 'editor-text', spellcheck: String(spellCheckEnabled) }),
      // CM6's own base theme sets `.cm-scroller { height: 100% }`, which
      // resolves against `.cm-editor`'s height -- and `.cm-editor` itself
      // has no explicit height in that base theme, so by default it just
      // grows to fit its content instead of filling this component's
      // container. Found live, not assumed: without this, `.cm-scroller`
      // (view.scrollDOM, what every viewport/scroll/caret computation in
      // this file targets) never actually overflows -- confirmed via
      // scrollHeight === clientHeight on a 50,000-character note -- and the
      // container div ends up doing the real scrolling "by accident" via
      // its own overflow, which view.scrollDOM never sees. This theme
      // constrains `.cm-editor` to 100% of the container so `.cm-scroller`
      // becomes the genuine scrolling element, matching CM6's own intended
      // integration contract.
      EditorView.theme({
        '&': { height: '100%' },
        // CM6's own base theme gives .cm-scroller a native OS scrollbar in
        // both directions. This app draws its own scrollbar (ported in a
        // later slice) and never scrolls horizontally (line-wrapping is
        // always on), so both native scrollbars are pure visual noise here.
        '.cm-scroller': {
          scrollbarWidth: 'none',
          overflowX: 'hidden',
        },
        '.cm-scroller::-webkit-scrollbar': {
          width: '0px',
          height: '0px',
        },
        // CM6's own base theme gives .cm-line a 6px left padding and
        // .cm-content a 4px top/bottom padding -- both invisible until you
        // go looking for pixel-perfect grid alignment: the box grid overlay
        // (a sibling div, positioned independently of .cm-content's own box
        // model) assumes glyphs start exactly at the content origin, but
        // these defaults shifted the actual rendered glyphs 6px right and
        // 4px down from it. Confirmed live via Range.getBoundingClientRect()
        // on individual characters against the grid overlay's own measured
        // position -- not a rounding artifact, a real, exact 6px/4px offset.
        // .cm-content's own padding-top/bottom is still further overridden
        // imperatively for the real boundary values (see the content
        // padding effect below); zeroed here as the correct base default
        // rather than relying on that effect alone (see its own comment for
        // why: it can lose a race with view creation on a fresh 0/0 mount).
        '.cm-line': { padding: '0' },
        // caret-color !important: CM6's own base theme sets this via
        // `.ͼN .cm-content` (its generated theme-scope class + a descendant
        // combinator, e.g. `.ͼ2 .cm-content { caret-color: black }` /
        // `.ͼ3 .cm-content { caret-color: white }` for dark mode) --
        // confirmed live by walking document.styleSheets. That's two
        // class-level selectors (specificity 0,2,0), which beats
        // .editor-text's single-class rule (0,1,0) in index.css regardless
        // of source order, so the "hide the native OS caret, we draw our
        // own block caret" rule was silently losing and the real native
        // caret was showing through. !important forces the win outright
        // rather than trying to out-specificity a selector CM6 controls and
        // could change the shape of at any point.
        '.cm-content': { padding: '0', caretColor: 'transparent !important' },
      }),
      // Tab/Enter/markdown-shortcut transforms -- ported verbatim from
      // ContractBridgePlugin.tsx's KEY_TAB_COMMAND/KEY_DOWN_COMMAND/
      // KEY_ENTER_COMMAND handlers (same conditional logic, same pure
      // transform callbacks from EditorBindings). Registered as a
      // Prec.highest keymap using the `any` handler (fires for every key,
      // gets the raw KeyboardEvent) rather than domEventHandlers.keydown --
      // found live, not assumed: @codemirror/commands' defaultKeymap binds
      // Enter to its own insertNewlineAndIndent, and CM6's internal keymap
      // dispatch runs at higher precedence than a plain domEventHandlers
      // registration, so Enter (and any other defaultKeymap-bound key) never
      // reached a domEventHandlers.keydown handler at all -- confirmed by
      // instrumenting keydown directly: every character logged except
      // Enter, while a plain (uncontinuing) newline still appeared, proving
      // CM6's own default binding was silently winning. Prec.highest here
      // guarantees this layer is checked before defaultKeymap regardless of
      // registration order.
      //
      // Deliberately Ctrl (not Cmd/Mod) for the markdown shortcuts, matching
      // the original exactly: `!event.ctrlKey || event.metaKey` rejects the
      // shortcut, so Ctrl+B (not Cmd+B) is what this app has always bound,
      // even on Mac -- preserved rather than "corrected" to platform
      // convention, since that's a deliberate product choice, not a bug.
      Prec.highest(keymap.of([{
        any: (view, event) => {
          if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === 'v') {
            plainPasteRequested = true;
          }

          if (isRefocusKey(event)) {
            pendingCageIntent = true;
          }

          if (event.key === 'PageUp' || event.key === 'PageDown') {
            // Ported from CagedScrollPlugin.tsx's own PageUp/PageDown
            // handling -- claimed here (Prec.highest, same as Tab/Enter
            // above) rather than left to @codemirror/commands' defaultKeymap,
            // which binds these to its own cursorPageUp/cursorPageDown
            // (cursor movement, not the app's own quantized page-scroll feel).
            pendingCageIntent = false;
            event.preventDefault();
            const direction: -1 | 1 = event.key === 'PageDown' ? 1 : -1;
            const scroller = view.scrollDOM;
            pageKeysHeld.add(event.key);

            if (event.repeat) {
              if (pageContinuousHandoffTimeoutId === null) {
                startPageContinuousScroll(scroller, direction);
              }
              return true;
            }

            clearPageContinuousHandoff();
            stopPageContinuousScroll();

            const lineHeightPxNow = lineHeightPxRef.current;
            const visibleRows = computeVisibleMiddleRows(scroller.clientHeight, topBoundaryPxRef.current, bottomBoundaryPxRef.current, lineHeightPxNow);
            const delta = direction * visibleRows * lineHeightPxNow;

            const maxScrollTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
            const currentAligned = Math.round(scroller.scrollTop / lineHeightPxNow) * lineHeightPxNow;
            const target = Math.max(0, Math.min(maxScrollTop, currentAligned + delta));
            const quantizedTarget = Math.round(target / lineHeightPxNow) * lineHeightPxNow;

            scrollToQuantizedSmooth(scroller, quantizedTarget, { lineHeightPx: lineHeightPxNow });

            const targetContinuousSpeedPxPerSec = Math.max(
              1,
              resolveApexSpeedPxPerSecFromCurrentParams(quantizedTarget - currentAligned)
                * EDITOR_PAGE_CONTINUOUS_SCROLL_APEX_MULTIPLIER,
            );
            const crossingTimeSec = resolveRampCrossingTimeSecFromCurrentParams(
              quantizedTarget - currentAligned,
              targetContinuousSpeedPxPerSec,
            );

            if (crossingTimeSec !== null) {
              const delayMs = Math.max(0, Math.round(crossingTimeSec * 1000));
              const key = event.key;
              pageContinuousHandoffTimeoutId = window.setTimeout(() => {
                pageContinuousHandoffTimeoutId = null;
                if (!pageKeysHeld.has(key)) return;
                startPageContinuousScroll(scroller, direction);
              }, delayMs);
            }
            return true;
          }

          if (event.key === 'Tab') {
            // Same click sound/echo as ContractBridgePlugin.tsx's own
            // KEY_TAB_COMMAND handler -- played unconditionally like the
            // original, not gated on the transform actually changing
            // anything.
            const tabKeyId = event.shiftKey ? 'key:Shift:Tab' : 'key:Tab';
            if (event.shiftKey) {
              void typingSoundManager.playRandomClick({
                keyId: tabKeyId,
                reverse: true,
                gain: 0.7,
                echo: { count: 2, delayMs: 80, decay: 0.4 },
                detune: 600,
              });
            } else {
              void typingSoundManager.playRandomClick({
                keyId: tabKeyId,
                gain: 0.7,
                echo: { count: 2, delayMs: 80, decay: 0.4 },
              });
            }

            // previousTextRef.current is guaranteed to already equal a fresh
            // view.state.doc.toString() here: this is a pre-commit handler
            // (fires before this keystroke's own edit), and the ref is kept
            // in sync with every committed transaction by the
            // updateListener below (and by the hydration effect on note
            // switch) -- the same "reuse a synchronously-kept-in-sync ref
            // instead of re-deriving" pattern already proven for Lexical's
            // ContractBridgePlugin.tsx (see docs/large-document-performance-
            // handover.md's readCanonicalRootText fix).
            const text = previousTextRef.current;
            const selection = toSelectionState(view.state.selection.main);
            const transformCallback = bindingsRef.current?.onTabIndentTransform;
            if (transformCallback) {
              const next = transformCallback({ shiftKey: event.shiftKey, text, selection });
              if (next) {
                event.preventDefault();
                applyTransformResult(view, text, next);
                return true;
              }
            }
            bindingsRef.current?.onTabIndent?.({ shiftKey: event.shiftKey });
            // Never let Tab escape the editor to focus/menu navigation,
            // matching ContractBridgePlugin's own unconditional
            // preventDefault/stopPropagation for this key.
            event.preventDefault();
            return true;
          }

          if (event.key === 'Enter') {
            const callback = bindingsRef.current?.onEnterTransform;
            if (!callback) return false;
            // See the Tab handler above for why previousTextRef.current is
            // safe to reuse here instead of a fresh view.state.doc.toString().
            const text = previousTextRef.current;
            const selection = toSelectionState(view.state.selection.main);
            const next = callback({
              shiftKey: event.shiftKey,
              altKey: event.altKey,
              ctrlKey: event.ctrlKey,
              metaKey: event.metaKey,
              text,
              selection,
            });
            if (!next) return false;
            event.preventDefault();
            applyTransformResult(view, text, next);
            return true;
          }

          const shortcutCallback = bindingsRef.current?.onMarkdownShortcutTransform;
          if (shortcutCallback && event.ctrlKey && !event.metaKey && !event.altKey) {
            let shortcut: 'bold' | 'italic' | 'strikethrough' | 'heading-toggle' | 'unordered-list' | 'ordered-list' | null = null;
            const key = event.key.toLowerCase();
            if (!event.shiftKey && key === 'b') shortcut = 'bold';
            else if (!event.shiftKey && key === 'i') shortcut = 'italic';
            else if (!event.shiftKey && key === 'j') shortcut = 'strikethrough';
            else if (!event.shiftKey && key === 't') shortcut = 'heading-toggle';
            else if (!event.shiftKey && event.key === '-') shortcut = 'unordered-list';
            else if ((event.shiftKey && event.key === '3') || event.key === '#') shortcut = 'ordered-list';

            if (shortcut) {
              // See the Tab handler above for why previousTextRef.current is
              // safe to reuse here instead of a fresh view.state.doc.toString().
              const text = previousTextRef.current;
              const selection = toSelectionState(view.state.selection.main);
              const next = shortcutCallback({ shortcut, text, selection });
              if (next) {
                event.preventDefault();
                applyTransformResult(view, text, next);
                return true;
              }
            }
          }

          return false;
        },
      }])),
      // Arrow-key/undo/redo click sounds -- ported verbatim from
      // Editor.tsx's handleEditorKeyDown. A domEventObservers registration
      // (not domEventHandlers) deliberately, since this is a pure side
      // effect that must always fire and never claim the event or affect
      // precedence -- exactly matching the original, which was a plain
      // React onKeyDown prop with no preventDefault. Plain typing/backspace
      // and Enter sounds need no separate wiring here: those already live
      // inside the EditorBindings themselves (onTextChange's text-length-
      // delta detection, onEnterTransform's own unconditional click), which
      // CM6Editor already calls -- so they work automatically.
      EditorView.domEventObservers({
        keydown: (event) => {
          const modifiers = [
            event.shiftKey ? 'Shift' : null,
            event.ctrlKey ? 'Control' : null,
            event.altKey ? 'Alt' : null,
            event.metaKey ? 'Meta' : null,
          ].filter(Boolean).join('+');
          const keyId = modifiers ? `key:${modifiers}:${event.key}` : `key:${event.key}`;
          switch (event.key) {
            case 'ArrowLeft':
            case 'ArrowRight':
            case 'ArrowUp':
            case 'ArrowDown':
              void typingSoundManager.playRandomClick({ keyId, detune: 1200, gain: 0.3 });
              break;
            case 'z':
              if (event.ctrlKey || event.metaKey) {
                void typingSoundManager.playRandomClick({ keyId, reverse: true, detune: -1200, gain: 0.7 });
              }
              break;
            case 'y':
              if (event.ctrlKey || event.metaKey) {
                void typingSoundManager.playRandomClick({ keyId, detune: -1200, gain: 0.7 });
              }
              break;
            default:
              break;
          }
        },
      }),
      // Character-insert transform (e.g. checklist typeover) -- uses CM6's
      // inputHandler rather than keydown so this only ever fires for a
      // genuine committed single-character insertion (matches Lexical's own
      // `event.key.length === 1 && !event.isComposing` gate without needing
      // to reimplement IME-composition detection by hand).
      EditorView.inputHandler.of((view, from, to, insertedText) => {
        const callback = bindingsRef.current?.onCharacterInsertTransform;
        if (!callback) return false;
        if (insertedText.length !== 1 || from !== to) return false;

        // inputHandler fires pre-commit (CM6 hasn't applied the default
        // insertion yet, since returning true here preempts it), so
        // previousTextRef.current is still accurate -- see the Tab handler
        // above for why reusing it beats a fresh view.state.doc.toString().
        const text = previousTextRef.current;
        const selection = toSelectionState(view.state.selection.main);
        const next = callback({ char: insertedText, text, selection });
        if (!next) return false;

        // A plain single printable key matches isRefocusKey and already
        // armed pendingCageIntent above -- this transform (e.g. checklist
        // typeover) replays selection with its own preserve-scroll
        // semantics, matching CagedScrollPlugin.tsx's own bypass for the
        // 'character-transform' tag, so clear it before dispatching.
        pendingCageIntent = false;
        applyTransformResult(view, text, next);
        return true;
      }),
      EditorView.domEventHandlers({
        paste: (event, view) => {
          if (!event.clipboardData) {
            plainPasteRequested = false;
            return false;
          }
          const plainText = event.clipboardData.getData('text/plain');
          if (typeof plainText !== 'string') {
            plainPasteRequested = false;
            return false;
          }

          event.preventDefault();

          const usePlainSanitization = plainPasteRequested;
          plainPasteRequested = false;

          const sanitized = usePlainSanitization
            ? sanitizeDocumentText(plainText)
            : sanitizeDocumentTextExtended(plainText);

          const selection = view.state.selection.main;

          // Preserve the caret's on-screen line before the paste mutates the
          // document -- ported from CagedScrollPlugin.tsx's own
          // preserve-caret-line handlePaste logic. Consumed by the
          // updateListener below instead of the normal cage-clamp reconcile.
          const domSelection = window.getSelection();
          const scroller = view.scrollDOM;
          if (domSelection && domSelection.rangeCount > 0) {
            const caretRect = readSelectionRect(domSelection, lineHeightPxRef.current, view.contentDOM);
            if (caretRect) {
              const scrollerRect = scroller.getBoundingClientRect();
              const caretTopInScroll = resolveCM6CaretTopInScroll(
                view,
                caretRect,
                scrollerRect.top,
                scroller.scrollTop,
                lineHeightPxRef.current,
              );
              pendingPasteViewportOffsetPx = caretTopInScroll - scroller.scrollTop;
            }
          }

          // Dispatched as a targeted range replace rather than splicing a
          // full-document string (the previous version materialized
          // view.state.doc.toString() and built a whole new document string
          // via slice+concat purely to hand back to CM6, which already
          // supports replacing just the selected range directly): both the
          // O(document length) toString() and the O(document length)
          // string-splice this replaces are gone, and nextCursor is exact by
          // construction (selection.from + sanitized.length always lands
          // inside the resulting document, no clamping needed).
          const nextCursor = selection.from + sanitized.length;

          // Ensures a reconcile happens even when no pre-paste caret geometry
          // could be measured above: the updateListener prefers the
          // preserve-offset reconcile when pendingPasteViewportOffsetPx is
          // set, falling back to the normal cage-clamp reconcile otherwise --
          // matching CagedScrollPlugin.tsx's own fallback for this case.
          pendingCageIntent = true;
          view.dispatch({
            changes: { from: selection.from, to: selection.to, insert: sanitized },
            selection: EditorSelection.cursor(nextCursor),
          });

          return true;
        },
      }),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) {
          // doc.toJSON() (public, documented CodeMirror API -- collects each
          // line via direct array pushes, Text.flatten) + one native
          // .join('\n') call, instead of doc.toString() (equivalent to
          // sliceString(0), which builds the result via repeated `+=` across
          // every child/leaf -- a classic V8 ConsString-chain pattern).
          // Found via HeapProfiler sampling against a 1.5M-char note: a
          // single character-index access into a toString()-produced string
          // (deriveTypingSoundKeyId's `event.text[i]`, the first thing
          // bindings.onTextChange does) triggered a ~38-45MB flatten of the
          // whole ConsString on that one keystroke -- see the handover doc's
          // "what (program) really is" section. join('\n') on an
          // already-flat-per-line array produces the same string in one
          // pass, no lazy ConsString to flatten later. Provably equivalent
          // output (CodeMirror's own toJSON() doc comment: the array is
          // reconstructable via Text.of(), i.e. exactly the '\n'-joined
          // lines toString() itself returns), so no fuzz test needed --
          // verified with a live A/B (git-diff-isolated, 3 runs each): total
          // heap allocation dropped ~2.3x (45MB->19MB per 30-keystroke
          // burst), GC time in the CDP profile dropped a clean ~20% (every
          // fixed run below every baseline run, no overlap).
          const nextText = update.state.doc.toJSON().join('\n');
          const previousText = previousTextRef.current;
          const nextSelection = toSelectionState(update.state.selection.main);
          previousTextRef.current = nextText;
          previousSelectionRef.current = nextSelection;
          setIsDocEmpty(nextText.length === 0);

          const event: EditorTextChangeEvent = {
            source: 'user-input',
            text: nextText,
            previousText,
            selection: nextSelection,
          };
          bindingsRef.current?.onTextChange?.(event);
        } else if (update.selectionSet) {
          const nextSelection = toSelectionState(update.state.selection.main);
          const previous = previousSelectionRef.current;
          const changed = nextSelection.anchor !== previous.anchor
            || nextSelection.focus !== previous.focus
            || nextSelection.start !== previous.start
            || nextSelection.end !== previous.end
            || nextSelection.isCollapsed !== previous.isCollapsed;
          if (changed) {
            previousSelectionRef.current = nextSelection;
            bindingsRef.current?.onSelectionChange?.({ source: 'user-input', selection: nextSelection });
          }
        }
        if (update.docChanged || update.selectionSet || update.viewportChanged) {
          scheduleCaretUpdate();
          scheduleSelectionHighlightUpdate();
        }
        if (update.docChanged) {
          syncCustomScrollbar();
        }
        if (pendingPasteViewportOffsetPx !== null && update.docChanged) {
          const offset = pendingPasteViewportOffsetPx;
          pendingPasteViewportOffsetPx = null;
          pendingCageIntent = false;
          reconcilePasteScroll(update.view, offset);
        } else if (pendingCageIntent && (update.docChanged || update.selectionSet)) {
          pendingCageIntent = false;
          reconcileCagedScroll(update.view);
        }
      }),
    ];

    const view = new EditorView({
      state: EditorState.create({ doc: initialText, extensions }),
      parent: containerRef.current,
    });
    viewRef.current = view;
    lastHydratedNoteIdRef.current = noteId ?? null;

    previousTextRef.current = initialText;
    const initialSelection = toSelectionState(view.state.selection.main);
    previousSelectionRef.current = initialSelection;

    bindingsRef.current?.onLifecycle?.({ phase: 'mounted' });
    bindingsRef.current?.onLifecycle?.({ phase: 'ready' });
    bindingsRef.current?.onTextChange?.({
      source: 'initial-load',
      text: initialText,
      previousText: '',
      selection: initialSelection,
    });
    bindingsRef.current?.onSelectionChange?.({ source: 'initial-load', selection: initialSelection });
    bindingsRef.current?.onViewportChange?.({
      source: 'programmatic',
      origin: 'programmatic',
      viewport: buildViewport(view),
    });

    // Scroll reporting -- mirrors Editor.tsx's own scroller 'scroll'
    // listener + buildViewport. isProgrammaticScrollRef-style origin
    // disambiguation (drag vs. real user scroll) isn't needed yet since
    // there's no drag-handle UI here to originate a 'viewport-drag' event.
    const handleScroll = () => {
      bindingsRef.current?.onViewportChange?.({
        source: 'user-input',
        origin: 'scroll',
        viewport: buildViewport(view),
      });
      scheduleCaretUpdate();
      scheduleSelectionHighlightUpdate();
      syncCustomScrollbar();
    };
    view.scrollDOM.addEventListener('scroll', handleScroll, { passive: true });

    // Cage-quantized wheel scroll -- ported verbatim from
    // CagedScrollPlugin.tsx's own handleWheel.
    const handleWheel = (event: WheelEvent) => {
      if (event.deltaY === 0) return;
      event.preventDefault();

      let units = 0;

      if (event.deltaMode === WheelEvent.DOM_DELTA_LINE) {
        const lineUnits = Math.trunc(Math.abs(event.deltaY));
        units = Math.max(1, lineUnits) * (event.deltaY > 0 ? 1 : -1);
      } else if (event.deltaMode === WheelEvent.DOM_DELTA_PAGE) {
        const pageUnits = Math.trunc(Math.abs(event.deltaY));
        units = Math.max(1, pageUnits) * (event.deltaY > 0 ? 1 : -1);
      } else {
        pendingWheelPx += event.deltaY;
        const stepSign = pendingWheelPx < 0 ? -1 : 1;
        const unitCount = Math.floor(Math.abs(pendingWheelPx) / PIXELS_PER_WHEEL_UNIT);
        if (unitCount === 0) return;
        units = unitCount * stepSign;
        pendingWheelPx -= unitCount * PIXELS_PER_WHEEL_UNIT * stepSign;
      }

      if (units === 0) return;

      const lineHeightPxNow = lineHeightPxRef.current;
      const scroller = view.scrollDOM;
      const maxScrollTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
      const target = Math.max(0, Math.min(maxScrollTop, scroller.scrollTop + units * lineHeightPxNow));
      scroller.scrollTop = Math.round(target / lineHeightPxNow) * lineHeightPxNow;
    };
    view.scrollDOM.addEventListener('wheel', handleWheel, { passive: false });

    // PageUp/PageDown release-ramp: keyup on the scroller (not a keymap
    // entry -- CM6's keymap system only sees keydown) starts the
    // deceleration curve once the held key is released, and window
    // blur/visibility-change guard against a stuck continuous scroll if the
    // keyup itself never arrives (alt-tab, etc.) -- ported verbatim from
    // CagedScrollPlugin.tsx's own handleKeyUp/handleWindowBlur/
    // handleVisibilityChange (page-scroll-relevant parts only; the rest of
    // those handlers deals with caret-refocus state not yet ported).
    const handlePageKeyUp = (event: KeyboardEvent) => {
      if (event.key !== 'PageUp' && event.key !== 'PageDown') return;
      pageKeysHeld.delete(event.key);
      clearPageContinuousHandoff();
      if (pageKeysHeld.size === 0) {
        const activeDirection = pageContinuousDirection;
        if (activeDirection !== 0) {
          startPageReleaseRampDown(view.scrollDOM, activeDirection);
        } else {
          stopPageContinuousScroll();
        }
      }
    };
    view.scrollDOM.addEventListener('keyup', handlePageKeyUp, { capture: true });

    // Drag-selection scroll quantization -- ported verbatim from
    // CagedScrollPlugin.tsx's own handlePointerDown/handleMouseDown/
    // handleSelectionDragScrollQuantization/endPointerDragSelection. Native
    // drag-to-select auto-scroll moves scrollTop by sub-pixel amounts each
    // frame, which (like the native arrow-key scrollIntoView in the caging
    // slice above) isn't row-grid-quantized -- this snaps it back onto the
    // grid one frame behind the native scroll, directionally (never
    // "backwards" against the drag) so it doesn't fight the gesture.
    const endPointerDragSelection = () => {
      isPrimaryPointerDown = false;
      if (dragCorrectionFrame !== null) {
        cancelAnimationFrame(dragCorrectionFrame);
        dragCorrectionFrame = null;
      }
    };

    const handlePointerDown = (event: PointerEvent) => {
      if (event.button !== 0) return;
      isPrimaryPointerDown = true;
      lastDragScrollTopPx = view.scrollDOM.scrollTop;
    };
    const handleMouseDown = (event: MouseEvent) => {
      if (event.button !== 0) return;
      isPrimaryPointerDown = true;
      lastDragScrollTopPx = view.scrollDOM.scrollTop;
    };
    const handlePointerUp = () => endPointerDragSelection();
    const handlePointerCancel = () => endPointerDragSelection();

    const handleSelectionDragScrollQuantization = () => {
      const scroller = view.scrollDOM;
      const observedScrollTopPx = scroller.scrollTop;

      if (isApplyingDragQuantizedCorrection) {
        lastDragScrollTopPx = observedScrollTopPx;
        return;
      }

      if (!isPrimaryPointerDown) {
        lastDragScrollTopPx = observedScrollTopPx;
        return;
      }

      const root = view.contentDOM;
      const domSelection = window.getSelection();
      if (!domSelection || domSelection.rangeCount === 0 || domSelection.isCollapsed) {
        lastDragScrollTopPx = observedScrollTopPx;
        return;
      }

      const range = domSelection.getRangeAt(0);
      if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) {
        lastDragScrollTopPx = observedScrollTopPx;
        return;
      }

      if (dragCorrectionFrame !== null) {
        cancelAnimationFrame(dragCorrectionFrame);
      }

      dragCorrectionFrame = requestAnimationFrame(() => {
        dragCorrectionFrame = null;
        if (!isPrimaryPointerDown) return;

        const currentScrollTopPx = scroller.scrollTop;
        const lineHeightPxNow = lineHeightPxRef.current;
        if (isAlignedToRowGrid(currentScrollTopPx, lineHeightPxNow)) {
          lastDragScrollTopPx = currentScrollTopPx;
          return;
        }

        const maxScrollTopPx = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
        const quantizedTargetPx = resolveDirectionalQuantizedScrollTop(
          currentScrollTopPx,
          lastDragScrollTopPx,
          maxScrollTopPx,
          lineHeightPxNow,
        );

        if (Math.abs(quantizedTargetPx - currentScrollTopPx) < 0.01) {
          lastDragScrollTopPx = currentScrollTopPx;
          return;
        }

        isApplyingDragQuantizedCorrection = true;
        scroller.scrollTop = quantizedTargetPx;
        isApplyingDragQuantizedCorrection = false;
        lastDragScrollTopPx = quantizedTargetPx;
      });
    };

    document.addEventListener('pointerdown', handlePointerDown, { capture: true, passive: true });
    document.addEventListener('mousedown', handleMouseDown, { capture: true, passive: true });
    view.scrollDOM.addEventListener('scroll', handleSelectionDragScrollQuantization, { passive: true });
    window.addEventListener('pointerup', handlePointerUp, { passive: true });
    window.addEventListener('mouseup', handlePointerUp, { passive: true });
    window.addEventListener('pointercancel', handlePointerCancel, { passive: true });

    const handleWindowBlur = () => {
      pageKeysHeld.clear();
      clearPageContinuousHandoff();
      stopPageContinuousScroll();
      endPointerDragSelection();
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState !== 'visible') {
        pageKeysHeld.clear();
        clearPageContinuousHandoff();
        stopPageContinuousScroll();
        endPointerDragSelection();
      }
    };
    window.addEventListener('blur', handleWindowBlur);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    // Neither the updateListener nor the scroll listener fire when THIS
    // editor loses/gains DOM focus (e.g. clicking into a different
    // split-view section) -- same gap BlockCaretPlugin.tsx's own comment
    // documents. Without this, switching away leaves the caret frozen on
    // screen instead of disappearing.
    const handleFocusChange = () => {
      scheduleCaretUpdate();
      scheduleSelectionHighlightUpdate();
    };
    document.addEventListener('focusin', handleFocusChange, true);
    document.addEventListener('focusout', handleFocusChange, true);

    // Read-only notes (contentEditable=false) still support native text
    // selection, but CM6's own update cycle isn't guaranteed to react to it
    // the way it does for editable content -- listen directly so the
    // highlight still tracks a drag-selection there, matching
    // BlockSelectionPlugin.tsx's own reasoning.
    document.addEventListener('selectionchange', scheduleSelectionHighlightUpdate);

    // Covers layout shifts that don't fire a window resize event (sidebar
    // toggle, split-view pane resize, font-size change). Also keeps
    // scrollerClientHeightPx (the boundary UI's clampBoundaryLines input)
    // live, matching Editor.tsx's own editorSize.innerHeight tracking.
    const resizeObserver = new ResizeObserver(() => {
      scheduleCaretUpdateAfterResize();
      scheduleSelectionHighlightUpdate();
      setScrollerClientHeightPx(view.scrollDOM.clientHeight);
    });
    resizeObserver.observe(view.scrollDOM);
    if (layerRef.current) resizeObserver.observe(layerRef.current);

    setScrollerClientHeightPx(view.scrollDOM.clientHeight);
    scheduleCaretUpdate();
    scheduleSelectionHighlightUpdate();

    return () => {
      if (caretAnimationFrameRef.current !== null) {
        cancelAnimationFrame(caretAnimationFrameRef.current);
        caretAnimationFrameRef.current = null;
      }
      if (highlightAnimationFrameRef.current !== null) {
        cancelAnimationFrame(highlightAnimationFrameRef.current);
        highlightAnimationFrameRef.current = null;
      }
      resizeObserver.disconnect();
      document.removeEventListener('focusin', handleFocusChange, true);
      document.removeEventListener('focusout', handleFocusChange, true);
      document.removeEventListener('selectionchange', scheduleSelectionHighlightUpdate);
      view.scrollDOM.removeEventListener('scroll', handleScroll);
      view.scrollDOM.removeEventListener('wheel', handleWheel);
      view.scrollDOM.removeEventListener('keyup', handlePageKeyUp, true);
      document.removeEventListener('pointerdown', handlePointerDown, true);
      document.removeEventListener('mousedown', handleMouseDown, true);
      view.scrollDOM.removeEventListener('scroll', handleSelectionDragScrollQuantization);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('mouseup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerCancel);
      window.removeEventListener('blur', handleWindowBlur);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      clearPageContinuousHandoff();
      stopPageContinuousScroll();
      endPointerDragSelection();
      bindingsRef.current?.onLifecycle?.({ phase: 'destroyed' });
      view.destroy();
      viewRef.current = null;
    };
    // Deliberately mount-once: noteId/initialText changes are handled by the
    // hydration effect below (matching NoteTextHydrationPlugin's own
    // "patch, don't remount" discipline), not by tearing this effect down.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Note-switch hydration: replace the whole document when noteId changes.
  // Slice-1 simplification -- NOT yet the prefix/suffix patch
  // NoteTextHydrationPlugin does, since CM6's own Text.replace() already
  // avoids that function's entire reason for existing (see the Phase 1
  // audit: structural sharing means this is cheap without manual diffing).
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    // toJSON().join('\n') instead of toString() -- same fix, same reason as
    // the updateListener's own text production above: this effect is keyed
    // on `initialText`, which changes every keystroke (mirrors
    // NoteTextHydrationPlugin.tsx's own hydration-check effect on the
    // Lexical side), so toString()'s ConsString-then-flatten-on-compare
    // cost would otherwise be paid here too, every keystroke.
    if (lastHydratedNoteIdRef.current === (noteId ?? null) && view.state.doc.toJSON().join('\n') === initialText) return;
    lastHydratedNoteIdRef.current = noteId ?? null;

    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: initialText },
      selection: EditorSelection.cursor(0),
    });
    previousTextRef.current = initialText;
  }, [noteId, initialText]);

  // Boundary drag-handle global listeners -- ported from Editor.tsx's own
  // "Global Mouse listeners for Dragging" effect. Deliberately re-binds only
  // on drag start/stop, not on every intra-drag boundary update (those fire
  // on every mousemove via the setState calls below; re-running this effect
  // per pixel would tear down and re-attach the window listeners at 60fps).
  const emitUserViewportChange = useCallback((nextTopBoundaryLines: number, nextBottomBoundaryLines: number) => {
    const view = viewRef.current;
    if (!view || !bindingsRef.current) return;
    const scroller = view.scrollDOM;
    const viewport: EditorViewportState = {
      topBoundaryPx: Math.max(0, nextTopBoundaryLines) * lineHeightPxRef.current,
      bottomBoundaryPx: Math.max(0, nextBottomBoundaryLines) * lineHeightPxRef.current,
      scrollTopPx: scroller.scrollTop,
      lineHeightPx: lineHeightPxRef.current,
      cellWidthPx: cellWidthPxRef.current,
      scrollHeightPx: scroller.scrollHeight,
      clientHeightPx: scroller.clientHeight,
    };
    bindingsRef.current.onViewportChange?.({ source: 'user-input', origin: 'viewport-drag', viewport });
  }, []);

  useEffect(() => {
    if (!isDraggingTop && !isDraggingBottom) return;

    const handleMouseMove = (event: MouseEvent) => {
      const view = viewRef.current;
      if (!view) return;
      const rect = view.scrollDOM.getBoundingClientRect();
      const h = Math.max(0, view.scrollDOM.clientHeight);
      const relativeY = event.clientY - rect.top;
      const clampedY = Math.max(0, Math.min(relativeY, h));
      const dragLines = Math.max(0, Math.round(clampedY / lineHeightPxRef.current));

      if (isDraggingTop) {
        // The dragged value is the stored value going forward: "the current
        // distance to the edge becomes the new value" (per spec). Display
        // clamping (clampBoundaryLines) reconciles this against the bottom
        // boundary and available space on every render -- no cross-boundary
        // adjustment is needed here.
        setTopBoundaryLines(dragLines);
        emitUserViewportChange(dragLines, bottomBoundaryLines);
      } else if (isDraggingBottom) {
        const availableLines = Math.max(0, Math.round(h / lineHeightPxRef.current));
        const bottomLines = Math.max(0, availableLines - dragLines);
        setBottomBoundaryLines(bottomLines);
        emitUserViewportChange(topBoundaryLines, bottomLines);
      }
    };

    const handleMouseUp = () => {
      setIsDraggingTop(false);
      setIsDraggingBottom(false);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
    // topBoundaryLines/bottomBoundaryLines/emitUserViewportChange are read
    // fresh at the start of each drag gesture (accurate for the whole
    // gesture, since the untouched boundary doesn't change mid-drag) --
    // deliberately not deps, matching Editor.tsx's own reasoning.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDraggingTop, isDraggingBottom]);

  // Lets the boundary drag-handle strips (which visually sit on top of the
  // scroller) still scroll the editor on wheel, instead of the wheel event
  // being swallowed by a pointer-events target with no scroll of its own --
  // ported verbatim from Editor.tsx's own forwardHandleWheelToScroller.
  const forwardHandleWheelToScroller = (event: React.WheelEvent<HTMLDivElement>) => {
    const scroller = viewRef.current?.scrollDOM;
    if (!scroller) return;
    if (event.cancelable) {
      event.preventDefault();
    }
    const forwardedWheelEvent = new WheelEvent('wheel', {
      deltaX: event.deltaX,
      deltaY: event.deltaY,
      deltaZ: event.deltaZ,
      deltaMode: event.deltaMode,
      clientX: event.clientX,
      clientY: event.clientY,
      ctrlKey: event.ctrlKey,
      shiftKey: event.shiftKey,
      altKey: event.altKey,
      metaKey: event.metaKey,
      bubbles: true,
      cancelable: true,
    });
    scroller.dispatchEvent(forwardedWheelEvent);
  };

  // Custom scrollbar interactivity -- ported from Editor.tsx's own thumb
  // drag, track click-to-jump, and track right-click-hold-to-page handlers.
  useEffect(() => {
    if (!isDraggingScrollThumb) return;

    const handleMouseMove = (event: MouseEvent) => {
      const origin = scrollThumbDragOriginRef.current;
      if (!origin) return;
      const deltaY = event.clientY - origin.pointerY;
      scrollFromThumbTop(origin.thumbTopPx + deltaY);
    };

    const handleMouseUp = () => {
      setIsDraggingScrollThumb(false);
      scrollThumbDragOriginRef.current = null;
      requestAnimationFrame(() => syncCustomScrollbar({ force: true }));
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDraggingScrollThumb, scrollFromThumbTop, syncCustomScrollbar]);

  // Right-click-and-hold on the track pages in the clicked direction for as
  // long as the button is held, exactly like holding PageUp/PageDown -- it's
  // dispatched as a real synthetic KeyboardEvent so it reuses this file's
  // own PageUp/PageDown paging logic (the Prec.highest keymap above)
  // verbatim rather than duplicating that curve/timing math here. Dispatched
  // at view.contentDOM specifically, NOT view.scrollDOM: CM6's own keymap
  // system attaches its native keydown listener to contentDOM, and a
  // dispatched event only reaches listeners on its own target element or
  // ancestors it bubbles to -- contentDOM is a DESCENDANT of scrollDOM, so
  // dispatching on scrollDOM would never reach it. (Editor.tsx's own
  // equivalent dispatches on the scroller because CagedScrollPlugin's own
  // PageUp/PageDown handling is registered directly on that same scroller
  // element, not on a descendant -- a real, load-bearing difference between
  // the two editors' DOM/listener shapes, not an inconsistency to "fix".)
  const stopScrollbarRightHold = useCallback(() => {
    const hold = scrollbarRightHoldRef.current;
    if (!hold) return;
    if (hold.rafId !== null) {
      cancelAnimationFrame(hold.rafId);
    }
    scrollbarRightHoldRef.current = null;
    viewRef.current?.contentDOM.dispatchEvent(
      new KeyboardEvent('keyup', { key: hold.key, code: hold.key, bubbles: true, cancelable: true }),
    );
  }, []);

  useEffect(() => {
    const handleWindowMouseUp = (event: MouseEvent) => {
      if (event.button === 2) stopScrollbarRightHold();
    };
    const handleWindowMouseMove = (event: MouseEvent) => {
      const hold = scrollbarRightHoldRef.current;
      const track = scrollbarTrackRef.current;
      if (!hold || !track) return;
      hold.cursorYPx = event.clientY - track.getBoundingClientRect().top;
    };
    window.addEventListener('mouseup', handleWindowMouseUp);
    window.addEventListener('mousemove', handleWindowMouseMove);
    return () => {
      window.removeEventListener('mouseup', handleWindowMouseUp);
      window.removeEventListener('mousemove', handleWindowMouseMove);
    };
  }, [stopScrollbarRightHold]);

  useEffect(() => stopScrollbarRightHold, [stopScrollbarRightHold]);

  const handleTrackRightMouseDown = (event: React.MouseEvent<HTMLDivElement>) => {
    const track = scrollbarTrackRef.current;
    const view = viewRef.current;
    if (!track || !view) return;

    stopScrollbarRightHold();

    const clickY = event.clientY - track.getBoundingClientRect().top;
    const thumbTop = scrollThumbTopPx;
    const thumbBottom = scrollThumbTopPx + scrollThumbHeightPx;
    if (clickY >= thumbTop && clickY <= thumbBottom) return;

    const direction: 1 | -1 = clickY > thumbBottom ? 1 : -1;
    const key: 'PageUp' | 'PageDown' = direction === 1 ? 'PageDown' : 'PageUp';

    view.contentDOM.dispatchEvent(
      new KeyboardEvent('keydown', { key, code: key, bubbles: true, cancelable: true, repeat: false }),
    );

    scrollbarRightHoldRef.current = { key, direction, cursorYPx: clickY, rafId: null };

    const watchThumbReachesCursor = () => {
      const hold = scrollbarRightHoldRef.current;
      if (!hold) return;
      const geometry = readScrollbarGeometry();
      if (geometry && viewRef.current) {
        const scrollRatio = geometry.maxScrollTopPx > 0
          ? viewRef.current.scrollDOM.scrollTop / geometry.maxScrollTopPx
          : 0;
        const currentThumbTop = SCROLL_TRACK_EDGE_GAP_PX + (geometry.maxThumbTravelPx * scrollRatio);
        const currentThumbBottom = currentThumbTop + geometry.thumbHeightPx;
        const reachedCursor = hold.direction === 1
          ? currentThumbBottom >= hold.cursorYPx
          : currentThumbTop <= hold.cursorYPx;
        if (reachedCursor) {
          stopScrollbarRightHold();
          return;
        }
      }
      hold.rafId = requestAnimationFrame(watchThumbReachesCursor);
    };
    scrollbarRightHoldRef.current.rafId = requestAnimationFrame(watchThumbReachesCursor);
  };

  const handleTrackMouseDown = (event: React.MouseEvent<HTMLDivElement>) => {
    if (event.button === 2) {
      handleTrackRightMouseDown(event);
      return;
    }
    if (event.button !== 0) return;

    const track = scrollbarTrackRef.current;
    const view = viewRef.current;
    if (!track || !view) return;

    const rect = track.getBoundingClientRect();
    const clickY = event.clientY - rect.top;
    const geometry = readScrollbarGeometry();
    if (!geometry) return;

    const targetThumbTop = clickY - (geometry.thumbHeightPx / 2);
    const maxThumbTravel = geometry.maxThumbTravelPx;
    const minThumbTop = SCROLL_TRACK_EDGE_GAP_PX;
    const maxThumbTop = SCROLL_TRACK_EDGE_GAP_PX + maxThumbTravel;
    const clampedTop = Math.max(minThumbTop, Math.min(targetThumbTop, maxThumbTop));
    const maxScrollTop = geometry.maxScrollTopPx;
    const ratio = maxThumbTravel > 0 ? (clampedTop - SCROLL_TRACK_EDGE_GAP_PX) / maxThumbTravel : 0;
    const targetScrollTop = ratio * maxScrollTop;

    scrollToQuantizedSmooth(view.scrollDOM, targetScrollTop, {
      lineHeightPx: lineHeightPxRef.current,
      onStep: syncCustomScrollbar,
    });
  };

  const handleTrackContextMenu = (event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
  };

  const handleThumbMouseDown = (event: React.MouseEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const scroller = viewRef.current?.scrollDOM;
    if (scroller) {
      cancelQuantizedSmoothScroll(scroller);
    }
    setIsDraggingScrollThumb(true);
    scrollThumbDragOriginRef.current = {
      pointerY: event.clientY,
      thumbTopPx: scrollThumbTopPx,
    };
  };

  useEffect(() => {
    if (!adapterRef) return;

    adapterRef.current = {
      getCapabilities() {
        return {
          textEvents: true,
          selectionEvents: true,
          viewportEvents: true,
          snapshotRead: true,
          // Still not `true`: snapshotWriteText is false (text restore is via
          // the noteId/initialText prop + hydration effect, not applySnapshot,
          // matching Editor.tsx's own architecture) -- snapshotWrite requires
          // all three.
          snapshotWrite: false,
          snapshotWriteText: false,
          snapshotWriteSelection: true,
          snapshotWriteViewport: true,
        };
      },
      getSnapshot(): EditorSnapshot | null {
        const view = viewRef.current;
        if (!view) return null;
        const viewportLines: EditorViewportLines = {
          topBoundaryLines,
          bottomBoundaryLines,
          scrollTopLines: Math.round(view.scrollDOM.scrollTop / lineHeightPxRef.current),
        };
        return {
          text: view.state.doc.toString(),
          selection: toSelectionState(view.state.selection.main),
          viewport: buildViewport(view),
          viewportLines,
        };
      },
      applySnapshot(snapshot: EditorSnapshotApplyRequest) {
        const view = viewRef.current;
        if (!view) return;

        // Same isSnapshotRestorePending bracketing as Editor.tsx's own
        // applySnapshot: suppress caret/selection-highlight rendering for
        // the one rAF between this call and its own settle, so a restored
        // caret never flashes at a stale position before the viewport/
        // selection below actually lands.
        const isSnapshotRestore = Boolean(snapshot.viewport || snapshot.viewportLines || snapshot.selection);
        if (isSnapshotRestore) {
          if (snapshotRestoreRafRef.current !== null) {
            cancelAnimationFrame(snapshotRestoreRafRef.current);
          }
          setIsSnapshotRestorePending(true);
        }

        if (snapshot.viewport) {
          const h = Math.max(0, view.scrollDOM.clientHeight);
          const quantizedViewportHeight = quantizeViewportHeightToGrid(h, lineHeightPxRef.current);
          const nextViewport = snapshot.viewport;

          const nextTopBoundary = typeof nextViewport.topBoundaryPx === 'number'
            ? Math.max(0, Math.round(nextViewport.topBoundaryPx / lineHeightPxRef.current) * lineHeightPxRef.current)
            : topBoundaryPxRef.current;
          const nextBottomBoundary = typeof nextViewport.bottomBoundaryPx === 'number'
            ? Math.min(Math.max(0, Math.round(nextViewport.bottomBoundaryPx / lineHeightPxRef.current) * lineHeightPxRef.current), quantizedViewportHeight)
            : bottomBoundaryPxRef.current;

          const normalized = normalizeEditorBoundaryPair({
            topBoundaryPx: nextTopBoundary,
            bottomBoundaryPx: nextBottomBoundary,
            lineHeightPx: lineHeightPxRef.current,
            viewportHeightPx: h,
            preserve: typeof nextViewport.bottomBoundaryPx === 'number' ? 'bottom' : 'top',
          });

          if (typeof nextViewport.topBoundaryPx === 'number') {
            setTopBoundaryLines(Math.round(normalized.topBoundaryPx / lineHeightPxRef.current));
          }
          if (typeof nextViewport.bottomBoundaryPx === 'number') {
            setBottomBoundaryLines(Math.round(normalized.bottomBoundaryPx / lineHeightPxRef.current));
          }
          if (typeof nextViewport.scrollTopPx === 'number') {
            view.scrollDOM.scrollTo({ top: Math.max(0, nextViewport.scrollTopPx), behavior: 'auto' });
          }
        }

        // Line-count-based restore is the preferred path (see
        // EditorViewportLines's own doc comment in EditorContract.ts): no
        // clamping against the current container size at apply time, since
        // display values are derived lazily via clampBoundaryLines on every
        // render regardless of when this runs.
        if (snapshot.viewportLines) {
          setTopBoundaryLines(Math.max(0, Math.round(snapshot.viewportLines.topBoundaryLines)));
          setBottomBoundaryLines(Math.max(0, Math.round(snapshot.viewportLines.bottomBoundaryLines)));
          view.scrollDOM.scrollTo({
            top: Math.max(0, Math.round(snapshot.viewportLines.scrollTopLines) * lineHeightPxRef.current),
            behavior: 'auto',
          });
          setHasViewportLines(true);
        }

        if (snapshot.selection) {
          const docLength = view.state.doc.length;
          const anchor = Math.max(0, Math.min(docLength, snapshot.selection.anchor));
          const focus = Math.max(0, Math.min(docLength, snapshot.selection.focus));
          view.dispatch({ selection: EditorSelection.single(anchor, focus) });
        }

        if (isSnapshotRestore) {
          if (snapshotRestoreRafRef.current !== null) {
            cancelAnimationFrame(snapshotRestoreRafRef.current);
          }
          snapshotRestoreRafRef.current = requestAnimationFrame(() => {
            snapshotRestoreRafRef.current = null;
            setIsSnapshotRestorePending(false);
          });
        }
      },
    };

    return () => {
      if (adapterRef.current) {
        adapterRef.current = null;
      }
    };
    // lineHeightPx/cellWidthPx read via refs (kept current by the effect
    // above), not closed over directly, so they're deliberately not deps.
    // topBoundaryLines/bottomBoundaryLines ARE closed over directly (in
    // getSnapshot), so they must be deps or getSnapshot would report stale
    // values after a boundary drag.
  }, [adapterRef, topBoundaryLines, bottomBoundaryLines]);

  // Drag-handle geometry: a full lineHeightPx-tall strip flush against the
  // boundary line once one exists, but only a small fixed-height sliver at
  // the very edge when there's no boundary yet (topBoundaryPxDisplay/
  // bottomBoundaryPxDisplay < one row). A full-row handle at a 0 boundary
  // would sit exactly on top of the document's first/last text row --
  // confirmed live to steal mousedown from ordinary text drag-selection
  // there (verifyCM6Phase2Slice10.mjs's own drag-select regression-caught
  // this). Editor.tsx doesn't have this problem: its equivalent handle has
  // a few pixels of --editor-frame-padding headroom above the text, which
  // CM6Editor's layer (no such padding) doesn't have -- this sliver is the
  // substitute.
  const boundaryHandleSliverPx = Math.min(lineHeightPx, 8);
  const topHandleTopPx = topBoundaryPxDisplay >= lineHeightPx ? topBoundaryPxDisplay - lineHeightPx : 0;
  const topHandleHeightPx = topBoundaryPxDisplay >= lineHeightPx ? lineHeightPx : boundaryHandleSliverPx;
  const bottomHandleBottomPx = bottomBoundaryPxDisplay >= lineHeightPx ? bottomBoundaryPxDisplay - lineHeightPx : 0;
  const bottomHandleHeightPx = bottomBoundaryPxDisplay >= lineHeightPx ? lineHeightPx : boundaryHandleSliverPx;

  // The custom scrollbar rail -- ported from Editor.tsx verbatim (same
  // classes, same CSS in index.css). Rendered via a portal into
  // scrollbarHost rather than inline here, matching Editor.tsx exactly: the
  // rail lives in a dedicated layout slot (--editor-scrollbar-slot-width)
  // outside the editor pane itself, not inside this component's own tree.
  const scrollbarRail = (
    <div className="thockdown-scroll-rail">
      <div
        ref={scrollbarTrackRef}
        className="thockdown-scroll-track"
        onMouseDown={handleTrackMouseDown}
        onContextMenu={handleTrackContextMenu}
      >
        <div
          className={`thockdown-scroll-thumb${isDraggingScrollThumb ? ' is-dragging' : ''}${isScrollThumbActive ? '' : ' is-inactive'}`}
          style={{
            top: `${scrollThumbTopPx}px`,
            height: `${Math.max(0, scrollThumbHeightPx)}px`,
          }}
          onMouseDown={handleThumbMouseDown}
        />
      </div>
    </div>
  );

  const editorLayer = (
    // layerRef is the non-scrolling reference frame the block caret is
    // positioned against -- matching Editor.tsx's own structure, where
    // BlockCaretPlugin renders as a sibling of the scroller inside a shared
    // non-scrolling parent, not inside the scrolling element itself.
    <div
      ref={layerRef}
      style={{
        position: 'absolute',
        inset: 0,
        overflow: 'hidden',
        cursor: (isDraggingTop || isDraggingBottom) ? 'ns-resize' : 'auto',
        // The SOURCE OF TRUTH for .editor-text's grid-alignment CSS (the
        // letter-spacing + translateX trick in index.css that pads/centers
        // each glyph to exactly cellWidthPx, and the font-family/size/
        // line-height .editor-text itself reads via var()) -- ported from
        // Editor.tsx's own "Editor Container Base" div, which sets these
        // same five custom properties. Found live, not assumed: CM6Editor
        // previously set fontFamily/fontSize/lineHeight as plain inline
        // style on the .cm6-editor-root div below, which does nothing for
        // actual text rendering -- .editor-text's own CSS rule (an
        // explicit rule on .cm-content itself, not an inherited value from
        // an ancestor) always wins over inheritance regardless of what the
        // ancestor sets. Without these vars, .cm-content silently fell back
        // to :root's hardcoded defaults (10px cell width, 8px glyph width)
        // instead of the real measured runtime metrics from props --
        // invisible only by coincidence whenever those happened to match,
        // and a real text/grid misalignment bug the moment they didn't.
        ...({
          '--editor-font': fontFamily,
          '--editor-font-size': `${fontSizePx}px`,
          '--editor-line-height': `${lineHeightPx}px`,
          '--editor-glyph-width': `${glyphWidthPx}px`,
          '--editor-cell-width': `${cellWidthPx}px`,
        } as React.CSSProperties),
      }}
    >
      <div
        ref={containerRef}
        className="cm6-editor-root"
        style={{
          position: 'absolute',
          inset: 0,
          // No overflow of its own -- the EditorView.theme() above makes
          // .cm-editor fill this container, so .cm-scroller (a child of
          // .cm-editor) is the one real scrolling element, per CM6's own
          // integration contract. This container previously had its own
          // `overflow: auto`, which was silently doing the real scrolling
          // instead of CM6's own scroller ever since slice 1 -- see the
          // EditorView.theme() comment above for how this was found.
          overflow: 'hidden',
          // Matches Editor.tsx's own scroller (className "z-10"): above the
          // boundary zones (z2), selection highlight (z4), caret (z5), AND
          // the grid lines (z6/z7) below -- so text paints over the grid
          // instead of the grid's box-border lines clipping into glyph ink,
          // while the grid lines themselves still paint over caret/selection
          // (z4/z5, both below z6/z7) so a cell's own border stays visible
          // through those fills.
          zIndex: 10,
          // Hide content until the restored line counts have been applied
          // (hasViewportLines) and the font has finished loading (fontReady)
          // -- same reasoning as Editor.tsx's own ContentEditable visibility
          // toggle. The element stays mounted (CM6's EditorView keeps running
          // underneath) but isn't visible, so there's no "wrong frame, then
          // corrected" flash.
          visibility: hasViewportLines && fontReady ? 'visible' : 'hidden',
        }}
      />
      {/* Empty-note placeholder -- Editor.tsx's RichTextPlugin shows/hides
          this automatically based on Lexical's own root-empty check; CM6 has
          no built-in equivalent, so isDocEmpty tracks it explicitly (see its
          own declaration above). Positioned to match the real content's own
          padding (topBoundaryPxDisplay + halfLineHeightPx, halfCellWidthPx)
          so the text lines up with the grid exactly like typed text would;
          zIndex matches the content layer so it paints over the grid/
          boundary zones the same way real glyphs do. */}
      {hasViewportLines && fontReady && isDocEmpty && (
        <div
          className="absolute pointer-events-none select-none editor-text"
          style={{ top: topBoundaryPxDisplay + halfLineHeightPx, left: halfCellWidthPx, zIndex: 10 }}
        >
          Jot down a thockdown note...
        </div>
      )}
      {/* The box grid -- ported from Editor.tsx verbatim (same classes, same
          CSS in index.css, now correctly keyed off the real --editor-cell-
          width/--editor-line-height vars set on the layer above). inset is
          '0 0 -1px 0' rather than Editor.tsx's frame-padding-based inset:
          CM6Editor's layer has no frame-padding gap (see the layer's own
          style comment), so the equivalent of "inset by frame-padding on
          three sides, frame-padding-1px on the bottom" is simply "inset 0,
          -1px on the bottom" -- the -1px is index.css's own "FLUSH ALIGNMENT"
          fix so grid lines land exactly on row boundaries, kept unchanged.
          backgroundPosition overrides index.css's static 0/-1px default to
          phase-shift the pattern by the same half-cell amount as the text's
          own paddingLeft/paddingTop above, so the grid moves in lockstep
          with the content it's meant to line up with -- an "infinity grid"
          that starts half a cell past the container's top-left edge, cut-off
          boxes at the far edges expected and fine. Gated on hasViewportLines/
          fontReady same as Editor.tsx's own grid lines -- their pitch isn't
          final until then, and rendering early would show a wrong-pitch grid
          that then jumps once metrics settle. */}
      {hasViewportLines && fontReady && (
        <>
          <div
            className="absolute pointer-events-none thockdown-grid-outline-lines"
            style={{ inset: '0 0 -1px 0', zIndex: 6, backgroundPosition: `${halfCellWidthPx - 1}px ${halfLineHeightPx - 1}px` }}
          />
          <div
            className="absolute pointer-events-none thockdown-grid-lines"
            style={{ inset: '0 0 -1px 0', zIndex: 7, backgroundPosition: `${halfCellWidthPx}px ${halfLineHeightPx}px` }}
          />
        </>
      )}
      {/* Fixed-focus caging boundary zones -- ported from Editor.tsx's own
          background-zone divs. Adjacent, not overlapping, in the well-behaved
          case (topBoundary/bottomBoundary are already clamped so they never
          sum past the available height), so DOM/z-index order doesn't matter
          in practice -- kept in the same order as the original regardless.
          Gated the same way Editor.tsx gates its own equivalent divs: these
          depend on topBoundary/bottomBoundary, which are 0/0 until a real
          viewportLines snapshot has landed. */}
      {hasViewportLines && fontReady && (
        <>
          <div
            className="absolute pointer-events-none"
            style={{
              top: topBoundaryPxDisplay,
              bottom: bottomBoundaryPxDisplay,
              left: 0,
              right: 0,
              backgroundColor: 'var(--color-bg-regular)',
              zIndex: 2,
            }}
          />
          <div
            className="absolute left-0 right-0 pointer-events-none"
            style={{ top: 0, height: topBoundaryPxDisplay, backgroundColor: 'var(--color-bg-leading)', zIndex: 2 }}
          />
          <div
            className="absolute left-0 right-0 pointer-events-none"
            style={{ bottom: 0, height: bottomBoundaryPxDisplay, backgroundColor: 'var(--color-bg-trailing)', zIndex: 2 }}
          />
          <div
            className="absolute left-0 right-0 z-20 bg-transparent cursor-ns-resize"
            style={{ top: topHandleTopPx, height: topHandleHeightPx }}
            onWheel={forwardHandleWheelToScroller}
            onMouseDown={(e) => { e.preventDefault(); setIsDraggingTop(true); }}
          />
          <div
            className="absolute left-0 right-0 z-20 bg-transparent cursor-ns-resize"
            style={{ bottom: bottomHandleBottomPx, height: bottomHandleHeightPx }}
            onWheel={forwardHandleWheelToScroller}
            onMouseDown={(e) => { e.preventDefault(); setIsDraggingBottom(true); }}
          />
        </>
      )}
      {hasViewportLines && fontReady && !caretHidden && highlightRects.map((rect, index) => (
        <div
          key={index}
          className="thockdown-block-selection"
          style={{
            position: 'absolute',
            pointerEvents: 'none',
            zIndex: 4,
            top: rect.top,
            left: rect.left,
            width: rect.width,
            height: rect.height,
          }}
        />
      ))}
      {hasViewportLines && fontReady && !caretHidden && caretStyle && (
        <div
          className="thockdown-block-caret"
          style={{
            position: 'absolute',
            pointerEvents: 'none',
            zIndex: 5,
            top: 0,
            left: 0,
            willChange: 'transform',
            ...caretStyle,
          }}
        />
      )}
    </div>
  );

  return (
    <>
      {editorLayer}
      {scrollbarHost ? createPortal(scrollbarRail, scrollbarHost) : null}
    </>
  );
}
