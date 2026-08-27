import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Annotation, Compartment, EditorState, EditorSelection, Prec, RangeSetBuilder } from '@codemirror/state';
import type { Extension } from '@codemirror/state';
import { EditorView, Decoration, ViewPlugin, keymap, type DecorationSet } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { buildTokenPresentation } from '../editor/MarkdownLineClassification';
import { suppressNextPlainTypingSoundOnce, typingSoundManager } from '../sound/TypingSoundManager';
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
import { resolveScopeRange, isSameRange, type SelectionScope } from '../editor/ContractBridgeRangeUtils';
import { computeMinimalTextReplacement } from '../editor/MinimalTextDiff';
import { ScrollTransitionController } from '../editor/ScrollTransitionController';
import type { ReviewFlagEntry, ReviewFlagRemap, ReviewFlagSeverity } from '../shared/reviewFlags';
import { hashLineText, reviewFlagSeverityRank } from '../shared/reviewFlags';
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
import { resolveGlyphWidthPx } from '../editor/EditorTypography';

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
  // Whether this editor's own split-view section is the currently active
  // one -- see navigateToFlaggedLine's own doc comment for why the
  // flag-jump controls need this (a click on a still-inactive section's
  // jump arrow has to activate the section and wait for that to land
  // before it's safe to jump).
  isSectionActive?: boolean;
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
  // Per-editor-slot toggles (owned by app state, not this component -- see
  // useReviewGutterVisibility.ts) for the two gutter columns, independently
  // switchable (left click on the toggle button flips both together, right
  // click flips showReviewFlags alone -- see SectionEditorArea's toggle
  // button). Flags themselves are always loaded/tracked/persisted regardless
  // of either flag's value -- toggling only shows/hides the columns; see
  // docs/editor-contract.md-adjacent reasoning in the gutter section below.
  showLineNumbers?: boolean;
  showReviewFlags?: boolean;
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

// Tags the note-switch hydration effect's own dispatches (full-document
// replace on a genuine note switch, or the same-note transient-mismatch
// correction) so the shared updateListener below can tell them apart from a
// real keystroke -- both are programmatic, neither is something the user
// typed. Without this, every note switch's hydration dispatch was
// indistinguishable from a real edit (still a genuine `docChanged`
// transaction even though the *content* happens to be a full replace), so
// onTextChange reported it as `source: 'user-input'`, which queued a save
// and bumped the note's `updatedAt` -- pushing it to the top of the
// updatedAt-sorted "latest" view just from being opened, never mind actually
// edited.
const ProgrammaticHydrationAnnotation = Annotation.define<true>();

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
 * onEnterTransform/onMarkdownShortcutTransform/onCharacterInsertTransform/
 * onCaretClickTransform) only ever changes a small localized region -- a full-document replace on
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

/**
 * CM6-native replacement for CaretVisualPosition.ts's resolveCaretTopInScroll
 * (written for Lexical, still used as-is by Editor.tsx/BlockCaretPlugin.tsx/
 * CagedScrollPlugin.tsx, which have a different, already-cheap rawText
 * source and don't share this defect -- kept CM6-local rather than changed
 * in those shared files).
 *
 * The Lexical version needs the full canonical text string because Lexical
 * selection offsets are DOM-derived. CM6's own EditorState already carries
 * both facts any such check would need as O(1) values -- total document
 * length (view.state.doc.length) and whether the caret sits at that length
 * (view.state.selection.main) -- so this never needs view.state.doc.toString()
 * (an O(document length) allocation) at all. This was previously the single
 * highest-frequency O(document length) call in this file, hit on every caret
 * update (i.e. essentially every keystroke, scroll tick, and selection
 * change via scheduleCaretUpdate's rAF), every keyboard-refocus-caging
 * reconcile, and every paste.
 *
 * Deliberately does NOT port CaretTerminalOffset.ts's
 * getTerminalTrailingVisualOffsetPx (a "+1 row per extra trailing newline"
 * compensation for fallback-sourced caret rects at document end): that
 * compensates for a Lexical-specific quirk where consecutive trailing empty
 * paragraphs' DOM rects undercount by one row apiece. CM6 has no such
 * quirk -- every blank line, including trailing ones, gets its own
 * independently-positioned `.cm-line` div, so the anchor-fallback rect
 * (readSelectionRect's last-resort path, which is what fires here: a
 * collapsed caret on a trailing blank line has a zero-size primary rect, an
 * empty getClientRects() list, and no adjacent sibling content to probe)
 * already lands on the correct row with no adjustment needed. An earlier
 * version of this function ported the Lexical compensation verbatim without
 * re-deriving it for CM6's different DOM shape; confirmed live as a caret
 * misplacement bug scaling exactly 1 row of overshoot per extra trailing
 * Enter at document end (e.g. two Enters on a fresh document landed the
 * caret visually on line 4 instead of line 3 -- the underlying text model
 * and the eventual re-sync on the next keystroke were both always correct,
 * only this stale double-counted offset was wrong).
 */
function resolveCM6CaretTopInScroll(
  caretRect: SelectionRect,
  scrollerRectTop: number,
  scrollerScrollTop: number,
): number {
  return (caretRect.top - scrollerRectTop) + scrollerScrollTop;
}

const CARET_INSET_PX = 1;
const EMPTY_LINE_TOP_TOLERANCE_PX = 2;
const EDITOR_PAGE_CONTINUOUS_SCROLL_APEX_MULTIPLIER = CONTINUOUS_SCROLL_APEX_SPEED_MULTIPLIER;

/**
 * Alt-ArrowLeft/Right is reserved app-wide for switching editor sections
 * (App.tsx's onKeyDown) -- @codemirror/commands' own defaultKeymap binds
 * plain Alt-ArrowLeft/Right to cursorSyntaxLeft/cursorSyntaxRight on
 * Windows/Linux, and separately aliases the *same* keys to cursorGroupLeft/
 * cursorGroupRight (word-jump) on macOS via Mod-ArrowLeft/Right's own `mac`
 * override -- either would silently consume the keystroke for caret
 * movement instead of letting it bubble up to the section switcher, the
 * exact interference this app-level rebind (from Ctrl/Cmd-Arrow) exists to
 * get away from. Stripped here rather than shadowed in the Prec.highest
 * keymap below: CM6's own dispatch always calls preventDefault the moment
 * *any* binding at *any* precedence tier claims a key, so there's no way to
 * "claim it to block a lower tier" without also eating the keystroke --
 * the only way to let it reach `window` untouched is for no CM6 binding to
 * exist for it at all. `mac: undefined` on the Mod-ArrowLeft/Right entries
 * is equivalent to omitting the field (CM6 falls back to `b.key` either
 * way), so Cmd-ArrowLeft/Right still does word-jump on macOS -- only the
 * Alt-ArrowLeft/Right alias to it is removed. Losing Alt-ArrowLeft/Right's
 * syntax-jump (and its own `mac: "Ctrl-ArrowLeft/Right"` alias) outright is
 * an accepted trade: a rarely-reached-for command editor feature, not
 * something this markdown app leans on.
 */
const CM6_DEFAULT_KEYMAP_WITHOUT_ALT_ARROW = defaultKeymap
  .filter((binding) => binding.key !== 'Alt-ArrowLeft' && binding.key !== 'Alt-ArrowRight')
  .map((binding) => (
    binding.mac === 'Alt-ArrowLeft' || binding.mac === 'Alt-ArrowRight'
      ? { ...binding, mac: undefined }
      : binding
  ));

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

/**
 * The review gutter's flag-column width: one real grid box plus whatever's
 * cut off past it (see reviewGutterRightPx's own render-scope doc comment
 * for why -- the grid's box columns are phase-anchored from the left only,
 * never corrected against the right edge). Factored out as a pure function,
 * not just inlined at render time, so the resize-observer callback below
 * can call this SAME formula synchronously the instant it measures a new
 * scroller width -- applying view.contentDOM.style.paddingRight there
 * directly, rather than only through the render-driven padding effect,
 * closes the one-frame window where the browser has already reflowed the
 * pane to its new width but React hasn't re-rendered with the corrected
 * padding yet: CM6 wraps text against the stale width for that frame, then
 * snaps to the correct wrap the moment React catches up -- the reported
 * "characters jitter, calculate a wrap, then revert" during a live resize.
 */
const computeReviewGutterRightPx = (measuredWidthPx: number, cellWidthPx: number, gutterOn: boolean): number => {
  if (!gutterOn || cellWidthPx <= 0) return 0;
  const halfCellWidthPxNow = Math.round(cellWidthPx / 2);
  const remainderPx = (((measuredWidthPx - halfCellWidthPxNow) % cellWidthPx) + cellWidthPx) % cellWidthPx;
  return cellWidthPx + remainderPx;
};

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

// One entry per document line currently in the viewport, for the review
// gutter (see updateLineLayout). heightPx spans the line's full wrapped
// height (all its visual rows) -- CM6's own view.viewportLineBlocks already
// reports one block per document line under lineWrapping, covering every
// wrapped row, so this needs no separate visual-row bookkeeping.
interface LineLayoutRow {
  line: number;
  topPx: number;
  heightPx: number;
}

