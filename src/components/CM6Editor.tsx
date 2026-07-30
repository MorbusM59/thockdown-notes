import { useCallback, useEffect, useRef, useState } from 'react';
import { EditorState, EditorSelection, Prec, RangeSetBuilder } from '@codemirror/state';
import type { Extension } from '@codemirror/state';
import { EditorView, Decoration, ViewPlugin, keymap, type DecorationSet } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { buildTokenPresentation } from '../editor/MarkdownLineClassification';
import { typingSoundManager } from '../sound/TypingSoundManager';
import { readSelectionRect } from '../editor/CaretRect';
import { resolveCaretTopInScroll } from '../editor/CaretVisualPosition';
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
 * keyboard caret-refocus caging intent, and (this slice) paste sanitization
 * (HTML/emoji/control-char stripping, paragraph reconstruction, bullet
 * normalization, the Ctrl+Shift+V plain-paste escape hatch, and
 * preserve-caret-line scroll positioning). topBoundaryPx/bottomBoundaryPx
 * are still hardcoded to 0 -- the fixed-focus caging system's boundary UI
 * (padding zones, drag handles) and drag-selection scroll quantization are
 * the remaining slices.
 */
export interface CM6EditorProps {
  bindings?: EditorBindings;
  adapterRef?: React.MutableRefObject<EditorAdapter | null>;
  noteId?: string | null;
  initialText?: string;
  fontFamily: string;
  fontSizePx: number;
  lineHeightPx: number;
  cellWidthPx?: number;
  editorReadOnly?: boolean;
  spellCheckEnabled?: boolean;
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

/** Replaces the whole document with `next.text` and sets the selection to `next.selection` in one transaction -- the CM6 equivalent of ContractBridgePlugin.tsx's replaceEditorTextFromCanonical + scheduleTransformSelectionReplay, collapsed into a single atomic dispatch since CM6 (unlike Lexical) applies a change and its selection together without a deferred-DOM-commit race to work around. */
function applyTransformResult(view: EditorView, next: { text: string; selection: EditorSelectionState }): void {
  const anchor = Math.max(0, Math.min(next.text.length, next.selection.anchor));
  const focus = Math.max(0, Math.min(next.text.length, next.selection.focus));
  view.dispatch({
    changes: { from: 0, to: view.state.doc.length, insert: next.text },
    selection: EditorSelection.single(anchor, focus),
  });
}

const CARET_INSET_PX = 1;
const EMPTY_LINE_TOP_TOLERANCE_PX = 2;
const EDITOR_PAGE_CONTINUOUS_SCROLL_APEX_MULTIPLIER = CONTINUOUS_SCROLL_APEX_SPEED_MULTIPLIER;

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
  fontFamily,
  fontSizePx,
  lineHeightPx,
  cellWidthPx = 0,
  editorReadOnly = false,
  spellCheckEnabled = false,
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

  useEffect(() => {
    bindingsRef.current = bindings;
  }, [bindings]);

  useEffect(() => {
    lineHeightPxRef.current = lineHeightPx;
    cellWidthPxRef.current = cellWidthPx;
  }, [lineHeightPx, cellWidthPx]);

  // topBoundaryPx/bottomBoundaryPx are hardcoded 0 here -- the boundary UI
  // itself (padding zones, drag handles) is a later slice. Every other
  // field is real, matching Editor.tsx's own buildViewport shape.
  const buildViewport = (view: EditorView): EditorViewportState => ({
    topBoundaryPx: 0,
    bottomBoundaryPx: 0,
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

    const caretTopInScroll = resolveCaretTopInScroll({
      caretRect,
      scrollerRectTop: scrollerRect.top,
      scrollerScrollTop: scroller.scrollTop,
      rootEl: view.contentDOM,
      domSelection,
      rawText: view.state.doc.toString(),
      lineHeightPx: lineHeightPxRef.current,
    });

    const lineHeightPxNow = lineHeightPxRef.current;
    const quantizedRowTopInScroll = Math.round(caretTopInScroll / lineHeightPxNow) * lineHeightPxNow;
    const topInViewport = quantizedRowTopInScroll - scroller.scrollTop;

    if (topInViewport < 0 || topInViewport > scroller.clientHeight - lineHeightPxNow) {
      setCaretStyle(null);
      return;
    }

    const runtimeCellWidthPx = Math.max(1, cellWidthPxRef.current);
    const scrollerLeftInLayer = scrollerRect.left - caretLayerRect.left;
    const scrollerTopInLayer = scrollerRect.top - caretLayerRect.top;
    let absoluteLeft = caretRect.left - scrollerRect.left;
    absoluteLeft = Math.round(absoluteLeft / runtimeCellWidthPx) * runtimeCellWidthPx;

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
      const quantizedRowTopInScroll = Math.round(topInScroll / lineHeightPxNow) * lineHeightPxNow;

      const rawLeft = lineRect.left - scrollerRect.left;
      const rawRight = lineRect.right - scrollerRect.left;
      const quantizedLeft = Math.round(rawLeft / runtimeCellWidthPx) * runtimeCellWidthPx;
      const quantizedRight = Math.round(rawRight / runtimeCellWidthPx) * runtimeCellWidthPx;

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
      const visibleRows = computeVisibleMiddleRows(scroller.clientHeight, 0, 0, lineHeightPxRef.current);
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
        const visibleRows = computeVisibleMiddleRows(scroller.clientHeight, 0, 0, lineHeightPxNow);
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

      const caretTopInScroll = resolveCaretTopInScroll({
        caretRect,
        scrollerRectTop: scrollerRect.top,
        scrollerScrollTop: scroller.scrollTop,
        rootEl: view.contentDOM,
        domSelection,
        rawText: view.state.doc.toString(),
        lineHeightPx: lineHeightPxNow,
      });

      const { targetScrollTopPx } = resolveCagedScrollTarget({
        caretTopInScrollPx: caretTopInScroll,
        scrollerScrollTopPx: scroller.scrollTop,
        scrollerClientHeightPx: scroller.clientHeight,
        scrollerScrollHeightPx: scroller.scrollHeight,
        topBoundaryPx: 0,
        bottomBoundaryPx: 0,
        lineHeightPx: lineHeightPxNow,
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

      const caretTopInScroll = resolveCaretTopInScroll({
        caretRect,
        scrollerRectTop: scrollerRect.top,
        scrollerScrollTop: scroller.scrollTop,
        rootEl: view.contentDOM,
        domSelection,
        rawText: view.state.doc.toString(),
        lineHeightPx: lineHeightPxNow,
      });

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
            const visibleRows = computeVisibleMiddleRows(scroller.clientHeight, 0, 0, lineHeightPxNow);
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

            const text = view.state.doc.toString();
            const selection = toSelectionState(view.state.selection.main);
            const transformCallback = bindingsRef.current?.onTabIndentTransform;
            if (transformCallback) {
              const next = transformCallback({ shiftKey: event.shiftKey, text, selection });
              if (next) {
                event.preventDefault();
                applyTransformResult(view, next);
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
            const text = view.state.doc.toString();
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
            applyTransformResult(view, next);
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
              const text = view.state.doc.toString();
              const selection = toSelectionState(view.state.selection.main);
              const next = shortcutCallback({ shortcut, text, selection });
              if (next) {
                event.preventDefault();
                applyTransformResult(view, next);
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

        const text = view.state.doc.toString();
        const selection = toSelectionState(view.state.selection.main);
        const next = callback({ char: insertedText, text, selection });
        if (!next) return false;

        // A plain single printable key matches isRefocusKey and already
        // armed pendingCageIntent above -- this transform (e.g. checklist
        // typeover) replays selection with its own preserve-scroll
        // semantics, matching CagedScrollPlugin.tsx's own bypass for the
        // 'character-transform' tag, so clear it before dispatching.
        pendingCageIntent = false;
        applyTransformResult(view, next);
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

          const currentText = view.state.doc.toString();
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
              const caretTopInScroll = resolveCaretTopInScroll({
                caretRect,
                scrollerRectTop: scrollerRect.top,
                scrollerScrollTop: scroller.scrollTop,
                rootEl: view.contentDOM,
                domSelection,
                rawText: currentText,
                lineHeightPx: lineHeightPxRef.current,
              });
              pendingPasteViewportOffsetPx = caretTopInScroll - scroller.scrollTop;
            }
          }

          const nextText = `${currentText.slice(0, selection.from)}${sanitized}${currentText.slice(selection.to)}`;
          const nextCursor = Math.max(0, Math.min(nextText.length, selection.from + sanitized.length));

          // Ensures a reconcile happens even when no pre-paste caret geometry
          // could be measured above: the updateListener prefers the
          // preserve-offset reconcile when pendingPasteViewportOffsetPx is
          // set, falling back to the normal cage-clamp reconcile otherwise --
          // matching CagedScrollPlugin.tsx's own fallback for this case.
          pendingCageIntent = true;
          view.dispatch({
            changes: { from: 0, to: view.state.doc.length, insert: nextText },
            selection: EditorSelection.cursor(nextCursor),
          });

          return true;
        },
      }),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) {
          const nextText = update.state.doc.toString();
          const previousText = previousTextRef.current;
          const nextSelection = toSelectionState(update.state.selection.main);
          previousTextRef.current = nextText;
          previousSelectionRef.current = nextSelection;

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

    const handleWindowBlur = () => {
      pageKeysHeld.clear();
      clearPageContinuousHandoff();
      stopPageContinuousScroll();
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState !== 'visible') {
        pageKeysHeld.clear();
        clearPageContinuousHandoff();
        stopPageContinuousScroll();
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
    // toggle, split-view pane resize, font-size change).
    const resizeObserver = new ResizeObserver(() => {
      scheduleCaretUpdateAfterResize();
      scheduleSelectionHighlightUpdate();
    });
    resizeObserver.observe(view.scrollDOM);
    if (layerRef.current) resizeObserver.observe(layerRef.current);

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
      window.removeEventListener('blur', handleWindowBlur);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      clearPageContinuousHandoff();
      stopPageContinuousScroll();
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
    if (lastHydratedNoteIdRef.current === (noteId ?? null) && view.state.doc.toString() === initialText) return;
    lastHydratedNoteIdRef.current = noteId ?? null;

    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: initialText },
      selection: EditorSelection.cursor(0),
    });
    previousTextRef.current = initialText;
  }, [noteId, initialText]);

  useEffect(() => {
    if (!adapterRef) return;

    adapterRef.current = {
      getCapabilities() {
        return {
          textEvents: true,
          selectionEvents: true,
          viewportEvents: true,
          snapshotRead: true,
          // Not `true`: topBoundaryPx/bottomBoundaryPx aren't real yet (the
          // boundary UI is a later slice), so a full round-trip snapshot
          // write can't be claimed -- only the granular flags below that are
          // genuinely implemented.
          snapshotWrite: false,
          snapshotWriteText: false,
          snapshotWriteSelection: true,
          snapshotWriteViewport: true,
        };
      },
      getSnapshot(): EditorSnapshot | null {
        const view = viewRef.current;
        if (!view) return null;
        return {
          text: view.state.doc.toString(),
          selection: toSelectionState(view.state.selection.main),
          viewport: buildViewport(view),
        };
      },
      applySnapshot(snapshot: EditorSnapshotApplyRequest) {
        const view = viewRef.current;
        if (!view) return;

        // Line-count-based restore is the preferred path (see
        // EditorViewportLines's own doc comment in EditorContract.ts) --
        // topBoundaryLines/bottomBoundaryLines are ignored here (0 until the
        // boundary UI lands), only scrollTopLines is applied.
        if (snapshot.viewportLines) {
          view.scrollDOM.scrollTo({ top: Math.max(0, Math.round(snapshot.viewportLines.scrollTopLines) * lineHeightPxRef.current), behavior: 'auto' });
        } else if (snapshot.viewport && typeof snapshot.viewport.scrollTopPx === 'number') {
          view.scrollDOM.scrollTo({ top: Math.max(0, snapshot.viewport.scrollTopPx), behavior: 'auto' });
        }

        if (snapshot.selection) {
          const docLength = view.state.doc.length;
          const anchor = Math.max(0, Math.min(docLength, snapshot.selection.anchor));
          const focus = Math.max(0, Math.min(docLength, snapshot.selection.focus));
          view.dispatch({ selection: EditorSelection.single(anchor, focus) });
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
  }, [adapterRef]);

  return (
    // layerRef is the non-scrolling reference frame the block caret is
    // positioned against -- matching Editor.tsx's own structure, where
    // BlockCaretPlugin renders as a sibling of the scroller inside a shared
    // non-scrolling parent, not inside the scrolling element itself.
    <div ref={layerRef} style={{ position: 'absolute', inset: 0 }}>
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
          fontFamily,
          fontSize: fontSizePx,
          lineHeight: `${lineHeightPx}px`,
        }}
      />
      {highlightRects.map((rect, index) => (
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
      {caretStyle && (
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
}