// The review gutter's static top/bottom "jump arrow" box slots -- see
// updateLineLayout's own doc comment on why these are resolved via
// view.lineBlockAtHeight against fixed, editor-height-derived pixel
// positions rather than read off whichever rows happen to be rendered.
interface ReviewGutterEdgeLines {
  topLine: number;
  bottomLine: number;
  topBoxTopPx: number;
  bottomBoxTopPx: number;
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
  isSectionActive = true,
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
  showLineNumbers = false,
  showReviewFlags = false,
}: CM6EditorProps) {
  const layerRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  // Lets editorReadOnly reconfigure live post-mount -- see the effect below
  // that reacts to it. One compartment per component instance (created once,
  // not per-render) so reconfigure() calls target the same slot the mount
  // effect originally installed via `readOnlyCompartmentRef.current.of(...)`.
  const readOnlyCompartmentRef = useRef(new Compartment());
  const spellCheckCompartmentRef = useRef(new Compartment());
  // Bridges reconcileSelectionJumpScroll (defined inside the CM6 mount
  // effect, below) out to the separate adapterRef-assignment effect's
  // applySnapshot, which needs to center a newly-applied selection (search
  // hits, go-to-start/end) in the viewport -- see its use in applySnapshot's
  // `snapshot.selection` handling.
  const reconcileSelectionJumpScrollRef = useRef<((view: EditorView, instant?: boolean, align?: 'center' | 'top') => void) | null>(null);
  // Read by the Ctrl+ArrowUp/Down keymap handler below (registered once at
  // view-construction time), same "stable ref to a closure that's recreated
  // every render" pattern as bindingsRef -- see navigateToFlaggedLine's own
  // doc comment for what it does.
  const navigateToFlaggedLineRef = useRef<((direction: 'up' | 'down') => boolean) | null>(null);
  const scrollTransitionControllerRef = useRef(new ScrollTransitionController());
  const bindingsRef = useRef(bindings);
  const previousTextRef = useRef('');
  const previousSelectionRef = useRef<EditorSelectionState>({ anchor: 0, focus: 0, start: 0, end: 0, isCollapsed: true });
  // Real-usage input-lag diagnostics -- opt-in via
  // localStorage.setItem('thockdown:debug-input-lag', '1') + reload. Logs
  // wall-clock time from a real physical keydown to the resulting CM6
  // update commit, and again to the next painted frame, straight to the
  // console -- for reproducing a lag report live in the actual app instead
  // of a synthetic harness. Zero cost when the flag is unset (one
  // localStorage read at mount, no per-keystroke overhead).
  const debugInputLagEnabled = useRef(
    typeof window !== 'undefined' && window.localStorage.getItem('thockdown:debug-input-lag') === '1',
  ).current;
  const debugLastKeydownAtRef = useRef<number | null>(null);
  const debugLastKeyRef = useRef<string | null>(null);
  // The physical key (KeyboardEvent.code) behind the most recent keydown,
  // for the spatial slider's mode-A (keyboard-position) panning -- see
  // TypingSoundManager's resolveKeyboardPanForCode for why `code` (layout-
  // independent) is used instead of the produced character. Set on every
  // keydown below, read and cleared the moment the resulting docChanged
  // update reaches the shared updateListener further down, so a change with
  // no immediately-preceding keydown (undo/redo, programmatic edits) never
  // inherits a stale code from an unrelated earlier keystroke.
  const lastPhysicalKeyCodeRef = useRef<string | null>(null);
  // TEMP, read-only diagnostic for the Phase-4 arrow-up chunk-boundary drift
  // investigation (docs/cm6-parity-hardening-plan.md lead #4) -- opt-in via
  // localStorage.setItem('thockdown:debug-cage-state', '1'). Exposes a pure
  // accessor (no side effects, changes no behavior) so an external script
  // can pull {analyticalTop, scrollTop, ...} after each keystroke without
  // any console-log-ordering ambiguity. Remove once that investigation
  // closes.
  const debugCageStateEnabled = useRef(
    typeof window !== 'undefined' && window.localStorage.getItem('thockdown:debug-cage-state') === '1',
  ).current;
  // Right-click selection-scope-cycling state -- mirrors ContractBridgePlugin.tsx's
  // (Lexical) rightClickCycleRef exactly, since resolveScopeRange/isSameRange are
  // pure text+offset functions with no Lexical dependency and are reused unchanged
  // here rather than reimplemented. See handleContextMenu below.
  const rightClickCycleRef = useRef<{
    scope: SelectionScope;
    start: number;
    end: number;
    retrySameScope: boolean;
  } | null>(null);
  const lastHydratedNoteIdRef = useRef<string | null>(null);
  // Debug-only counter for the wrap-boundary caret-assoc fix (see
  // wrapBoundaryAssocFixGeneration's own doc comment further down): counts
  // how many times the fix's follow-up dispatch actually ran. The dispatch
  // itself sets assoc briefly, but CM6's own enforceCursorAssoc() only
  // touches the native DOM Selection -- it never writes back to
  // view.state, and a native `selectionchange` it triggers gets observed
  // and re-synced into a fresh CM6 selection (assoc reset to 0, since raw
  // DOM has no assoc concept) almost immediately after. That makes the
  // assoc value itself too fleeting for an external live-browser check to
  // reliably observe, so this counter exists as the one thing outside
  // observers (debug hook, tests) actually can assert on.
  const wrapBoundaryAssocFixDispatchCountRef = useRef(0);
  const lineHeightPxRef = useRef(lineHeightPx);
  const cellWidthPxRef = useRef(cellWidthPx);
  // Mirrors showReviewFlags for the resize-observer callback below, which
  // needs the CURRENT value inside a mount-once closure -- same pattern as
  // lineHeightPxRef/cellWidthPxRef. Only the flag column affects the right
  // padding computed there (see computeReviewGutterRightPx), so line-number
  // visibility doesn't need a mirror ref.
  const showReviewFlagsRef = useRef(showReviewFlags);
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

  // Review/warning-flag gutter state. reviewFlagsRef mirrors reviewFlags (the
  // id/severity truth, from the DB) for read access inside the updateListener
  // closure below without becoming a dependency that would force it to
  // re-register on every flag change. flagPositionsRef is the live,
  // per-keystroke-remapped document POSITION (not line number) for each
  // flag id -- exact via ChangeSet.mapPos (see the updateListener's
  // docChanged branch) -- line numbers are only ever derived FROM these
  // positions, never tracked independently, so there is exactly one source
  // of truth for "where is this flag now" while a note is open.
  const [reviewFlags, setReviewFlags] = useState<ReviewFlagEntry[]>([]);
  const reviewFlagsRef = useRef<ReviewFlagEntry[]>([]);
  useEffect(() => { reviewFlagsRef.current = reviewFlags; }, [reviewFlags]);
  const flagPositionsRef = useRef<Map<number, number>>(new Map());
  const [lineLayoutRows, setLineLayoutRows] = useState<LineLayoutRow[]>([]);
  // The review gutter's static top/bottom "jump arrow" box positions and the
  // document line currently resolved at each (see updateLineLayout) --
  // pinned purely by editor height, independent of which rows
  // viewportLineBlocks happens to render this pass. reviewGutterEdgeLinesRef
  // mirrors the state for navigateToFlaggedLine, called from the
  // Ctrl+ArrowUp/Down keymap handler via a stable ref (registered once at
  // view-construction time, so it can't see fresh render-scoped state) --
  // same reasoning as flagsByLineRef.
  const [reviewGutterEdgeLines, setReviewGutterEdgeLines] = useState<ReviewGutterEdgeLines | null>(null);
  const reviewGutterEdgeLinesRef = useRef<ReviewGutterEdgeLines | null>(null);
  const [totalLineCount, setTotalLineCount] = useState(1);
  // line number -> {id, severity} for the CURRENT (post-remap) document,
  // recomputed in lockstep with lineLayoutRows -- see updateLineLayout.
  const flagsByLineRef = useRef<Map<number, { id: number; severity: ReviewFlagSeverity }>>(new Map());
  const reviewFlagSyncTimeoutRef = useRef<number | null>(null);
  // The updateListener closure below is registered once at mount (see its
  // own "mount-once" comment) and can't see prop changes directly -- kept in
  // sync by the note-switch effect further down, same pattern as
  // lastHydratedNoteIdRef.
  const noteIdRef = useRef<string | null>(noteId ?? null);

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
  const hasViewportLinesRef = useRef(hasViewportLines);
  const isSnapshotRestorePendingRef = useRef(isSnapshotRestorePending);
  const snapshotRestoreRafRef = useRef<number | null>(null);
  const caretHidden = isSnapshotRestorePending || caretSuspended;
  // Placeholder emptiness tracking is unnecessary here; the CM6 view itself
  // manages empty-document UX without a separate React state mirror.
  const [isDraggingTop, setIsDraggingTop] = useState(false);
  const [isDraggingBottom, setIsDraggingBottom] = useState(false);
  const [isCtrlHeldForBoundaryDrag, setIsCtrlHeldForBoundaryDrag] = useState(false);
  // Bumped once, right after the mount-once effect below (re)creates the CM6
  // EditorView (viewRef.current = view). Exists purely so effects that
  // imperatively mutate view.contentDOM/view.scrollDOM (the padding effect
  // below is the only one today) can depend on "a fresh view instance now
  // exists," not just on the computed pixel values they'd otherwise write --
  // those values can come out numerically IDENTICAL to before a remount
  // (nothing about font size/boundaries actually changed), which makes
  // React's own dependency-array diff skip re-running the effect even
  // though the DOM node it needs to touch is a brand-new one with no inline
  // styles yet. Found via a dev-mode Fast Refresh repro: editing this file
  // while a note was open left the text rendered flush at (0,0) -- the
  // mount-once effect recreated the EditorView (fresh, unstyled
  // contentDOM), but the padding effect's own deps (halfCellWidthPx,
  // topBoundaryVisualPx, etc.) were unchanged from before the edit, so
  // React correctly-by-its-own-rules concluded there was nothing to
  // reapply. It self-corrected the moment anything else nudged one of
  // those deps (e.g. loading a different note), which is what made it look
  // intermittent/"fixes itself" rather than a clean reproduction.
  const [viewMountGeneration, setViewMountGeneration] = useState(0);
  const [scrollerClientHeightPx, setScrollerClientHeightPx] = useState(0);
  // Review gutter's flag-column width only -- everything else here still
  // reasons in lineHeightPx/cellWidthPx units. Tracked the same way (and at
  // the same call sites) as scrollerClientHeightPx above.
  const [scrollerClientWidthPx, setScrollerClientWidthPx] = useState(0);
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
  const syncCustomScrollbarRef = useRef<((options?: { force?: boolean }) => void) | null>(null);

  const beginScrollTransition = useCallback((kind: 'snapshot-restore' | 'geometry-settle', options?: { settleMs?: number; maxBlockMs?: number; blockUserInput?: boolean; transitionId?: number }) => (
    scrollTransitionControllerRef.current.beginTransition({
      kind,
      settleMs: options?.settleMs ?? 200,
      maxBlockMs: options?.maxBlockMs,
      blockUserInput: options?.blockUserInput,
      transitionId: options?.transitionId,
    })
  ), []);

  const extendScrollTransitionSettle = useCallback((transitionId: number, settleMs = 200) => {
    scrollTransitionControllerRef.current.extendSettle(transitionId, settleMs);
  }, []);

  const registerProgrammaticScrollEvent = useCallback((transitionId: number) => {
    scrollTransitionControllerRef.current.registerProgrammaticScrollEvent(transitionId);
  }, []);

  const isEditScrollInteractionBlocked = useCallback(() => {
    const extraBlocked = !hasViewportLinesRef.current || isSnapshotRestorePendingRef.current;
    return scrollTransitionControllerRef.current.shouldBlockUserInput(extraBlocked);
  }, []);

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

    if (isEditScrollInteractionBlocked() && !options?.force) {
      setScrollThumbHeightPx(0);
      setScrollThumbTopPx(0);
      setIsScrollThumbActive(false);
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
  }, [isEditScrollInteractionBlocked, readScrollbarGeometry]);

  useEffect(() => {
    syncCustomScrollbarRef.current = syncCustomScrollbar;
  }, [syncCustomScrollbar]);

  useEffect(() => {
    const controller = scrollTransitionControllerRef.current;
    controller.setOnSettled(() => {
      syncCustomScrollbarRef.current?.({ force: true });
    });
    return () => controller.setOnSettled(null);
  }, []);

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
    showReviewFlagsRef.current = showReviewFlags;
  }, [showReviewFlags]);

  useEffect(() => {
    hasViewportLinesRef.current = hasViewportLines;
  }, [hasViewportLines]);

  useEffect(() => {
    isSnapshotRestorePendingRef.current = isSnapshotRestorePending;
  }, [isSnapshotRestorePending]);

  useEffect(() => {
    topBoundaryPxRef.current = topBoundaryPxDisplay;
    bottomBoundaryPxRef.current = bottomBoundaryPxDisplay;
  }, [topBoundaryPxDisplay, bottomBoundaryPxDisplay]);

  useEffect(() => {
    const syncCtrlState = (event: KeyboardEvent) => {
      setIsCtrlHeldForBoundaryDrag(event.ctrlKey);
    };
    const clearCtrlState = () => {
      setIsCtrlHeldForBoundaryDrag(false);
    };

    window.addEventListener('keydown', syncCtrlState);
    window.addEventListener('keyup', syncCtrlState);
    window.addEventListener('blur', clearCtrlState);

    return () => {
      window.removeEventListener('keydown', syncCtrlState);
      window.removeEventListener('keyup', syncCtrlState);
      window.removeEventListener('blur', clearCtrlState);
    };
  }, []);

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
  // .editor-text's own glyph-centering `transform: translateX(...)`
  // (index.css) shifts the ENTIRE rendered contentDOM box right by exactly
  // this amount -- same formula, same two inputs, so this always matches
  // the CSS calc() exactly, not an approximation of it. A transform shifts
  // an element's post-layout PAINT position, not its layout width, so
  // padding can't compensate for it (padding is inside the box; the box
  // itself, padding included, is what's moving) -- confirmed live
  // (docs/cm6-parity-hardening-plan.md, "Bug 8"): the shifted box's right
  // edge lands this many px past .cm-scroller's own right edge, which
  // Chromium counts as real scrollable overflow despite .cm-scroller's own
  // overflowX:hidden (that CSS property only blocks *user-driven*
  // wheel/scrollbar scrolling, not programmatic or native-browser
  // scrolling, e.g. dragging a text selection past the scroller's edge).
  // Capping contentDOM's own box at this much less than 100% (applied via
  // maxWidth below -- see that assignment's own comment for why maxWidth,
  // not width) pulls its un-transformed right edge left by the same
  // distance the transform then shifts it right, netting to exactly zero
  // -- the box lands back flush with the scroller's edge instead of past
  // it, so there's no overflow region left for anything to scroll into in
  // the first place.
  const glyphCenteringShiftPx = (cellWidthPx - glyphWidthPx) / 2;
  // Line-number glyphs render smaller than the body text (see the gutter
  // JSX below) but still have to land one-per-box in the same cellWidthPx
  // grid column as everything else -- the same x-box letter-spacing +
  // translateX centering trick .editor-text uses for the body text
  // (index.css), just re-derived against the smaller font's OWN measured
  // glyph width instead of the body glyph's. Re-measuring per render is
  // cheap (a single canvas measureText call) and avoids a second metrics
  // pipeline; memoizing on fontFamily/fontSizePx would save nothing since
  // both already only change when the user edits typography settings,
  // which re-renders this component regardless.
  const lineNumberFontSizePx = Math.max(1, Math.round(fontSizePx * 0.67));
  const lineNumberGlyphWidthPx = resolveGlyphWidthPx(fontFamily, lineNumberFontSizePx);
  const lineNumberLetterSpacingPx = cellWidthPx - lineNumberGlyphWidthPx;
  // Review gutter widths: one grid cell reserved per digit of the highest
  // line number currently in the document (dynamically reserved, per the
  // spec) for the line-number column, plus exactly one cell for the single
  // flag column. Zero when the gutter is toggled off -- additive-only
  // against the existing padding math below, so a user who never enables
  // this feature sees byte-identical layout to before it existed.
  const reviewGutterLeftPx = showLineNumbers ? String(Math.max(1, totalLineCount)).length * cellWidthPx : 0;
  // The flag column can't be a flat one-cell width: the grid's box columns
  // are anchored from the LEFT (halfCellWidthPx + n*cellWidthPx) and are
  // never phase-corrected against the right edge -- same "cut-off boxes at
  // the far edges expected and fine" as the grid overlay's own doc comment
  // -- so the scroller's right edge almost never lands exactly on a box
  // boundary. A flat cellWidthPx-wide column would then straddle the last
  // full box and that leftover partial one. Reserving one full box PLUS
  // whatever's left over instead makes the column's own LEFT edge land
  // exactly on a real grid boundary, with its right edge flush against the
  // scroller's own right edge -- same remainder-into-the-last-cell trick
  // alignmentPaddingBottomPx below already uses for the bottom edge, just
  // horizontal.
  // Shares computeReviewGutterRightPx with the resize-observer callback
  // below, which applies the same formula synchronously against a freshly
  // measured width -- see that function's own doc comment for why the
  // formula needs to live in exactly one place, called from two triggers.
  const reviewGutterRightPx = computeReviewGutterRightPx(scrollerClientWidthPx, cellWidthPx, showReviewFlags);
  // Rendered via an explicit `left`, never `right: 0`: a `right: 0` box's
  // right edge is resolved live by the browser against the parent's actual
  // current width on every layout pass, while reviewGutterRightPx (its
  // width) only updates when scrollerClientWidthPx's own state does (the
  // ResizeObserver callback/settle loop, not every frame) -- during a live
  // window/pane resize those two go out of sync for a few frames, and a
  // right-anchored box with a stale width visibly jitters/stretches against
  // the instantly-resizing parent. Anchoring from an explicit, JS-computed
  // left position instead means the box only ever moves when our own state
  // says so, matching how every other geometry value in this file is
  // positioned (topPx, halfCellWidthPx, etc. -- always explicit offsets,
  // never a CSS edge keyword). Clamped to 0: before the first real width
  // measurement lands, scrollerClientWidthPx is still 0 and this would
  // otherwise go negative.
  const reviewGutterRightLeftPx = Math.max(0, scrollerClientWidthPx - reviewGutterRightPx);
  // The VISIBLE/clickable flag column is exactly one box, not the full
  // reviewGutterRightPx region (that's one box PLUS the cut-off remainder --
  // see its own comment -- reserved from text wrapping so the remainder
  // sliver stays clear of glyphs too, but the flag box itself doesn't need
  // to fill it). Anchored at the same reviewGutterRightLeftPx grid boundary,
  // so it's still exactly one real grid box, just not stretched out to the
  // scroller's own right edge the way the reserved region is -- found live:
  // rendering it at the full reserved width visually extended the gutter
  // all the way to the border, past where a single box actually ends.
  const reviewGutterFlagBoxWidthPx = showReviewFlags ? cellWidthPx : 0;
  // Whether the gutter's static top/bottom edge box (see
  // ReviewGutterEdgeLines) should show an up/down-long "jump" arrow -- true
  // iff a flagged line exists strictly past that edge (above
  // reviewGutterEdgeLines.topLine, below .bottomLine). Recomputed every
  // render off flagsByLineRef (all flags, not just visible ones).
  const reviewGutterHasFlagAboveTop = reviewGutterEdgeLines !== null
    && Array.from(flagsByLineRef.current.keys()).some((line) => line < reviewGutterEdgeLines.topLine);
  const reviewGutterHasFlagBelowBottom = reviewGutterEdgeLines !== null
    && Array.from(flagsByLineRef.current.keys()).some((line) => line > reviewGutterEdgeLines.bottomLine);
  // topBoundaryPxDisplay/bottomBoundaryPxDisplay are phase-0 (plain multiples
  // of lineHeightPx) because that's what the scroll-cage math needs them to
  // stay as -- see CageMath.ts's own doc comment on why its screen-anchored
  // threshold positions must NOT carry the half-cell offset. But every
  // on-screen rendering of a boundary line (the zone shading, the drag
  // handles, the content padding below) sits on the same "infinity grid" as
  // the rest of the content, which starts halfLineHeightPx down from the
  // container edge -- so the VISUAL position of a boundary of N lines is
  // N*lineHeightPx + halfLineHeightPx, not the raw phase-0 value. These are
  // that shift, applied once here and reused by every visual call site
  // instead of each one re-deriving (or forgetting) it.
  const topBoundaryVisualPx = topBoundaryPxDisplay + halfLineHeightPx;
  // The half-cell shift alone isn't enough to make the bottom boundary land
  // an integer number of lineHeightPx below the top one: scrollerClientHeightPx
  // is an arbitrary pixel height with no reason to be a multiple of
  // lineHeightPx, so "container height minus both boundaries" (the middle
  // content region) is essentially never itself a clean multiple either --
  // leaving a leftover partial row unaccounted for. Folding that leftover
  // into the bottom boundary's own visual size (rather than the top's, which
  // stays anchored to the grid from the container's top-left corner by
  // construction) makes the middle region's height an exact multiple of
  // lineHeightPx, which is what actually pins the bottom boundary to a whole
  // number of rows below the top one.
  const middleRegionRawPx = Math.max(0, scrollerClientHeightPx - topBoundaryVisualPx - bottomBoundaryPxDisplay);
  const middleRegionRemainderPx = lineHeightPx > 0 ? middleRegionRawPx % lineHeightPx : 0;
  const bottomBoundaryVisualPx = bottomBoundaryPxDisplay + middleRegionRemainderPx;
  // Quantized so it's an exact multiple of lineHeightPx by construction (see
  // above) -- used as an explicit height instead of a CSS `bottom: Npx` inset
  // for the divs below.
  const middleRegionHeightPx = middleRegionRawPx - middleRegionRemainderPx;
  // Visual-only tweak: the trailing-zone paint should begin one whole row
  // lower than the cage's own geometric boundary. Keep scroll/cage/handle
  // math unchanged and only contract the painted trailing zone by one row.
  // Every boundary-zone/handle div below is positioned via an explicit `top`
  // computed from this one JS-tracked scrollerClientHeightPx, never via a
  // CSS `bottom: Npx` inset. `bottom` insets are resolved against the
  // overlay layer's OWN live layout box, which -- unlike scrollerClientHeightPx
  // -- can be a fractional CSS pixel height (e.g. flexbox distributing
  // leftover space) and can be one resize-observer tick stale relative to
  // the values computed here in the same render. Two positioning systems
  // that are each individually consistent but drift from each other by a
  // sub-pixel amount during a continuous window resize is exactly what reads
  // as jitter; deriving every position from this single integer removes the
  // second system entirely.
  const middleRegionZoneHeightPx = middleRegionHeightPx + (bottomBoundaryVisualPx - bottomBoundaryVisualPx);
  const bottomZoneTopPx = Math.max(0, scrollerClientHeightPx - bottomBoundaryVisualPx);
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
    // reviewGutterLeftPx/reviewGutterRightPx (0 when the gutter is off) push
    // the grid-alignment math above outward without altering it: text still
    // starts exactly halfCellWidthPx past wherever the content box now
    // begins, the gutter columns occupy the reserved space to either side.
    view.contentDOM.style.paddingLeft = `${halfCellWidthPx + reviewGutterLeftPx}px`;
    view.contentDOM.style.paddingRight = `${reviewGutterRightPx}px`;
    view.contentDOM.style.paddingTop = `${topBoundaryVisualPx}px`;
    view.contentDOM.style.paddingBottom = `${bottomBoundaryPxDisplay + alignmentPaddingBottomPx}px`;
    // See glyphCenteringShiftPx's own doc comment above -- closes the real
    // 1px-of-scrollable-overflow gap the glyph-centering transform leaves
    // at the right edge, at its actual source rather than reacting to
    // wherever it happens to let scrollLeft drift. maxWidth, not width:
    // CM6's own base theme makes .cm-content a flex item of .cm-scroller
    // (a flex row) with flexGrow: 2 -- a plain `width` is only that item's
    // flex-basis, which flex-grow then re-expands right back to fill 100%
    // of the container, silently undoing the shrink (confirmed live: width
    // was applying as inline style exactly as expected, but
    // getComputedStyle still reported the full, un-shrunk value). maxWidth
    // isn't a flex-basis input -- it's a hard clamp the grown size can't
    // exceed, so it actually holds.
    view.contentDOM.style.maxWidth = `calc(100% - ${glyphCenteringShiftPx}px)`;
    // Same reasoning as the lineHeightPx/cellWidthPx metrics-change effect
    // further down: an external padding mutation grows/shrinks scrollHeight
    // outside CM6's own dispatch/transaction system, so its scrollTop
    // reconciliation across that needs to be forced rather than left to
    // whatever unforced schedule it would otherwise settle on.
    view.requestMeasure();
    // viewMountGeneration: forces this to re-run whenever the EditorView
    // itself was (re)created, independent of whether any of the pixel
    // values above actually changed -- see viewMountGeneration's own doc
    // comment for the class of bug this closes (a fresh contentDOM with no
    // inline styles yet, paired with unchanged geometry numbers that would
    // otherwise make React skip re-running this effect).
  }, [topBoundaryVisualPx, bottomBoundaryPxDisplay, alignmentPaddingBottomPx, halfCellWidthPx, reviewGutterLeftPx, reviewGutterRightPx, glyphCenteringShiftPx, viewMountGeneration]);

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
    // hasViewportLines/isSnapshotRestorePending are deliberately deps here,
    // not just refs read inside isEditScrollInteractionBlocked: the passive
    // rAF loop below only re-syncs when raw scroll metrics (scrollTop/
    // scrollHeight/clientHeight/trackHeight) change, so if this gate lifts
    // (large-note hydration finishing) while those metrics happen to be
    // unchanged, the thumb would otherwise stay hidden at 0/0 until some
    // unrelated event nudges a metric. This effect closes that race by
    // re-syncing the moment the gate itself flips.
  }, [syncCustomScrollbar, scrollerClientHeightPx, initialText, topBoundaryPxDisplay, bottomBoundaryPxDisplay, hasViewportLines, isSnapshotRestorePending]);

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
      caretRect,
      scrollerRect.top,
      scroller.scrollTop,
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
      // translate(), not translate3d(): a 3D transform is a compositing
      // trigger on its own, and this element must stay OFF the compositor --
      // see .thockdown-block-caret's own comment in index.css for the black
      // edit pane that a composited caret produces under the edge-fade mask.
      transform: `translate(${scrollerLeftInLayer + absoluteLeft + CARET_INSET_PX}px, ${scrollerTopInLayer + topInViewport + CARET_INSET_PX}px)`,
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
   * Review gutter's per-document-line geometry + current flag placement.
   * Reads CM6's own analytical line-block layout (view.viewportLineBlocks) --
   * not a DOM measurement -- so it's exact under wrapping and viewport
   * virtualization for free, the same primitive resolveSourceLineAtHeight
   * already relies on elsewhere in this file. Deliberately NOT gated on
   * showLineNumbers/showReviewFlags: flagsByLineRef must stay current even
   * while the columns are hidden, since toggling them back on must show
   * up-to-date flags immediately, not a stale snapshot from before the toggle.
   */
  const updateLineLayout = useCallback(() => {
    const view = viewRef.current;
    const layerEl = layerRef.current;
    if (!view || !layerEl) {
      setLineLayoutRows([]);
      setReviewGutterEdgeLines(null);
      reviewGutterEdgeLinesRef.current = null;
      return;
    }

    const scroller = view.scrollDOM;
    const scrollerRect = scroller.getBoundingClientRect();
    const layerRect = layerEl.getBoundingClientRect();
    const scrollerTopInLayer = scrollerRect.top - layerRect.top;

    // Same phase-aware quantization updateSelectionHighlight already applies
    // to its own row tops (see quantizeToPhase's doc comment): the content's
    // half-line-height "infinity grid" breathing-room shift moves every real
    // row's true position off a plain multiple of lineHeightPx, so a raw
    // block.top read needs snapping to the SAME phase the grid overlay's own
    // backgroundPosition uses, or gutter rows drift a fraction of a row off
    // the visible grid boxes they're meant to sit inside.
    const lineHeightPxNow = lineHeightPxRef.current;
    const halfLineHeightPxNow = Math.round(lineHeightPxNow / 2);
    // view.viewportLineBlocks' `top` is in CM6's OWN heightmap coordinate
    // space -- accumulated line heights from the document's start -- which
    // does NOT include view.contentDOM's own CSS paddingTop (the fixed-
    // focus cage's top-boundary inset). scroller.scrollTop=0, however, is
    // the top of the padding box (padding is inside the scrollable area),
    // so `block.top - scroller.scrollTop` alone is short by exactly that
    // padding -- found live: without this term, gutter rows sat a fraction
    // of a row too high at boundary=0, and never moved at all as the top
    // boundary was dragged down, even though the real first line visibly
    // did (its position comes from CSS padding, not the heightmap this loop
    // reads). topBoundaryPxRef mirrors topBoundaryPxDisplay (see the effect
    // syncing it) so this stays correct as the boundary is dragged live.
    const topBoundaryVisualPxNow = topBoundaryPxRef.current + halfLineHeightPxNow;

    const rows: LineLayoutRow[] = [];
    for (const block of view.viewportLineBlocks) {
      const docLine = view.state.doc.lineAt(block.from);
      // A document line can be split across multiple blocks (block widgets);
      // only the block starting at the line's own `from` gets a gutter row.
      if (block.from !== docLine.from) continue;
      const rawTopPx = scrollerTopInLayer + topBoundaryVisualPxNow + (block.top - scroller.scrollTop);
      rows.push({
        line: docLine.number,
        topPx: quantizeToPhase(rawTopPx, lineHeightPxNow, halfLineHeightPxNow),
        heightPx: block.height,
      });
    }
    setLineLayoutRows(rows);
    setTotalLineCount(view.state.doc.lines);

    // Static top/bottom "jump arrow" box positions -- pinned purely by
    // editor height (scroller.clientHeight / lineHeightPx), NOT by which
    // rows viewportLineBlocks happens to include this render. Found live:
    // anchoring the arrow to lineLayoutRows[0]/[length-1] instead put it on
    // whatever line CM6's virtualization buffer (which extends beyond the
    // actually-visible pixels, both above and below) happened to report
    // first/last that render, so the arrow visibly jittered between rows
    // and wasn't reliably at the real bottom edge. Resolving the line at
    // each fixed pixel slot via view.lineBlockAtHeight (the same analytical,
    // non-DOM primitive resolveSourceLineAtHeight uses) instead of scanning
    // the rendered-rows array sidesteps the virtualization window entirely.
    const staticVisibleRowCount = Math.max(1, Math.floor((scroller.clientHeight - topBoundaryVisualPxNow) / lineHeightPxNow));
    const topBoxTopPx = quantizeToPhase(scrollerTopInLayer + topBoundaryVisualPxNow, lineHeightPxNow, halfLineHeightPxNow);
    const bottomBoxTopPx = quantizeToPhase(
      scrollerTopInLayer + topBoundaryVisualPxNow + (staticVisibleRowCount - 1) * lineHeightPxNow,
      lineHeightPxNow,
      halfLineHeightPxNow,
    );
    const resolveLineAtHeightMapPos = (heightMapPos: number): number => {
      const clamped = Math.max(0, Math.min(view.contentHeight, heightMapPos));
      const block = view.lineBlockAtHeight(clamped);
      return view.state.doc.lineAt(block.from).number;
    };
    const edgeLines = {
      topLine: resolveLineAtHeightMapPos(scroller.scrollTop),
      bottomLine: resolveLineAtHeightMapPos(scroller.scrollTop + (staticVisibleRowCount - 1) * lineHeightPxNow),
      topBoxTopPx,
      bottomBoxTopPx,
    };
    setReviewGutterEdgeLines(edgeLines);
    reviewGutterEdgeLinesRef.current = edgeLines;

    const flagsByLine = new Map<number, { id: number; severity: ReviewFlagSeverity }>();
    for (const flag of reviewFlagsRef.current) {
      const pos = flagPositionsRef.current.get(flag.id);
      if (pos == null) continue;
      const clampedPos = Math.max(0, Math.min(pos, view.state.doc.length));
      const line = view.state.doc.lineAt(clampedPos).number;
      const existing = flagsByLine.get(line);
      if (!existing || reviewFlagSeverityRank(flag.severity) > reviewFlagSeverityRank(existing.severity)) {
        flagsByLine.set(line, { id: flag.id, severity: flag.severity });
      }
    }
    flagsByLineRef.current = flagsByLine;
  }, []);

  /**
   * Ported verbatim from BlockSelectionPlugin.tsx's own updateSelection --
   * same algorithm (readSelectionLineRects, empty-line filtering, quantized
   * row merging, viewport clipping), sourced from the CM6 EditorView instead
   * of Lexical's editor state. Doesn't require focus the way updateCaret
   * does: a read-only note's native text selection still works (and should
   * still highlight) even though it never becomes document.activeElement.
   * Recomputes the review-gutter's line layout in lockstep (updateLineLayout)
   * -- both need to resync on exactly the same doc/viewport/scroll/resize
   * triggers, so this reuses the one already-correct schedule instead of a
   * second parallel one that risked drifting out of sync with it.
   */
  const updateSelectionHighlight = useCallback(() => {
    updateLineLayout();

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
  }, [updateLineLayout]);

  const scheduleSelectionHighlightUpdate = useCallback(() => {
    if (highlightAnimationFrameRef.current !== null) {
      cancelAnimationFrame(highlightAnimationFrameRef.current);
    }
    highlightAnimationFrameRef.current = requestAnimationFrame(() => {
      highlightAnimationFrameRef.current = null;
      updateSelectionHighlight();
    });
  }, [updateSelectionHighlight]);

  /**
   * Recomputes each flag's current line number (from its live, ChangeSet-
   * remapped position -- see flagPositionsRef) and content hash, resolves
   * any collision (an edit merged two flagged lines into one) by keeping the
   * more severe flag, and persists the result. Debounced (scheduleReviewFlagSync)
   * rather than run on every keystroke -- the live position remap that keeps
   * rendering correct is exact and synchronous already; this only needs to
   * catch the DB up periodically plus once before a note switch/unmount.
   */
  const runReviewFlagSync = useCallback(() => {
    const view = viewRef.current;
    const noteId = noteIdRef.current;
    if (!view || !noteId || flagPositionsRef.current.size === 0) return;
    const doc = view.state.doc;
    const winners = new Map<number, { remap: ReviewFlagRemap; severity: ReviewFlagSeverity }>();
    for (const flag of reviewFlagsRef.current) {
      const pos = flagPositionsRef.current.get(flag.id);
      if (pos == null) continue;
      const clampedPos = Math.max(0, Math.min(pos, doc.length));
      const line = doc.lineAt(clampedPos);
      const existing = winners.get(line.number);
      if (!existing || reviewFlagSeverityRank(flag.severity) > reviewFlagSeverityRank(existing.severity)) {
        winners.set(line.number, {
          remap: { id: flag.id, lineNumber: line.number, lineHash: hashLineText(line.text) },
          severity: flag.severity,
        });
      }
    }
    window.thockdownReviewFlags?.syncReviewFlags(noteId, Array.from(winners.values(), (w) => w.remap))
      .then(setReviewFlags)
      .catch(() => {});
  }, []);

  const scheduleReviewFlagSync = useCallback(() => {
    if (reviewFlagSyncTimeoutRef.current !== null) {
      window.clearTimeout(reviewFlagSyncTimeoutRef.current);
    }
    reviewFlagSyncTimeoutRef.current = window.setTimeout(() => {
      reviewFlagSyncTimeoutRef.current = null;
      runReviewFlagSync();
    }, 800);
  }, [runReviewFlagSync]);

  /**
   * Flag-column click: a severity toggle, not a delete. Empty -> "?"
   * (review) -> "!" (warning) -> "?" -> ... -- clicking a "!" box demotes it
   * back to "?" rather than clearing it (see handleGutterFlagContextMenu for
   * the deliberate, separate clear action). Applies to the whole logical
   * line regardless of which of its wrapped visual rows was clicked, since
   * the flag column renders one clickable region per document line spanning
   * its full wrapped height.
   */
  const handleGutterFlagClick = useCallback((line: number) => {
    const view = viewRef.current;
    const noteId = noteIdRef.current;
    if (!view || !noteId || line < 1 || line > view.state.doc.lines) return;
    const lineObj = view.state.doc.line(line);
    const existing = flagsByLineRef.current.get(line);
    const nextSeverity: ReviewFlagSeverity = !existing || existing.severity === 'warning' ? 'review' : 'warning';
    window.thockdownReviewFlags?.setReviewFlag(noteId, {
      lineNumber: line,
      severity: nextSeverity,
      lineHash: hashLineText(lineObj.text),
    }).then((flags) => {
      if (noteIdRef.current !== noteId) return;
      const currentView = viewRef.current;
      const positions = new Map<number, number>();
      if (currentView) {
        const doc = currentView.state.doc;
        for (const flag of flags) {
          if (flag.lineNumber >= 1 && flag.lineNumber <= doc.lines) {
            positions.set(flag.id, doc.line(flag.lineNumber).from);
          }
        }
      }
      flagPositionsRef.current = positions;
      setReviewFlags(flags);
      // setReviewFlags alone only triggers a React re-render -- it does NOT
      // re-run updateLineLayout (an imperative recompute, not tied to the
      // render cycle), so flagsByLineRef -- what the tint/glyph JSX actually
      // reads -- stayed stale until some UNRELATED trigger (clicking into
      // the text, which fires selectionchange) happened to run it next.
      // Found live: a clicked flag didn't visually appear until the user
      // then clicked into the note text, which looked like the click needed
      // "arming" but was actually just a missed repaint. Forcing the same
      // recompute pass right here closes that gap.
      scheduleSelectionHighlightUpdate();
    }).catch(() => {});
  }, [scheduleSelectionHighlightUpdate]);

  /** The sole, deliberate clear-a-flag action -- distinct from the click-cycle above. */
  const handleGutterFlagContextMenu = useCallback((line: number, event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    const noteId = noteIdRef.current;
    if (!noteId) return;
    window.thockdownReviewFlags?.clearReviewFlag(noteId, line).then((flags) => {
      if (noteIdRef.current !== noteId) return;
      const currentView = viewRef.current;
      const positions = new Map<number, number>();
      if (currentView) {
        const doc = currentView.state.doc;
        for (const flag of flags) {
          if (flag.lineNumber >= 1 && flag.lineNumber <= doc.lines) {
            positions.set(flag.id, doc.line(flag.lineNumber).from);
          }
        }
      }
      flagPositionsRef.current = positions;
      setReviewFlags(flags);
      // Same reasoning as handleGutterFlagClick above.
      scheduleSelectionHighlightUpdate();
    }).catch(() => {});
  }, [scheduleSelectionHighlightUpdate]);

  /**
   * Jumps to the nearest flagged line above ('up') or below ('down') the
   * gutter's static top/bottom edge box (see updateLineLayout's
   * ReviewGutterEdgeLines), or -- if the line resolved at that edge box is
   * itself already flagged -- centers that line instead of skipping past
   * it. Reuses reconcileSelectionJumpScrollRef (the same "center the new
   * selection in the caged middle" pass useDocumentFindNavigation's
   * search-hit jump uses via applySnapshot's `selectionScrollBehavior:
   * 'center-caged'`) rather than a separate scroll path, so a flag jump
   * settles with the exact same viewport-virtualization-aware retry
   * behavior a search jump gets.
   *
   * Refreshes reviewGutterEdgeLinesRef synchronously before reading it,
   * rather than trusting whatever updateLineLayout last happened to leave
   * there: this fires from a plain click/keydown, which can land before this
   * section's own next scheduled layout pass (e.g. right after a click
   * elsewhere in the section -- the toolbar, the tab bar -- made it the
   * active section for the first time, with no intervening scroll/viewport
   * event of its own to have refreshed the edge lines yet). Found live as a
   * jump landing on the wrong line -- effectively still using the previously
   * active section's stale-for-this-instance edge data -- right after
   * switching sections and immediately clicking a flag-jump arrow.
   * updateLineLayout is cheap (one measure pass) and idempotent, so calling
   * it an extra time here even when it wasn't actually stale costs nothing.
   */
  const navigateToFlaggedLine = useCallback((direction: 'up' | 'down'): boolean => {
    const view = viewRef.current;
    updateLineLayout();
    const edgeLines = reviewGutterEdgeLinesRef.current;
    if (!view || !edgeLines) return false;

    const edgeLine = direction === 'up' ? edgeLines.topLine : edgeLines.bottomLine;
    const flaggedLines = flagsByLineRef.current;

    let targetLine: number | null = null;
    if (flaggedLines.has(edgeLine)) {
      targetLine = edgeLine;
    } else if (direction === 'up') {
      let best: number | null = null;
      for (const line of flaggedLines.keys()) {
        if (line < edgeLine && (best === null || line > best)) best = line;
      }
      targetLine = best;
    } else {
      let best: number | null = null;
      for (const line of flaggedLines.keys()) {
        if (line > edgeLine && (best === null || line < best)) best = line;
      }
      targetLine = best;
    }

    if (targetLine === null || targetLine < 1 || targetLine > view.state.doc.lines) return false;

    const linePos = view.state.doc.line(targetLine).to;
    view.dispatch({ selection: EditorSelection.cursor(linePos) });
    reconcileSelectionJumpScrollRef.current?.(view);
    return true;
  }, [updateLineLayout]);

  // isSectionActive tracked via a ref (not read directly in requestFlagJump
  // below) because requestFlagJump has to see the value as of the exact
  // moment its mousedown fired -- a plain closure over the prop would be
  // fine too, but the ref makes the "read at call time, not at render time"
  // intent explicit and matches every other latest-value ref in this file.
  const isSectionActiveRef = useRef(isSectionActive);
  useEffect(() => {
    isSectionActiveRef.current = isSectionActive;
  }, [isSectionActive]);

  const topFlagArrowElRef = useRef<HTMLDivElement | null>(null);
  const bottomFlagArrowElRef = useRef<HTMLDivElement | null>(null);
  const pendingFlagJumpElementRef = useRef<HTMLDivElement | null>(null);

  /**
   * Click entry point for the flag-jump arrows -- NOT navigateToFlaggedLine
   * directly. A click on a still-inactive section's jump arrow fires from
   * the same mousedown that also activates the section (see
   * .editor-section-column's onMouseDownCapture in EditorSection.tsx):
   * mousedown always precedes click, so markSectionActive has already been
   * dispatched by the time this runs, but React hasn't committed that state
   * update yet -- isSectionActiveRef here still reflects the PRE-activation
   * render. Jumping immediately against that risks measuring/acting on this
   * editor before activation has actually landed. Found live as a jump that
   * landed on the wrong line right after switching sections and clicking a
   * jump arrow in the same gesture.
   *
   * Rather than caching anything about THIS click and replaying a guess at
   * what it should have computed, a still-inactive section just remembers
   * WHICH element was clicked. The effect below, once isSectionActive/
   * editorReadOnly confirm the section has actually landed, replays a real
   * `element.click()` on it -- an honest fresh click through this exact same
   * handler, at which point isSectionActiveRef reads true and this falls
   * through to the normal immediate branch below. Nothing about the jump
   * itself (edge lines, flagged lines, doc content) is ever computed ahead
   * of time or threaded through the deferral; navigateToFlaggedLine only
   * ever runs against whatever is live at the moment it's actually called,
   * exactly like a genuine click always did.
   */
  const requestFlagJump = useCallback((direction: 'up' | 'down', element: HTMLDivElement | null) => {
    if (!isSectionActiveRef.current) {
      pendingFlagJumpElementRef.current = element;
      return;
    }
    pendingFlagJumpElementRef.current = null;
    navigateToFlaggedLine(direction);
  }, [navigateToFlaggedLine]);

  useEffect(() => {
    if (!isSectionActive || editorReadOnly) return;
    const element = pendingFlagJumpElementRef.current;
    if (!element) return;
    pendingFlagJumpElementRef.current = null;
    element.click();
  }, [isSectionActive, editorReadOnly]);

  useEffect(() => {
    navigateToFlaggedLineRef.current = navigateToFlaggedLine;
  }, [navigateToFlaggedLine]);

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
  // requestMeasure() alone still wasn't the whole story: CM6's own
  // scroll-position preservation across the reflow keeps scrollTop at
  // roughly the same VISUAL spot, but that preserved value has no reason to
  // still be an exact multiple of the NEW lineHeightPx the way it was of
  // the old one -- e.g. scrollTop 240 was a clean 10 rows at 24px, but isn't
  // a whole number of rows at 26px. The fixed-position grid overlay doesn't
  // move with scrollTop, so an off-grid scrollTop is exactly what leaves
  // every visible row sitting off it, and it stayed that way until whatever
  // next scroll gesture happened to run the same quantization handleWheel
  // already applies on every wheel tick. Re-running that identical
  // rounding here, once, closes the gap instead of waiting on the user's
  // next scroll to do it as a side effect -- and it fires for every
  // mounted CM6Editor independently (each split-view section has its own),
  // not just whichever one happens to be focused.
  //
  // Separately (still worth keeping): scheduleCaretUpdateAfterResize/
  // scheduleSelectionHighlightUpdate/syncCustomScrollbar are the exact same
  // three calls the ResizeObserver path elsewhere in this file already
  // makes on a real resize -- a metrics change deserves the same re-sync
  // even though the container's own outer bounding box doesn't move, so
  // these overlays don't paint from a stale pre-change measurement either.
  useEffect(() => {
    const view = viewRef.current;
    if (view) {
      view.requestMeasure();
      if (lineHeightPx > 0) {
        const scroller = view.scrollDOM;
        const maxScrollTopPx = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
        const quantizedScrollTopPx = Math.max(
          0,
          Math.min(maxScrollTopPx, Math.round(scroller.scrollTop / lineHeightPx) * lineHeightPx),
        );
        if (Math.abs(quantizedScrollTopPx - scroller.scrollTop) > 0.01) {
          scroller.scrollTop = quantizedScrollTopPx;
        }
      }
    }
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

    // Lead #4 hardening (docs/cm6-parity-hardening-plan.md, "attempt 9"): a
    // single generation-guarded async follow-up, not a blind multi-frame
    // watch loop (that was attempt 6, and it made things worse -- see the
    // doc). Direct instrumentation proved CM6 sometimes finishes settling a
    // height-map revision *after* this reconcile already read and wrote a
    // fully normal, correct value: one rAF later, with no further keystroke
    // at all, CM6 moves scrollTop AND the analytical caret position by a
    // large, matching delta on its own (confirmed live: the caret's real
    // on-screen position, read via the DOM selection Range's own
    // getBoundingClientRect().top, drifts by exactly this event and nothing
    // else -- an eliminated-baseline 51-102/771 real visible anomalies
    // across every document shape and scale tested became 0 with this fix
    // in place). This reconcile cannot see the revision at write time -- it
    // hasn't happened yet -- but it CAN check for it one frame later and, if
    // it happened, redo the same cage math against the now-current truth
    // (not re-assert the old, now-stale target, which is what made attempt 6
    // fight CM6 instead of accepting its revision). reconcileGeneration
    // guards against acting on a stale snapshot if a real new keystroke (a
    // fresh reconcileCagedScroll call) already happened before the check
    // fires.
    let reconcileGeneration = 0;

    const reconcileCagedScroll = (view: EditorView) => {
      reconcileGeneration += 1;
      const myGeneration = reconcileGeneration;
      const scroller = view.scrollDOM;
      const domSelection = window.getSelection();
      if (!domSelection || domSelection.rangeCount === 0) return;

      const lineHeightPxNow = lineHeightPxRef.current;
      const scrollerRect = scroller.getBoundingClientRect();
      const caretRect = readSelectionRect(domSelection, lineHeightPxNow, view.contentDOM);
      if (!caretRect) return;

      const caretTopInScroll = resolveCM6CaretTopInScroll(
        caretRect,
        scrollerRect.top,
        scroller.scrollTop,
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

      const scrollTopAfterWrite = scroller.scrollTop;
      requestAnimationFrame(() => {
        if (reconcileGeneration !== myGeneration) return;
        if (Math.abs(scroller.scrollTop - scrollTopAfterWrite) > 0.01) {
          reconcileCagedScroll(view);
        }
      });
    };

    // Scroll-to-selection for discrete jumps (search-hit navigation,
    // go-to-start/end -- see applySnapshot's `selectionScrollBehavior`
    // handling), as opposed to reconcileCagedScroll's minimal-movement
    // "keep the caret inside the cage" behavior for typing/arrow-key
    // navigation. Ported from Editor.tsx's own centerSelectionInCagedMiddle:
    // centers the selection in the middle of the cage (topBoundaryPx..
    // clientHeight-bottomBoundaryPx) rather than snapping it to the near
    // edge. This matters specifically for large documents: CM6 virtualizes
    // layout, so a jump to a distant, not-yet-measured position is computed
    // against estimated block heights that can be off by enough to matter.
    // Landing at the cage edge leaves zero slack -- any underestimate pushes
    // the target clean off-screen, so the caller sees the jump undershoot
    // and needs a second or third click to actually arrive. Landing in the
    // center leaves roughly half a viewport of slack in both directions, so
    // the same estimate error is very unlikely to fully miss.
    // Uses the same generation-guarded settle loop as reconcileCagedScroll
    // as its sanity check: after writing scrollTop, re-measure one frame
    // later and, if CM6 revised its height map (moving scrollTop and/or the
    // caret's real position on its own -- see reconcileCagedScroll's own
    // doc comment above), redo the same centering math against the
    // now-current truth and try again. Self-terminating: it only recurses
    // while scrollTop is still actually changing between frames, so it
    // costs nothing once the position has settled.
    let selectionJumpReconcileGeneration = 0;

    /**
     * Where the current selection sits in document coordinates, taken from
     * CM6's own line layout rather than from the DOM selection.
     *
     * The DOM-selection path this backs up only exists while the editor is
     * focused -- an unfocused editor has no selection range at all, and
     * `readSelectionRect` correctly returns null for it. That is not an edge
     * case for programmatic jumps: following an anchor/TOC link puts focus
     * on the link that was clicked, so the jump that lands right after it
     * measured nothing and silently declined to scroll, leaving the note
     * sitting whereverit already was. CM6 knows a position's geometry
     * whether or not anything is focused, and knows it for lines it hasn't
     * rendered, so this answers in exactly the cases the DOM cannot.
     */
    const resolveSelectionBlockInScroll = (view: EditorView): { topInScroll: number; heightPx: number } | null => {
      const head = view.state.selection.main.head;
      if (head < 0 || head > view.state.doc.length) return null;
      const block = view.lineBlockAt(head);
      if (!block) return null;
      // `block.top` is relative to the document's own start; the scroll
      // coordinate space this function's callers use starts at the
      // scroller's content origin, which the content element's own offset
      // (padding, any decorations above the doc) sits inside.
      const contentOffsetInScroll =
        view.contentDOM.getBoundingClientRect().top
        - view.scrollDOM.getBoundingClientRect().top
        + view.scrollDOM.scrollTop;
      return { topInScroll: block.top + contentOffsetInScroll, heightPx: block.height };
    };

    /**
     * Places the selection in the caged middle ('center') or at the top of the
     * caged area ('top'), one line below the boundary. 'top' is for jumps whose
     * target is a heading -- see EditorSelectionScrollBehavior.
     */
    const reconcileSelectionJumpScroll = (view: EditorView, instant = false, align: 'center' | 'top' = 'center') => {
      selectionJumpReconcileGeneration += 1;
      const myGeneration = selectionJumpReconcileGeneration;
      const scroller = view.scrollDOM;
      const lineHeightPxNow = lineHeightPxRef.current;
      const scrollerRect = scroller.getBoundingClientRect();

      // Only this editor's OWN selection may be measured. window.getSelection()
      // is a document-wide singleton, and readSelectionRect measures whatever
      // range it is handed -- so following a link measures the range the click
      // left behind in the preview pane's own DOM, producing a rect from an
      // unrelated element that resolves to a target at or below zero. The jump
      // then lands at the top of the document instead of on its target.
      //
      // This hid behind the "no selection at all" fallback below: the first
      // jump of a session works, because an editor that has never been focused
      // has no range and correctly falls through to the layout path. Every
      // jump after it measures the stale foreign range instead. The layout
      // path is wrap-aware, focus-independent, and answers for lines CM6 has
      // not rendered yet, so it is simply the right answer whenever the DOM's
      // selection is not ours.
      const domSelection = window.getSelection();
      const isOwnSelection = domSelection !== null
        && domSelection.rangeCount > 0
        && domSelection.anchorNode !== null
        && view.contentDOM.contains(domSelection.anchorNode);
      const selectionRect = isOwnSelection
        ? readSelectionRect(domSelection as Selection, lineHeightPxNow, view.contentDOM)
        : null;

      let selectionTopInScroll: number;
      let selectionHeightPx: number;

      if (selectionRect) {
        selectionTopInScroll = resolveCM6CaretTopInScroll(
          selectionRect,
          scrollerRect.top,
          scroller.scrollTop,
        );
        selectionHeightPx = Math.max(lineHeightPxNow, selectionRect.bottom - selectionRect.top);
      } else {
        const block = resolveSelectionBlockInScroll(view);
        if (!block) return;
        selectionTopInScroll = block.topInScroll;
        selectionHeightPx = Math.max(lineHeightPxNow, block.heightPx);
      }
      const selectionCenterInScroll = selectionTopInScroll + (selectionHeightPx / 2);

      const middleTopPx = topBoundaryPxRef.current;
      const middleBottomPx = Math.max(middleTopPx + lineHeightPxNow, scroller.clientHeight - bottomBoundaryPxRef.current);
      const middleCenterPx = (middleTopPx + middleBottomPx) / 2;

      const maxScrollTopPx = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
      const rawTargetScrollTopPx = align === 'top'
        ? selectionTopInScroll - middleTopPx - lineHeightPxNow
        : selectionCenterInScroll - middleCenterPx;
      const targetScrollTopPx = Math.max(
        0,
        Math.min(maxScrollTopPx, Math.round(rawTargetScrollTopPx / lineHeightPxNow) * lineHeightPxNow),
      );

      if (Math.abs(targetScrollTopPx - scroller.scrollTop) > 0.01) {
        if (instant) {
          // Land with no animation -- and cancel any in-flight one first: a
          // curve scroll recomputes scrollTop from its own captured start and
          // target on every frame, so a write landing mid-flight is erased on
          // the next one.
          cancelQuantizedSmoothScroll(scroller);
          const previousScrollBehavior = scroller.style.scrollBehavior;
          scroller.style.scrollBehavior = 'auto';
          scroller.scrollTop = targetScrollTopPx;
          scroller.style.scrollBehavior = previousScrollBehavior;
        } else {
          scrollToQuantizedSmooth(scroller, targetScrollTopPx, { lineHeightPx: lineHeightPxNow });
        }
      }

      const scrollTopAfterWrite = scroller.scrollTop;
      requestAnimationFrame(() => {
        if (selectionJumpReconcileGeneration !== myGeneration) return;
        if (Math.abs(scroller.scrollTop - scrollTopAfterWrite) > 0.01) {
          reconcileSelectionJumpScroll(view, instant, align);
        }
      });
    };
    reconcileSelectionJumpScrollRef.current = reconcileSelectionJumpScroll;

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

    // Wrap-boundary caret-assoc fix (docs/cm6-parity-hardening-plan.md,
    // "wrap-boundary caret assoc" bug). CM6's own default text-insertion
    // path (EditorState.replaceSelection, what handles every ordinary
    // keystroke) always produces a collapsed cursor via
    // `EditorSelection.cursor(pos)` -- no assoc argument, so it defaults to
    // 0 ("no preference"). CM6's own correction for a cursor that lands
    // exactly on a soft-wrap boundary (view.docView.enforceCursorAssoc(),
    // gated in @codemirror/view's ViewState.update on the selection's assoc
    // being truthy) therefore never engages for typing -- only for
    // navigation, since moveByChar/moveVisually (what arrow keys use)
    // always sets a real, nonzero assoc. Left unenforced, the *native*
    // browser selection is free to land on whichever side of the boundary
    // Chromium's own internal (unqueryable) affinity picks, including the
    // old, now-wrapped-away row -- which can render partially/fully
    // off-screen and drag the scroller's own scrollLeft along with it, even
    // though this app never intentionally scrolls the editor horizontally
    // (line-wrapping is always on; see this file's own EditorView theme
    // comment on .cm-scroller's overflowX:hidden).
    let wrapBoundaryAssocFixGeneration = 0;

    const reconcilePasteScroll = (view: EditorView, viewportOffsetPx: number) => {
      const scroller = view.scrollDOM;
      const domSelection = window.getSelection();
      if (!domSelection || domSelection.rangeCount === 0) return;

      const lineHeightPxNow = lineHeightPxRef.current;
      const scrollerRect = scroller.getBoundingClientRect();
      const caretRect = readSelectionRect(domSelection, lineHeightPxNow, view.contentDOM);
      if (!caretRect) return;

      const caretTopInScroll = resolveCM6CaretTopInScroll(
        caretRect,
        scrollerRect.top,
        scroller.scrollTop,
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

    // Originally mirrored ContractBridgePlugin.tsx's (Lexical) resolveNextScope
    // exactly; now diverges by one step -- 'clause' (comma/pair-bounded
    // segment, see resolveClauseRange in ContractBridgeRangeUtils.ts) is a
    // CM6-only addition inserted between 'word' and 'sentence'. See the
    // contextmenu handler below.
    const resolveNextRightClickScope = (current: SelectionScope): SelectionScope => {
      if (current === 'word') return 'clause';
      if (current === 'clause') return 'sentence';
      if (current === 'sentence') return 'line';
      if (current === 'line') return 'block';
      return 'block';
    };

    const extensions: Extension[] = [
      history(),
      keymap.of([...CM6_DEFAULT_KEYMAP_WITHOUT_ALT_ARROW, ...historyKeymap]),
      lineTokenPlugin,
      EditorView.lineWrapping,
      readOnlyCompartmentRef.current.of(EditorView.editable.of(!editorReadOnly)),
      spellCheckCompartmentRef.current.of(EditorView.contentAttributes.of({ class: 'editor-text', spellcheck: String(spellCheckEnabled) })),
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
      // Spellcheck is wired through a Compartment below so toggles can
      // reconfigure the live editor without remounting.
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

          if ((event.key === 'ArrowUp' || event.key === 'ArrowDown') && event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey) {
            // Ctrl+Up/Down jumps to the nearest flagged line off the top/
            // bottom of the currently rendered gutter range -- the keyboard
            // equivalent of clicking the gutter's own up/down-arrow flag
            // boxes (see navigateToFlaggedLine). Only claimed when there's
            // actually somewhere to jump to, so with no flags nearby this
            // falls through to whatever Ctrl+Up/Down would otherwise do.
            const acted = navigateToFlaggedLineRef.current?.(event.key === 'ArrowUp' ? 'up' : 'down') ?? false;
            if (acted) {
              event.preventDefault();
              return true;
            }
          }

          if (event.key === 'PageUp' || event.key === 'PageDown') {
            // Ported from CagedScrollPlugin.tsx's own PageUp/PageDown
            // handling -- claimed here (Prec.highest, same as Tab/Enter
            // above) rather than left to @codemirror/commands' defaultKeymap,
            // which binds these to its own cursorPageUp/cursorPageDown
            // (cursor movement, not the app's own quantized page-scroll feel).
            pendingCageIntent = false;
            event.preventDefault();
            if (isEditScrollInteractionBlocked()) {
              pageKeysHeld.delete(event.key);
              clearPageContinuousHandoff();
              stopPageContinuousScroll();
              return true;
            }
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
            // anything. Suppress the generic text-change click that follows
            // the tab transform, because the dedicated tab burst is already
            // the intended sound for this keystroke.
            suppressNextPlainTypingSoundOnce();
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
          lastPhysicalKeyCodeRef.current = event.code;
          if (debugInputLagEnabled) {
            debugLastKeydownAtRef.current = performance.now();
            debugLastKeyRef.current = event.key;
          }
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
        // Right-click selection-scope cycling (word -> clause -> sentence ->
        // line -> block on repeated right-clicks in the same spot) -- ported
        // from ContractBridgePlugin.tsx's (Lexical) handleContextMenu, with
        // 'clause' since added as a CM6-only step (see
        // resolveNextRightClickScope above). Reuses
        // resolveScopeRange/isSameRange unchanged (pure text+offset
        // functions, no Lexical dependency); only the "read current
        // selection/offset" and "apply the result" steps are CM6-native
        // (posAtCoords, view.dispatch) instead of Lexical's DOM-Range
        // plumbing. Dispatching only `selection` (no `changes`) is picked up
        // by the shared updateListener's `update.selectionSet` branch below,
        // which already handles emitting onSelectionChange and scheduling
        // the caret/highlight redraw -- no need to duplicate that here.
        contextmenu: (event, view) => {
          event.preventDefault();

          const clickOffset = view.posAtCoords({ x: event.clientX, y: event.clientY });
          if (clickOffset === null) return true;

          // Full-document string, same as Lexical's readCanonicalRootText
          // call at this same call site -- resolveScopeRange's text scan
          // needs it. O(document length), but this only runs on a
          // user-initiated right-click, not per keystroke, so it doesn't
          // compete with the hot paths this file otherwise guards closely.
          const text = view.state.doc.toJSON().join('\n');
          const currentSelection = toSelectionState(view.state.selection.main);

          const priorCycle = rightClickCycleRef.current;
          const clickedInsideCurrentSelection = !currentSelection.isCollapsed
            && clickOffset >= currentSelection.start
            && clickOffset < currentSelection.end;
          const canAdvanceScope = priorCycle !== null
            && clickedInsideCurrentSelection
            && priorCycle.start === currentSelection.start
            && priorCycle.end === currentSelection.end;

          const scope: SelectionScope = canAdvanceScope && priorCycle !== null
            ? (priorCycle.retrySameScope ? priorCycle.scope : resolveNextRightClickScope(priorCycle.scope))
            : 'word';

          let resolvedScope = scope;
          let nextRangeResult = resolveScopeRange(resolvedScope, text, clickOffset, currentSelection);
          let nextRange = nextRangeResult.range;
          let nextRangeIsPairAwareAdjusted = nextRangeResult.isPairAwareAdjustment;

          // Avoid consuming clicks on no-op intermediate levels, e.g. sentence == line.
          if (canAdvanceScope) {
            const currentRange = { start: currentSelection.start, end: currentSelection.end };

            while (isSameRange(nextRange, currentRange) && resolvedScope !== 'block') {
              if (nextRangeResult.isPairAwareAdjustment) {
                break;
              }

              resolvedScope = resolveNextRightClickScope(resolvedScope);
              nextRangeResult = resolveScopeRange(resolvedScope, text, clickOffset, currentSelection);
              nextRange = nextRangeResult.range;
              nextRangeIsPairAwareAdjusted = nextRangeResult.isPairAwareAdjustment;
            }
          }

          view.dispatch({ selection: EditorSelection.single(nextRange.start, nextRange.end) });

          rightClickCycleRef.current = {
            scope: resolvedScope,
            start: nextRange.start,
            end: nextRange.end,
            retrySameScope: nextRangeIsPairAwareAdjusted,
          };

          return true;
        },
        // Left-click resets the scope cycle so the next right-click starts
        // fresh at 'word' -- mirrors ContractBridgePlugin.tsx's
        // handleMouseDown. (canAdvanceScope's own currentSelection-match
        // check above would likely catch most cases on its own since a
        // plain left-click collapses the selection, but this matches the
        // Lexical behavior exactly rather than relying on that as an
        // implicit side effect.)
        mousedown: (event, view) => {
          if (event.button === 0) {
            rightClickCycleRef.current = null;

            // Checkbox caret-click toggle: only fires when the click lands
            // exactly on the caret's own current offset (i.e. the caret was
            // already sitting there, not being moved by this click) -- see
            // ChecklistCaretClickTogglePolicy.ts for the narrow markdown-
            // checkbox pattern match.
            const toggleCallback = bindingsRef.current?.onCaretClickTransform;
            if (toggleCallback) {
              const currentSelection = view.state.selection.main;
              if (currentSelection.from === currentSelection.to) {
                const clickOffset = view.posAtCoords({ x: event.clientX, y: event.clientY });
                if (clickOffset === currentSelection.head) {
                  const text = previousTextRef.current;
                  const selection = toSelectionState(currentSelection);
                  const next = toggleCallback({ text, selection });
                  if (next) {
                    event.preventDefault();
                    applyTransformResult(view, text, next);
                    return true;
                  }
                }
              }
            }
          }
          return false;
        },
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
                caretRect,
                scrollerRect.top,
                scroller.scrollTop,
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
        let debugKeydownAt: number | null = null;
        const debugCheckpoint = (label: string) => {
          if (debugKeydownAt === null) return;
          console.log(`[input-lag]   +${(performance.now() - debugKeydownAt).toFixed(1)}ms  ${label}`);
        };
        if (debugInputLagEnabled && update.docChanged) {
          const keydownAt = debugLastKeydownAtRef.current;
          const key = debugLastKeyRef.current;
          debugLastKeydownAtRef.current = null;
          if (keydownAt !== null) {
            debugKeydownAt = keydownAt;
            const commitMs = performance.now() - keydownAt;
            const docLen = update.state.doc.length;
            // Exposed so onTextChange (useEditorSectionMount.ts, called
            // synchronously below via bindingsRef) can log its own elapsed
            // time against the same origin timestamp -- bisects where the
            // gap between commit and paint actually goes.
            (window as unknown as { __thockdownDebugKeydownAt?: number }).__thockdownDebugKeydownAt = keydownAt;
            debugCheckpoint(`commit (commitMs=${commitMs.toFixed(1)}, docLen=${docLen})`);
            requestAnimationFrame(() => {
              const paintMs = performance.now() - keydownAt;
              console.log(`[input-lag] key=${JSON.stringify(key)} docLen=${docLen} commitMs=${commitMs.toFixed(1)} paintMs=${paintMs.toFixed(1)}`);
            });
          }
        }
        if (update.docChanged) {
          // Exact position remap via CM6's own ChangeSet.mapPos -- the same
          // mechanism CM6 uses internally to reposition marks/decorations/
          // selections across an edit, not a heuristic. Runs on every
          // docChanged transaction (cheap: O(flag count), no DOM/DB work) so
          // flagsByLineRef (read by updateLineLayout, thus by rendering) is
          // never stale; the DB write itself is debounced separately below.
          if (flagPositionsRef.current.size > 0) {
            const remappedPositions = new Map<number, number>();
            for (const [id, pos] of flagPositionsRef.current) {
              remappedPositions.set(id, update.changes.mapPos(pos));
            }
            flagPositionsRef.current = remappedPositions;
            scheduleReviewFlagSync();
          }
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
          debugCheckpoint('after doc.toJSON().join');
          const previousText = previousTextRef.current;
          const nextSelection = toSelectionState(update.state.selection.main);
          previousTextRef.current = nextText;
          previousSelectionRef.current = nextSelection;

          // The note-switch hydration effect's own dispatches are real
          // `docChanged` transactions too (even a full replace with
          // identical resulting content still counts), so without this
          // check they'd be indistinguishable here from an actual
          // keystroke -- see ProgrammaticHydrationAnnotation's doc comment.
          const isProgrammaticHydration = update.transactions.some((tr) => tr.annotation(ProgrammaticHydrationAnnotation));

          const physicalKeyCode = lastPhysicalKeyCodeRef.current ?? undefined;
          lastPhysicalKeyCodeRef.current = null;

          const event: EditorTextChangeEvent = {
            source: isProgrammaticHydration ? 'initial-load' : 'user-input',
            text: nextText,
            previousText,
            selection: nextSelection,
            physicalKeyCode,
          };
          debugCheckpoint('before bindings.onTextChange');
          bindingsRef.current?.onTextChange?.(event);
          debugCheckpoint('after bindings.onTextChange');
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
          debugCheckpoint('after scheduleCaretUpdate');
          scheduleSelectionHighlightUpdate();
          debugCheckpoint('after scheduleSelectionHighlightUpdate');
        }
        if (update.docChanged) {
          syncCustomScrollbar();
          debugCheckpoint('after syncCustomScrollbar');
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
        // Wrap-boundary caret-assoc fix -- see wrapBoundaryAssocFixGeneration's
        // own doc comment above for the full "why." Deferred a microtask
        // (not dispatched synchronously here) since re-dispatching from
        // inside the updateListener that produced this very update is a
        // known CM6 footgun -- same reason reconcileCagedScroll/
        // reconcilePasteScroll above are triggered via a flag-and-reconcile
        // pattern rather than dispatching in place. A microtask (not
        // requestAnimationFrame, unlike those two) is enough here: this
        // fix doesn't need to wait for a real layout settle, only to be
        // outside the current sync callstack, and firing before paint
        // avoids a visible one-frame flash of the wrong side.
        // Generation-guarded so a second keystroke (or navigation) that
        // lands before the microtask runs supersedes it rather than
        // stomping on wherever the selection ended up next.
        if (update.docChanged) {
          const producedSelection = update.state.selection.main;
          if (producedSelection.empty && producedSelection.assoc === 0) {
            const targetPos = producedSelection.head;
            wrapBoundaryAssocFixGeneration += 1;
            const myGeneration = wrapBoundaryAssocFixGeneration;
            queueMicrotask(() => {
              if (wrapBoundaryAssocFixGeneration !== myGeneration) return;
              const currentView = viewRef.current;
              if (!currentView) return;
              const currentSelection = currentView.state.selection.main;
              if (!currentSelection.empty || currentSelection.head !== targetPos || currentSelection.assoc !== 0) return;
              currentView.dispatch({ selection: EditorSelection.cursor(targetPos, 1) });
              wrapBoundaryAssocFixDispatchCountRef.current += 1;
            });
          }
        }
        debugCheckpoint('updateListener end (synchronous work done)');
      }),
    ];

    const view = new EditorView({
      state: EditorState.create({ doc: initialText, extensions }),
      parent: containerRef.current,
    });
    viewRef.current = view;
    lastHydratedNoteIdRef.current = noteId ?? null;
    setViewMountGeneration((generation) => generation + 1);

    if (debugCageStateEnabled) {
      (window as unknown as { __thockdownDebugCageState?: () => unknown }).__thockdownDebugCageState = () => {
        const head = view.state.selection.main.head;
        // TEMP, read-only (docs/cm6-parity-hardening-plan.md lead #4):
        // reaching into CM6's own internal, unexported viewState to inspect
        // its per-line height ESTIMATE (heightOracle.lineHeight) directly,
        // to check it against this app's real, known-correct row height --
        // a mismatch there is one candidate root cause for the height-map
        // revision that produces the reported scroll overshoot. Not a
        // public API (no type on EditorView exposes this); defensively cast
        // and optional-chained so a shape change on a future CM6 upgrade
        // degrades to `undefined` here, not a crash. Remove once the
        // investigation closes either way.
        const internalViewState = (view as unknown as {
          viewState?: { heightOracle?: { lineHeight?: number; charWidth?: number; textHeight?: number } };
        }).viewState;
        return {
          analyticalTop: view.lineBlockAt(head).top,
          scrollTop: view.scrollDOM.scrollTop,
          topBoundaryPx: topBoundaryPxRef.current,
          bottomBoundaryPx: bottomBoundaryPxRef.current,
          lineHeightPx: lineHeightPxRef.current,
          clientHeight: view.scrollDOM.clientHeight,
          scrollHeight: view.scrollDOM.scrollHeight,
          viewport: { from: view.viewport.from, to: view.viewport.to },
          oracleLineHeight: internalViewState?.heightOracle?.lineHeight ?? null,
          oracleCharWidth: internalViewState?.heightOracle?.charWidth ?? null,
          oracleTextHeight: internalViewState?.heightOracle?.textHeight ?? null,
          docLength: view.state.doc.length,
          docLines: view.state.doc.lines,
          selectionHead: head,
          selectionEmpty: view.state.selection.main.empty,
          // Added for the wrap-boundary caret-assoc bug
          // (docs/cm6-parity-hardening-plan.md) -- assoc has no public DOM
          // equivalent to read from outside CM6, so this debug hook is the
          // only way a live-browser check (or a human) can directly confirm
          // whether wrapBoundaryAssocFixGeneration's follow-up actually ran,
          // as opposed to inferring it indirectly from rendered geometry.
          // The raw assoc value itself is too fleeting to observe reliably
          // (see wrapBoundaryAssocFixDispatchCountRef's own doc comment) --
          // the dispatch counter is the reliable signal.
          selectionAssoc: view.state.selection.main.assoc,
          wrapBoundaryAssocFixDispatchCount: wrapBoundaryAssocFixDispatchCountRef.current,
        };
      };
    }

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
    // listener + buildViewport. Programmatic-vs-user provenance is resolved
    // by ScrollTransitionController.
    const handleScroll = () => {
      const classification = scrollTransitionControllerRef.current.classifyScrollEvent();
      const isProgrammatic = classification.isProgrammatic;
      bindingsRef.current?.onViewportChange?.({
        source: isProgrammatic ? 'programmatic' : 'user-input',
        origin: isProgrammatic ? 'programmatic' : 'scroll',
        transitionId: isProgrammatic ? classification.transitionId : undefined,
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
      if (isEditScrollInteractionBlocked()) {
        event.preventDefault();
        return;
      }
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
    // applySynchronousGutterRightPadding: called at every point this file
    // measures a fresh scroller width, right alongside setScrollerClientWidthPx
    // -- NOT only through the render-driven padding effect. That effect is
    // passive (runs after paint) and its input (scrollerClientWidthPx) only
    // updates once React processes the state update from setState below, so
    // there is a real window where the browser has already reflowed the
    // pane to its new width but contentDOM's paddingRight is still stale:
    // CM6 wraps text against that stale width for one visible frame, then
    // snaps to the corrected wrap the moment React catches up. Applying the
    // same formula (computeReviewGutterRightPx) directly to the DOM in the
    // exact callback that measured the new width closes that window --
    // found live as "characters next to the flag column jitter, wrap, then
    // revert" while dragging a pane divider narrower.
    const applySynchronousGutterRightPadding = (measuredWidthPx: number) => {
      view.contentDOM.style.paddingRight = `${computeReviewGutterRightPx(measuredWidthPx, cellWidthPxRef.current, showReviewFlagsRef.current)}px`;
    };

    const resizeObserver = new ResizeObserver(() => {
      scheduleCaretUpdateAfterResize();
      scheduleSelectionHighlightUpdate();
      setScrollerClientHeightPx(view.scrollDOM.clientHeight);
      const measuredWidthPx = view.scrollDOM.clientWidth;
      setScrollerClientWidthPx(measuredWidthPx);
      applySynchronousGutterRightPadding(measuredWidthPx);
    });
    resizeObserver.observe(view.scrollDOM);
    if (layerRef.current) resizeObserver.observe(layerRef.current);

    setScrollerClientHeightPx(view.scrollDOM.clientHeight);
    setScrollerClientWidthPx(view.scrollDOM.clientWidth);
    applySynchronousGutterRightPadding(view.scrollDOM.clientWidth);
    scheduleCaretUpdate();
    scheduleSelectionHighlightUpdate();

    // Mount hardening: intermittent "bad mount" reports showed cases where
    // the initial geometry pass still observed a transient 0/unstable
    // scroller height. Relying only on ResizeObserver to catch the first
    // stable size leaves a race where grid/text alignment and keyboard
    // scroll feel can start from stale geometry. Run a short bounded
    // post-mount settle loop to force a second/third read and measure pass.
    let initialGeometrySettleRafId: number | null = null;
    const initialGeometryTransitionId = beginScrollTransition('geometry-settle', {
      settleMs: 120,
      maxBlockMs: 900,
      blockUserInput: true,
    });
    const settleInitialGeometry = (attemptsLeft: number) => {
      if (!viewRef.current) return;
      extendScrollTransitionSettle(initialGeometryTransitionId, 120);
      const measuredHeight = view.scrollDOM.clientHeight;
      setScrollerClientHeightPx(measuredHeight);
      const measuredWidthPx = view.scrollDOM.clientWidth;
      setScrollerClientWidthPx(measuredWidthPx);
      applySynchronousGutterRightPadding(measuredWidthPx);
      view.requestMeasure();
      scheduleCaretUpdateAfterResize();
      scheduleSelectionHighlightUpdate();
      syncCustomScrollbar();

      if (measuredHeight <= 0 && attemptsLeft > 0) {
        initialGeometrySettleRafId = requestAnimationFrame(() => settleInitialGeometry(attemptsLeft - 1));
      } else {
        scrollTransitionControllerRef.current.forceComplete(initialGeometryTransitionId);
      }
    };
    initialGeometrySettleRafId = requestAnimationFrame(() => settleInitialGeometry(6));

    return () => {
      if (caretAnimationFrameRef.current !== null) {
        cancelAnimationFrame(caretAnimationFrameRef.current);
        caretAnimationFrameRef.current = null;
      }
      if (highlightAnimationFrameRef.current !== null) {
        cancelAnimationFrame(highlightAnimationFrameRef.current);
        highlightAnimationFrameRef.current = null;
      }
      if (initialGeometrySettleRafId !== null) {
        cancelAnimationFrame(initialGeometrySettleRafId);
        initialGeometrySettleRafId = null;
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
      reconcileSelectionJumpScrollRef.current = null;
      rightClickCycleRef.current = null;
    };
    // Deliberately mount-once: noteId/initialText changes are handled by the
    // hydration effect below (matching NoteTextHydrationPlugin's own
    // "patch, don't remount" discipline), not by tearing this effect down.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // editorReadOnly reconfiguration. Found live, not assumed: `extensions`
  // above bakes `EditorView.editable.of(!editorReadOnly)` into the one-time
  // `EditorState.create()` call in the mount effect, with no Compartment --
  // so without this effect, a *later* editorReadOnly change (e.g. switching
  // from a normal note into a read-only one without a remount, which this
  // component deliberately never does -- see "mount-once" above) would never
  // reach the live view at all, leaving the DOM's real `contenteditable`
  // stuck at whatever it was the instant this note's section first mounted.
  // Confirmed via a live Playwright check driving an actual note switch, not
  // just reasoned about. `spellCheckEnabled` has the exact same
  // mount-once-only gap one line below in `extensions` and is NOT fixed here
  // -- out of scope for this change, left as a separate, pre-existing
  // finding rather than folded in speculatively.
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({ effects: readOnlyCompartmentRef.current.reconfigure(EditorView.editable.of(!editorReadOnly)) });
  }, [editorReadOnly]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: spellCheckCompartmentRef.current.reconfigure(
        EditorView.contentAttributes.of({ class: 'editor-text', spellcheck: String(spellCheckEnabled) }),
      ),
    });
  }, [spellCheckEnabled]);

  // Note-switch hydration: replace the whole document when noteId changes.
  // For a genuine note switch this stays a full replace (Slice-1
  // simplification -- NOT the prefix/suffix patch NoteTextHydrationPlugin
  // does, since CM6's own Text.replace() already avoids that function's
  // entire reason for existing performance-wise; see the Phase 1 audit).
  //
  // For the *same* note, this effect can still fire on a transient mismatch
  // between `initialText` (React's view, sourced from activeNoteText) and
  // CM6's own live document -- this is expected, not a "the note changed
  // under us" event, and critically has no restore-snapshot mechanism
  // running afterward the way a real note switch does. The previous version
  // unconditionally did a full 0..length replace plus an explicit
  // `selection: EditorSelection.cursor(0)` for *both* cases, which forced
  // the caret to document start on every one of these transient mismatches
  // too -- a live, reported "caret jumps to 0 mid-typing" bug, not just a
  // cosmetic one, since it also discarded the positional correspondence a
  // real edit needs. Fixed by branching: only the genuine-note-switch path
  // resets the caret (matching NoteTextHydrationPlugin.tsx's own
  // `SKIP_SELECTION_FOCUS_TAG` discipline -- never explicitly move the caret
  // outside a real note switch) and only it does the O(1)-relative-to-input
  // full replace; the same-note path computes a minimal prefix/suffix-
  // trimmed change instead of a full replace, letting CM6's own
  // selection-through-changes mapping preserve the caret automatically --
  // a full 0..length replace has no positional correspondence for CM6 to
  // map an existing selection through, so merely omitting the explicit
  // `selection` field would not have been enough on its own.
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    // toJSON().join('\n') instead of toString() -- same fix, same reason as
    // the updateListener's own text production above: this effect is keyed
    // on `initialText`, which changes every keystroke (mirrors
    // NoteTextHydrationPlugin.tsx's own hydration-check effect on the
    // Lexical side), so toString()'s ConsString-then-flatten-on-compare
    // cost would otherwise be paid here too, every keystroke.
    const currentText = view.state.doc.toJSON().join('\n');
    const isNoteSwitch = lastHydratedNoteIdRef.current !== (noteId ?? null);
    if (!isNoteSwitch && currentText === initialText) return;
    lastHydratedNoteIdRef.current = noteId ?? null;

    const debugSwitchStartedAt = debugInputLagEnabled && isNoteSwitch ? performance.now() : null;

    if (isNoteSwitch) {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: initialText },
        selection: EditorSelection.cursor(0),
        annotations: ProgrammaticHydrationAnnotation.of(true),
      });
    } else {
      view.dispatch({
        changes: computeMinimalTextReplacement(currentText, initialText),
        annotations: ProgrammaticHydrationAnnotation.of(true),
      });
    }
    previousTextRef.current = initialText;

    if (debugSwitchStartedAt !== null) {
      requestAnimationFrame(() => {
        const paintMs = performance.now() - debugSwitchStartedAt;
        console.log(`[input-lag] note-switch noteId=${noteId} docLen=${initialText.length} paintMs=${paintMs.toFixed(1)}`);
      });
    }
  }, [noteId, initialText, debugInputLagEnabled]);

  // Review-flag load on note switch. Declared textually AFTER the hydration
  // effect above so React runs it after: it needs view.state.doc to already
  // hold the NEW note's text (to resolve each flag's stored lineNumber to a
  // document position), and effects run in declaration order within a
  // commit. Cancels any pending debounced sync from the outgoing note first
  // -- otherwise a sync queued just before the switch would still fire
  // ~800ms later against noteIdRef.current (already repointed to the new
  // note by then), silently writing the old note's remapped flags onto the
  // new note.
  useEffect(() => {
    if (reviewFlagSyncTimeoutRef.current !== null) {
      window.clearTimeout(reviewFlagSyncTimeoutRef.current);
      reviewFlagSyncTimeoutRef.current = null;
    }
    noteIdRef.current = noteId ?? null;
    flagPositionsRef.current = new Map();
    setReviewFlags([]);
    if (!noteId) return;

    let cancelled = false;
    window.thockdownReviewFlags?.listReviewFlags(noteId).then((flags) => {
      if (cancelled) return;
      const view = viewRef.current;
      const positions = new Map<number, number>();
      if (view) {
        const doc = view.state.doc;
        for (const flag of flags) {
          const clampedLine = Math.max(1, Math.min(flag.lineNumber, doc.lines));
          const lineObj = doc.line(clampedLine);
          if (hashLineText(lineObj.text) !== flag.lineHash) {
            // Cold-load sanity check failed: no live ChangeSet history exists
            // to resolve this exactly (see runReviewFlagSync's doc comment),
            // so this is surfaced rather than silently trusted or dropped --
            // it still displays at its last persisted line, and the next
            // edit's remap will re-derive a correct position going forward.
            console.warn(`[review-flags] note ${noteId} flag ${flag.id}: stored line ${flag.lineNumber} no longer matches its saved hash -- displaying at last-known position.`);
          }
          positions.set(flag.id, lineObj.from);
        }
      }
      flagPositionsRef.current = positions;
      setReviewFlags(flags);
    }).catch(() => {});

    return () => { cancelled = true; };
  }, [noteId]);

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
      // The content's own paddingTop/paddingBottom follow the boundary
      // reactively (the padding effect is keyed on topBoundaryVisualPx/
      // bottomBoundaryPxDisplay), so the real first/last line visibly moves
      // every drag frame -- but the gutter's row positions are plain JS
      // state, computed once per explicit recompute call, not something
      // that just follows a CSS change. Without this, dragging the top
      // handle down moved the real content but left every gutter row
      // frozen at its pre-drag position until some unrelated event (a
      // keystroke, a scroll) happened to trigger the next recompute.
      scheduleSelectionHighlightUpdate();
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
    if (isEditScrollInteractionBlocked()) return;

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
    if (isEditScrollInteractionBlocked()) return;

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
    if (isEditScrollInteractionBlocked()) return;

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
        // selection below actually lands. Skipped entirely for `quiet`
        // re-corrections (see the field's own doc comment in
        // EditorContract.ts) -- those must move scrollTop without re-opening
        // the input-blocking transition or the caret-suppression window.
        const isSnapshotRestore = Boolean(snapshot.viewport || snapshot.viewportLines || snapshot.selection);
        const isQuiet = snapshot.quiet === true;
        const snapshotTransitionId = isSnapshotRestore && !isQuiet
          ? beginScrollTransition('snapshot-restore', {
            settleMs: 200,
            maxBlockMs: 1200,
            blockUserInput: true,
            transitionId: snapshot.transitionId,
          })
          : null;
        if (isSnapshotRestore && !isQuiet) {
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
            const targetTop = Math.max(0, nextViewport.scrollTopPx);
            if (Math.abs(view.scrollDOM.scrollTop - targetTop) > 0.5) {
              if (snapshotTransitionId !== null) {
                registerProgrammaticScrollEvent(snapshotTransitionId);
                extendScrollTransitionSettle(snapshotTransitionId, 200);
              }
            }
            view.scrollDOM.scrollTo({ top: targetTop, behavior: 'auto' });
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
          const targetTop = Math.max(0, Math.round(snapshot.viewportLines.scrollTopLines) * lineHeightPxRef.current);
          if (Math.abs(view.scrollDOM.scrollTop - targetTop) > 0.5) {
            if (snapshotTransitionId !== null) {
              registerProgrammaticScrollEvent(snapshotTransitionId);
              extendScrollTransitionSettle(snapshotTransitionId, 200);
            }
          }
          view.scrollDOM.scrollTo({
            top: targetTop,
            behavior: 'auto',
          });
          setHasViewportLines(true);
        }

        if (snapshot.selection) {
          const docLength = view.state.doc.length;
          const anchor = Math.max(0, Math.min(docLength, snapshot.selection.anchor));
          const focus = Math.max(0, Math.min(docLength, snapshot.selection.focus));
          view.dispatch({ selection: EditorSelection.single(anchor, focus) });

          // Scroll the new selection into the caged middle -- mirrors
          // Editor.tsx's old centerSelectionInCagedMiddle call. Skipped when
          // the caller explicitly opted out (preserve-scroll, used by typing/
          // transform-replay call sites) or already drove scroll itself via
          // viewport/viewportLines above. CM6 applies transaction DOM changes
          // synchronously, so window.getSelection() is already current here.
          if (snapshot.selectionScrollBehavior !== 'preserve-scroll' && !snapshot.viewport && !snapshot.viewportLines) {
            reconcileSelectionJumpScrollRef.current?.(
              view,
              snapshot.selectionScrollBehavior === 'center-caged-instant' || snapshot.selectionScrollBehavior === 'top-caged-instant',
              snapshot.selectionScrollBehavior === 'top-caged-instant' ? 'top' : 'center',
            );
          }
        }

        if (isSnapshotRestore && !isQuiet) {
          if (snapshotRestoreRafRef.current !== null) {
            cancelAnimationFrame(snapshotRestoreRafRef.current);
          }
          snapshotRestoreRafRef.current = requestAnimationFrame(() => {
            snapshotRestoreRafRef.current = null;
            setIsSnapshotRestorePending(false);
            if (snapshotTransitionId !== null) {
              scrollTransitionControllerRef.current.forceComplete(snapshotTransitionId);
            }
          });
        }
      },
      // Both use CM6's own line-block layout info (lineBlockAt/
      // lineBlockAtHeight), which is computed analytically from line-height
      // metadata rather than measured off the live DOM -- correct
      // regardless of line-wrapping (a "source line" here is a logical text
      // line, which under EditorView.lineWrapping can span many visual
      // rows -- naively treating scrollTop-in-line-heights as a line number
      // is exactly the bug this replaces, see EditRestoreMath.ts) and
      // regardless of whether the target line is currently mounted/visible,
      // since CM6's own edit-mode rendering is viewport-bound.
      resolveSourceLineAtHeight(heightPx: number): number | null {
        const view = viewRef.current;
        if (!view) return null;
        const clampedHeight = Math.max(0, Math.min(view.contentHeight, heightPx));
        const block = view.lineBlockAtHeight(clampedHeight);
        return view.state.doc.lineAt(block.from).number - 1;
      },
      resolveHeightForSourceLine(sourceLine: number): number | null {
        const view = viewRef.current;
        if (!view) return null;
        const clampedLine1 = Math.max(1, Math.min(view.state.doc.lines, Math.round(sourceLine) + 1));
        const pos = view.state.doc.line(clampedLine1).from;
        return view.lineBlockAt(pos).top;
      },
      // CM6's own wrap-aware primitive, moveToLineBoundary(..., true), was
      // tried here first and rejected: it can only find a wrap point where
      // content already exists past the caret. While typing forward (the
      // overwhelmingly common case -- nothing typed yet past the caret),
      // there is no such point yet, so it silently degenerates to "boundary
      // equals caret", which reads as "at the far end of the row" on every
      // single keystroke regardless of true position -- confirmed live:
      // typing a fresh line pinned this at 1.0 for every press.
      //
      // Computed predictively instead, with no DOM measurement and no
      // dependency on content past the caret: this editor is a fixed-width
      // glyph grid (cellWidthPxRef -- see glyphWidthPx/cellWidthPx), so the
      // number of columns that fit before an automatic wrap is knowable
      // directly from the content box's pixel width. columnFromLineStart
      // mod columnsPerRow gives the column within whichever visual row the
      // caret is currently on, generalizing to a logical line that's
      // already wrapped many times over. This is an estimate, not an exact
      // mirror of the browser's real word-boundary wrapping (a long word
      // can trigger an earlier real wrap than this column count predicts,
      // drifting the two out of sync a little further into a long
      // paragraph) -- acceptable for an ambient spatial cue, not worth
      // reimplementing text layout for.
      resolveCaretHorizontalWrapRatio(): number | null {
        const view = viewRef.current;
        if (!view) return null;
        const cellWidthPxNow = cellWidthPxRef.current;
        if (!cellWidthPxNow || cellWidthPxNow <= 0) return null;
        const contentDOM = view.contentDOM;
        const paddingLeftPx = Number.parseFloat(contentDOM.style.paddingLeft) || 0;
        const paddingRightPx = Number.parseFloat(contentDOM.style.paddingRight) || 0;
        const usableWidthPx = Math.max(0, contentDOM.clientWidth - paddingLeftPx - paddingRightPx);
        const columnsPerRow = Math.max(1, Math.floor(usableWidthPx / cellWidthPxNow));
        const head = view.state.selection.main.head;
        const line = view.state.doc.lineAt(head);
        const columnFromLineStart = head - line.from;
        const columnWithinRow = columnFromLineStart % columnsPerRow;
        return Math.max(0, Math.min(1, columnWithinRow / columnsPerRow));
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
  }, [
    adapterRef,
    beginScrollTransition,
    extendScrollTransitionSettle,
    registerProgrammaticScrollEvent,
    topBoundaryLines,
    bottomBoundaryLines,
  ]);

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
  const topHandleTopPx = topBoundaryVisualPx - boundaryHandleSliverPx / 2;
  const topHandleHeightPx = boundaryHandleSliverPx;
  const bottomHandleBottomPx = bottomBoundaryVisualPx - boundaryHandleSliverPx / 2;
  const bottomHandleHeightPx = boundaryHandleSliverPx;
  const boundaryDragHandlesEnabled = isCtrlHeldForBoundaryDrag || isDraggingTop || isDraggingBottom;
  // Same top-anchored positioning as bottomZoneTopPx above, and for the same
  // reason: a `bottom: Npx` inset here would resolve against the overlay
  // layer's own live (possibly fractional, possibly one tick stale) box
  // height instead of this render's own scrollerClientHeightPx.
  const bottomHandleTopPx = Math.max(0, scrollerClientHeightPx - bottomHandleBottomPx - bottomHandleHeightPx);

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
              top: topBoundaryVisualPx,
              height: middleRegionZoneHeightPx,
              left: 0,
              right: 0,
              backgroundColor: 'var(--color-bg-regular)',
              zIndex: 2,
            }}
          />
          <div
            className="absolute left-0 right-0 pointer-events-none"
            style={{ top: 0, height: topBoundaryVisualPx, backgroundColor: 'var(--color-bg-leading)', zIndex: 2 }}
          />
          <div
            className="absolute left-0 right-0 pointer-events-none"
            style={{ top: bottomZoneTopPx, height: bottomBoundaryVisualPx, backgroundColor: 'var(--color-bg-trailing)', zIndex: 2 }}
          />
          <div
            className="absolute left-0 right-0 z-20 bg-transparent cursor-ns-resize"
            style={{ top: topHandleTopPx, height: topHandleHeightPx, pointerEvents: boundaryDragHandlesEnabled ? 'auto' : 'none' }}
            onWheel={forwardHandleWheelToScroller}
            onMouseDown={(e) => { e.preventDefault(); setIsDraggingTop(true); }}
          />
          <div
            className="absolute left-0 right-0 z-20 bg-transparent cursor-ns-resize"
            style={{ top: bottomHandleTopPx, height: bottomHandleHeightPx, pointerEvents: boundaryDragHandlesEnabled ? 'auto' : 'none' }}
            onWheel={forwardHandleWheelToScroller}
            onMouseDown={(e) => { e.preventDefault(); setIsDraggingBottom(true); }}
          />
        </>
      )}
      {/* Line-number + review-flag gutter -- reuses the exact grid units
          (cellWidthPx/lineHeightPx) and half-cell phase offset as the box
          grid above, so it reads as columns of that same grid rather than a
          separate visual system. Per-note-line entries (lineLayoutRows) come
          from updateLineLayout, CM6's own analytical line-block layout, kept
          in lockstep with everything else that resyncs on doc/viewport/
          scroll/resize. Deliberately NOT gated on hasViewportLines/fontReady
          the way the grid/boundary zones are -- reviewGutterLeftPx/RightPx
          are already 0 when off, so this renders nothing (not a wrong-pitch
          flash) until those are ready either way. */}
      {(showLineNumbers || showReviewFlags) && (reviewGutterLeftPx > 0 || reviewGutterRightPx > 0) && (
        <>
          {/* left starts at halfCellWidthPx, not 0 -- the same "infinity
              grid" breathing-room shift the content's own paddingLeft gets,
              so this column's boundaries land exactly on the grid's real box
              boundaries (backgroundPosition ${halfCellWidthPx}px below)
              instead of straddling two of them. Leaves the same half-box
              sliver at the container's own left edge that the un-gated
              content always has -- "cut-off boxes at the far edges expected
              and fine," same as the grid overlay's own doc comment. */}
          {reviewGutterLeftPx > 0 && (
            <div
              className="absolute pointer-events-none"
              style={{ top: 0, bottom: 0, left: halfCellWidthPx, width: reviewGutterLeftPx, backgroundColor: 'var(--color-gutter-bg)', zIndex: 2 }}
            />
          )}
          {reviewGutterFlagBoxWidthPx > 0 && scrollerClientWidthPx > 0 && (
            <div
              className="absolute pointer-events-none"
              style={{ top: 0, bottom: 0, left: reviewGutterRightLeftPx, width: reviewGutterFlagBoxWidthPx, backgroundColor: 'var(--color-gutter-bg)', zIndex: 2 }}
            />
          )}
          {/* Full-width row tint for every flagged line -- "all boxes that
              belong to that line," not just the flag-column cell. Sits below
              the grid-line overlays (zIndex 6/7) and text (10) so it reads as
              a background tint layered under the existing coloring, same
              tier as the top/bottom boundary zones (zIndex 2) but one step
              above them since a flag is a more specific, later-applied
              signal than the ambient zone color. */}
          {lineLayoutRows.map((row) => {
            const flag = flagsByLineRef.current.get(row.line);
            if (!flag) return null;
            return (
              <div
                key={`tint-${row.line}`}
                className="absolute pointer-events-none"
                style={{
                  top: row.topPx,
                  left: 0,
                  right: 0,
                  height: row.heightPx,
                  zIndex: 3,
                  backgroundColor: flag.severity === 'warning' ? 'var(--color-warning-line)' : 'var(--color-review-line)',
                }}
              />
            );
          })}
          {reviewGutterLeftPx > 0 && lineLayoutRows.map((row) => (
            <div
              key={`line-${row.line}`}
              className="absolute pointer-events-none select-none editor-text"
              style={{
                top: row.topPx,
                left: halfCellWidthPx,
                width: reviewGutterLeftPx,
                height: lineHeightPx,
                zIndex: 11,
                textAlign: 'right',
                lineHeight: `${lineHeightPx}px`,
                // editor-text's own text-shadow (the regular editor emboss)
                // is left untouched -- only the glyph color is forced
                // opaque, with the user's chosen color's alpha applied as
                // `opacity` on the whole element instead. Coloring by rgba
                // directly (or applying alpha to color and shadow
                // separately) let the two fade independently and looked
                // muddy/inconsistent; opacity composites the already-
                // shadowed glyph as one unit and fades that.
                color: 'var(--color-line-number)',
                opacity: 'var(--line-number-opacity)',
                // Smaller than the body text, deliberately overriding
                // editor-text's own font-size/letter-spacing/transform --
                // those three are calibrated for the full-size body glyph
                // width and wrong at a different size (see editor-text's
                // doc comment in index.css). lineNumberLetterSpacingPx/
                // lineNumberGlyphWidthPx above re-derive the same x-box
                // spacing trick against this smaller font's own measured
                // glyph width instead, so each digit still fills exactly
                // one cellWidthPx grid box like the body text's glyphs do.
                // The line-height above still spans the full row's box
                // height, so the smaller glyph still centers vertically
                // too.
                fontSize: `${lineNumberFontSizePx}px`,
                letterSpacing: `${lineNumberLetterSpacingPx}px`,
                transform: `translateX(${lineNumberLetterSpacingPx / 2}px)`,
              }}
            >
              {row.line}
            </div>
          ))}
          {reviewGutterFlagBoxWidthPx > 0 && scrollerClientWidthPx > 0 && lineLayoutRows.map((row) => {
            const flag = flagsByLineRef.current.get(row.line);
            return (
              <div
                key={`flag-${row.line}`}
                className="absolute editor-text select-none"
                style={{
                  top: row.topPx,
                  left: reviewGutterRightLeftPx,
                  width: reviewGutterFlagBoxWidthPx,
                  height: row.heightPx,
                  zIndex: 11,
                  textAlign: 'center',
                  lineHeight: `${lineHeightPx}px`,
                  cursor: 'pointer',
                }}
                onClick={() => handleGutterFlagClick(row.line)}
                onContextMenu={(event) => handleGutterFlagContextMenu(row.line, event)}
              >
                {flag ? (flag.severity === 'warning' ? '!' : '?') : ''}
              </div>
            );
          })}
          {/* Off-screen-flag indicators: two boxes pinned at fixed,
              editor-height-derived pixel slots -- the gutter's static top
              and bottom edge (see ReviewGutterEdgeLines) -- NOT tied to any
              particular rendered row, so they never jitter as CM6's
              virtualization window shifts (see updateLineLayout's own doc
              comment on why lineLayoutRows[0]/[length-1] was the wrong
              anchor). Rendered on top of (z-index above) whatever line
              happens to sit at that slot, replacing its normal flag-glyph
              content, whenever a flagged line exists past that edge. A
              click reuses the exact same centering pass a search-hit jump
              uses (navigateToFlaggedLine); if the edge slot's own line is
              already flagged, the click centers that line instead of
              skipping past it -- see navigateToFlaggedLine's own doc
              comment. */}
          {reviewGutterFlagBoxWidthPx > 0 && scrollerClientWidthPx > 0 && reviewGutterEdgeLines && reviewGutterHasFlagAboveTop && (
            <div
              ref={topFlagArrowElRef}
              className="absolute editor-text select-none"
              style={{
                top: reviewGutterEdgeLines.topBoxTopPx,
                left: reviewGutterRightLeftPx,
                width: reviewGutterFlagBoxWidthPx,
                height: lineHeightPx,
                zIndex: 12,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '0.7em',
                cursor: 'pointer',
                backgroundColor: 'var(--color-gutter-bg)',
                color: 'var(--color-editor-edit-text)',
              }}
              onClick={() => requestFlagJump('up', topFlagArrowElRef.current)}
              onContextMenu={(event) => handleGutterFlagContextMenu(reviewGutterEdgeLines.topLine, event)}
            >
              <span className="fa-solid fa-up-long" aria-hidden="true" />
            </div>
          )}
          {reviewGutterFlagBoxWidthPx > 0 && scrollerClientWidthPx > 0 && reviewGutterEdgeLines && reviewGutterHasFlagBelowBottom && (
            <div
              ref={bottomFlagArrowElRef}
              className="absolute editor-text select-none"
              style={{
                top: reviewGutterEdgeLines.bottomBoxTopPx,
                left: reviewGutterRightLeftPx,
                width: reviewGutterFlagBoxWidthPx,
                height: lineHeightPx,
                zIndex: 12,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '0.7em',
                cursor: 'pointer',
                backgroundColor: 'var(--color-gutter-bg)',
                color: 'var(--color-editor-edit-text)',
              }}
              onClick={() => requestFlagJump('down', bottomFlagArrowElRef.current)}
              onContextMenu={(event) => handleGutterFlagContextMenu(reviewGutterEdgeLines.bottomLine, event)}
            >
              <span className="fa-solid fa-down-long" aria-hidden="true" />
            </div>
          )}
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
            // No will-change: transform here, deliberately -- it promotes the
            // caret onto its own compositor layer, which is what drags the
            // whole editor into an anonymous squashed overlap layer that
            // renders black under the edge-fade mask at some border radii.
            // Same reason the transform above is 2D and the blink animates
            // background-color; see index.css's .thockdown-block-caret.
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
