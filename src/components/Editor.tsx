import React, { useRef, useState, useEffect, useCallback, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { LexicalComposer } from '@lexical/react/LexicalComposer';
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin';
import { ContentEditable } from '@lexical/react/LexicalContentEditable';
import { HistoryPlugin } from '@lexical/react/LexicalHistoryPlugin';
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary';
import { cancelQuantizedSmoothScroll, scrollToQuantizedSmooth } from '../editor/QuantizedSmoothScroll';
import { CagedScrollPlugin } from '../plugins/CagedScrollPlugin';
import { SyntaxHighlightPlugin } from '../plugins/SyntaxHighlightPlugin';
import { BlockCaretPlugin } from '../plugins/BlockCaretPlugin';
import { MeaslyTokenNode } from '../nodes/MeaslyTokenNode';
import { ContractBridgePlugin } from '../plugins/ContractBridgePlugin';
import { NoteTextHydrationPlugin } from '../plugins/NoteTextHydrationPlugin';
import { TextSanitizationPlugin } from '../plugins/TextSanitizationPlugin';
import { PasteSanitizationPlugin } from '../plugins/PasteSanitizationPlugin';
import type {
  EditorAdapter,
  EditorBindings,
  EditorSelectionScrollBehavior,
  EditorSnapshotApplyRequest,
  EditorSelectionChangeEvent,
  EditorSelectionState,
  EditorSnapshot,
  EditorTextChangeEvent,
  EditorViewportState,
  EditorViewportLines,
} from '../editor/EditorContract';
import {
  validateSelectionInvariants,
  validateTextInvariants,
  validateViewportInvariants,
} from '../editor/ContractInvariantHarness';
import { normalizeInternalText } from '../editor/TextPolicy';

const theme = {
  paragraph: 'editor-paragraph',
};

function onError(error: Error) {
  console.error('Lexical Error:', error);
}

interface EditorProps {
  bindings?: EditorBindings;
  adapterRef?: React.MutableRefObject<EditorAdapter | null>;
  initialText?: string;
  scrollbarHost?: HTMLElement | null;
  fontFamily: string;
  fontSizePx: number;
  lineHeightPx: number;
  glyphWidthPx: number;
  cellWidthPx: number;
  // True once the editor font has loaded and glyph metrics (cellWidthPx,
  // glyphWidthPx) have been measured against the real font face. Until this
  // is true, metrics are fallback estimates and the grid/columns would render
  // at the wrong pitch. Gated content waits for both this and hasViewportLines.
  fontReady: boolean;
}

const ENABLE_CONTRACT_ASSERTIONS = import.meta.env.DEV;
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

const quantizeTopEdge = (valuePx: number, lineHeightPx: number) => Math.max(0, Math.round(valuePx / lineHeightPx) * lineHeightPx);

const quantizeViewportHeightToGrid = (heightPx: number, lineHeightPx: number) => {
  const h = Math.max(0, Math.round(heightPx));
  const line = Math.max(1, Math.round(lineHeightPx));
  return Math.floor(h / line) * line;
};

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

// Pure derivation from stored (persisted) boundary line counts to displayed
// line counts, given how many lines are currently available in the
// viewport. Never mutates the stored values — clamping is recomputed fresh
// on every call from (storedTopLines, storedBottomLines, availableLines).
//
// Constraint: at least one line must remain for the middle (text) section,
// i.e. topLines + bottomLines <= max(0, availableLines - 1).
// Top boundary has priority for the available budget; bottom boundary
// receives whatever remains.
//
// Example: availableLines=20 (410px / 20px), stored top=25, stored bottom=5
//   -> maxCombined = 19
//   -> displayTop = min(25, 19) = 19
//   -> displayBottom = min(5, 19 - 19) = 0
// If availableLines later becomes 40 (804px / 20px):
//   -> maxCombined = 39
//   -> displayTop = min(25, 39) = 25
//   -> displayBottom = min(5, 39 - 25) = 5
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

function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function readEditorFramePaddingPx(element: HTMLElement): number {
  const raw = getComputedStyle(element).getPropertyValue('--editor-frame-padding').trim();
  const parsed = Number.parseFloat(raw);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return 0;
  }
  return parsed;
}

function collapseEditorSeparators(text: string): string {
  return normalizeInternalText(text);
}

type DomPoint = { node: Node; offset: number };

function collectParagraphTextNodes(paragraphEl: HTMLElement): Text[] {
  const walker = document.createTreeWalker(paragraphEl, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  while (walker.nextNode()) {
    const current = walker.currentNode;
    if (current instanceof Text) {
      nodes.push(current);
    }
  }
  return nodes;
}

function paragraphStartPoint(paragraphEl: HTMLElement, textNodes: Text[]): DomPoint {
  if (textNodes.length > 0) {
    return { node: textNodes[0], offset: 0 };
  }
  return { node: paragraphEl, offset: 0 };
}

function paragraphEndPoint(paragraphEl: HTMLElement, textNodes: Text[]): DomPoint {
  if (textNodes.length > 0) {
    const last = textNodes[textNodes.length - 1];
    return { node: last, offset: last.data.length };
  }
  return { node: paragraphEl, offset: paragraphEl.childNodes.length };
}

function resolveDomPointForTextOffset(rootEl: HTMLElement, canonicalText: string, targetOffset: number): DomPoint | null {
  const safeTargetOffset = clampNumber(targetOffset, 0, canonicalText.length);
  const paragraphs = Array.from(rootEl.children).filter((child): child is HTMLElement => child instanceof HTMLElement);

  if (paragraphs.length === 0) {
    const walker = document.createTreeWalker(rootEl, NodeFilter.SHOW_TEXT);
    let fallback: DomPoint | null = null;
    let traversed = 0;

    while (walker.nextNode()) {
      const current = walker.currentNode;
      if (!(current instanceof Text)) continue;

      const length = current.data.length;
      fallback = { node: current, offset: length };
      if (safeTargetOffset <= traversed + length) {
        return { node: current, offset: clampNumber(safeTargetOffset - traversed, 0, length) };
      }
      traversed += length;
    }

    return fallback;
  }

  const prefix = canonicalText.slice(0, safeTargetOffset);
  const lineBreaks = prefix.match(/\n/g);
  const lineIndex = lineBreaks ? lineBreaks.length : 0;
  const lineStart = prefix.lastIndexOf('\n') + 1;
  const column = safeTargetOffset - lineStart;

  const paragraphIndex = clampNumber(lineIndex, 0, paragraphs.length - 1);
  const paragraph = paragraphs[paragraphIndex];
  const textNodes = collectParagraphTextNodes(paragraph);

  if (textNodes.length === 0) {
    return paragraphStartPoint(paragraph, textNodes);
  }

  let remaining = Math.max(0, column);
  for (const node of textNodes) {
    const length = node.data.length;
    if (remaining <= length) {
      return { node, offset: remaining };
    }
    remaining -= length;
  }

  return paragraphEndPoint(paragraph, textNodes);
}

function applyDomSelectionFromOffsets(
  rootEl: HTMLElement,
  canonicalText: string,
  anchor: number,
  focus: number,
  scrollerEl?: HTMLElement | null,
  selectionScrollBehavior: EditorSelectionScrollBehavior = 'preserve-scroll',
  lineHeightPx?: number,
  onSmoothScrollStep?: () => void,
): void {
  const shouldPreserveScroll = selectionScrollBehavior === 'preserve-scroll';
  const safeAnchor = Math.max(0, anchor);
  const safeFocus = Math.max(0, focus);
  const anchorPoint = resolveDomPointForTextOffset(rootEl, canonicalText, safeAnchor);
  const focusPoint = resolveDomPointForTextOffset(rootEl, canonicalText, safeFocus);
  if (!anchorPoint || !focusPoint) return;

  const preservedScrollTop = shouldPreserveScroll && scrollerEl ? scrollerEl.scrollTop : null;

  const range = document.createRange();
  range.setStart(anchorPoint.node, anchorPoint.offset);
  range.setEnd(focusPoint.node, focusPoint.offset);

  const selection = window.getSelection();
  if (!selection) return;

  selection.removeAllRanges();
  selection.addRange(range);

  if (scrollerEl && preservedScrollTop !== null) {
    scrollerEl.scrollTop = preservedScrollTop;
    requestAnimationFrame(() => {
      if (scrollerEl) {
        scrollerEl.scrollTop = preservedScrollTop;
      }
    });
  } else if (scrollerEl && !shouldPreserveScroll) {
    const scrollerRect = scrollerEl.getBoundingClientRect();
    const rangeRect = range.getBoundingClientRect();
    const visibleTop = scrollerRect.top;
    const visibleBottom = scrollerRect.bottom;
    if (rangeRect.top < visibleTop || rangeRect.bottom > visibleBottom) {
      const targetScrollTop = scrollerEl.scrollTop + (rangeRect.top - visibleTop) - (scrollerEl.clientHeight * 0.35);
      const clampedTarget = Math.max(0, Math.min(targetScrollTop, scrollerEl.scrollHeight - scrollerEl.clientHeight));
      if (typeof lineHeightPx === 'number' && lineHeightPx > 0) {
        scrollToQuantizedSmooth(scrollerEl, clampedTarget, {
          lineHeightPx,
          onStep: onSmoothScrollStep,
        });
      } else {
        scrollerEl.scrollTop = clampedTarget;
      }
      requestAnimationFrame(() => {
        if (scrollerEl && typeof lineHeightPx !== 'number') {
          scrollerEl.scrollTop = clampedTarget;
        }
      });
    }
  }
}

export function Editor({
  bindings,
  adapterRef,
  initialText = '',
  scrollbarHost = null,
  fontFamily,
  fontSizePx,
  lineHeightPx,
  glyphWidthPx,
  cellWidthPx,
  fontReady,
}: EditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const scrollbarTrackRef = useRef<HTMLDivElement>(null);
  const lastInvariantKeyRef = useRef('');
  const latestTextRef = useRef('');
  const latestSelectionRef = useRef<EditorSelectionState>({
    anchor: 0,
    focus: 0,
    start: 0,
    end: 0,
    isCollapsed: true,
  });
  
  const [editorSize, setEditorSize] = useState({ width: 0, height: 0, left: 0, top: 0, innerHeight: 0 });

  // User-configurable boundaries, stored as integer line counts. This is
  // the persisted representation (see EditorViewportLines): resolution-
  // independent, never invalidated by container size, and never mutated by
  // display/clamping logic. Display pixel values are derived fresh on every
  // render via clampBoundaryLines + the current viewport's available line
  // count (see topBoundary/bottomBoundary below).
  const [topBoundaryLines, setTopBoundaryLines] = useState(0);
  const [bottomBoundaryLines, setBottomBoundaryLines] = useState(0);

  // Whether the editor has received its restored (or default 0/0/0)
  // boundary/scroll line counts via applySnapshot. Until this is true, the
  // boundary dividers and the text content are not rendered — only the
  // outer frame (whose size doesn't depend on its content) is, so it can be
  // measured. This avoids ever rendering a "wrong" frame that gets
  // corrected a moment later.
  const [hasViewportLines, setHasViewportLines] = useState(false);

  // Derived display values (px), recomputed every render from the stored
  // line counts + the current measured viewport height. Pure function of
  // two known quantities — never needs a retry/verify loop, and never
  // mutates topBoundaryLines/bottomBoundaryLines.
  const availableLines = Math.max(0, Math.floor(editorSize.innerHeight / lineHeightPx));
  const { topLines: displayTopLines, bottomLines: displayBottomLines } = clampBoundaryLines(
    topBoundaryLines,
    bottomBoundaryLines,
    availableLines,
  );
  const topBoundary = displayTopLines * lineHeightPx;
  const bottomBoundary = displayBottomLines * lineHeightPx;

  // Dragging state
  const [isDraggingTop, setIsDraggingTop] = useState(false);
  const [isDraggingBottom, setIsDraggingBottom] = useState(false);
  const [scrollThumbTopPx, setScrollThumbTopPx] = useState(0);
  const [scrollThumbHeightPx, setScrollThumbHeightPx] = useState(0);
  const [isScrollThumbActive, setIsScrollThumbActive] = useState(false);
  const [isDraggingScrollThumb, setIsDraggingScrollThumb] = useState(false);
  const scrollThumbDragOriginRef = useRef<{ pointerY: number; thumbTopPx: number } | null>(null);
  const scrollbarSyncRafRef = useRef<number | null>(null);
  const lastPassiveScrollbarMetricsRef = useRef<{
    scrollTopPx: number;
    scrollHeightPx: number;
    clientHeightPx: number;
    trackHeightPx: number;
  } | null>(null);

  const reportInvariantIssues = (context: string, issues: string[]) => {
    if (!ENABLE_CONTRACT_ASSERTIONS || issues.length === 0) return;
    const key = `${context}|${issues.join('|')}`;
    if (key === lastInvariantKeyRef.current) return;
    lastInvariantKeyRef.current = key;
    console.warn(`[editor-contract:${context}]`, issues);
  };

  const handleTextChange = useCallback((event: EditorTextChangeEvent) => {
    latestTextRef.current = event.text;
    latestSelectionRef.current = event.selection;
    reportInvariantIssues('text-change', [
      ...validateTextInvariants(event.text),
      ...validateSelectionInvariants(event.text, event.selection),
    ]);
    bindings?.onTextChange?.(event);
  }, [bindings]);

  const handleSelectionChange = useCallback((event: EditorSelectionChangeEvent) => {
    latestSelectionRef.current = event.selection;
    reportInvariantIssues('selection-change', validateSelectionInvariants(latestTextRef.current, event.selection));
    bindings?.onSelectionChange?.(event);
  }, [bindings]);

  const buildViewport = useCallback((): EditorViewportState => ({
    topBoundaryPx: quantizeTopEdge(topBoundary, lineHeightPx),
    bottomBoundaryPx: quantizeTopEdge(bottomBoundary, lineHeightPx),
    scrollTopPx: scrollerRef.current?.scrollTop ?? 0,
    lineHeightPx,
    cellWidthPx,
    scrollHeightPx: scrollerRef.current?.scrollHeight ?? 0,
    clientHeightPx: scrollerRef.current?.clientHeight ?? 0,
  }), [topBoundary, bottomBoundary, lineHeightPx, cellWidthPx]);

  const buildViewportLines = useCallback((): EditorViewportLines => ({
    topBoundaryLines,
    bottomBoundaryLines,
    scrollTopLines: Math.round((scrollerRef.current?.scrollTop ?? 0) / lineHeightPx),
  }), [topBoundaryLines, bottomBoundaryLines, lineHeightPx]);

  const readScrollbarGeometry = useCallback((): ScrollbarGeometry | null => {
    const scroller = scrollerRef.current;
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
    if (isDraggingScrollThumb && !options?.force) {
      return;
    }

    const scroller = scrollerRef.current;
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
  }, [isDraggingScrollThumb, readScrollbarGeometry]);

  const scrollFromThumbTop = useCallback((thumbTopPx: number) => {
    const scroller = scrollerRef.current;
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
    const quantizedScrollTop = clampNumber(
      Math.round(targetScrollTop / lineHeightPx) * lineHeightPx,
      0,
      maxScrollTop,
    );
    scroller.scrollTop = quantizedScrollTop;
  }, [lineHeightPx, readScrollbarGeometry]);

  useEffect(() => {
    bindings?.onLifecycle?.({ phase: 'mounted' });
    bindings?.onLifecycle?.({ phase: 'ready' });
    return () => {
      bindings?.onLifecycle?.({ phase: 'destroyed' });
    };
  }, [bindings]);

  useEffect(() => {
    const viewport = buildViewport();
    reportInvariantIssues('viewport-change', validateViewportInvariants(viewport));
    bindings?.onViewportChange?.({ source: 'programmatic', viewport });
  }, [bindings, buildViewport]);

  useLayoutEffect(() => {
    syncCustomScrollbar();
    requestAnimationFrame(() => syncCustomScrollbar());
  }, [syncCustomScrollbar, scrollbarHost]);

  useEffect(() => {
    syncCustomScrollbar();
  }, [syncCustomScrollbar, editorSize.width, editorSize.height, initialText, topBoundary, bottomBoundary]);

  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;

    const scheduleSync = () => {
      if (scrollbarSyncRafRef.current !== null) {
        cancelAnimationFrame(scrollbarSyncRafRef.current);
      }
      scrollbarSyncRafRef.current = requestAnimationFrame(() => {
        scrollbarSyncRafRef.current = null;
        syncCustomScrollbar();
      });
    };

    scheduleSync();

    const resizeObserver = new ResizeObserver(() => scheduleSync());
    resizeObserver.observe(scroller);

    const track = scrollbarTrackRef.current;
    if (track) {
      resizeObserver.observe(track);
    }

    const editable = scroller.querySelector('.editor-text');
    if (editable instanceof HTMLElement) {
      resizeObserver.observe(editable);
    }

    const mutationObserver = new MutationObserver(() => scheduleSync());
    mutationObserver.observe(scroller, {
      subtree: true,
      childList: true,
      characterData: true,
    });

    return () => {
      mutationObserver.disconnect();
      resizeObserver.disconnect();
      if (scrollbarSyncRafRef.current !== null) {
        cancelAnimationFrame(scrollbarSyncRafRef.current);
        scrollbarSyncRafRef.current = null;
      }
    };
  }, [syncCustomScrollbar, initialText, scrollbarHost]);

  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;

    const onScroll = () => {
      const viewport = buildViewport();
      reportInvariantIssues('viewport-scroll', validateViewportInvariants(viewport));
      bindings?.onViewportChange?.({ source: 'user-input', viewport });
      syncCustomScrollbar();
    };

    scroller.addEventListener('scroll', onScroll, { passive: true });
    return () => scroller.removeEventListener('scroll', onScroll);
  }, [bindings, buildViewport, syncCustomScrollbar]);

  useEffect(() => {
    let rafId: number | null = null;

    const runPassiveSync = () => {
      const scroller = scrollerRef.current;
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

  useEffect(() => {
    if (!adapterRef) return;

    adapterRef.current = {
      getCapabilities() {
        return {
          textEvents: true,
          selectionEvents: true,
          viewportEvents: true,
          snapshotRead: true,
          snapshotWrite: false,
          snapshotWriteText: false,
          snapshotWriteSelection: true,
          snapshotWriteViewport: true,
        };
      },
      getSnapshot(): EditorSnapshot | null {
        return {
          text: latestTextRef.current,
          selection: latestSelectionRef.current,
          viewport: buildViewport(),
          viewportLines: buildViewportLines(),
        };
      },
      applySnapshot(snapshot: EditorSnapshotApplyRequest) {
        const nextViewport = snapshot.viewport;
        let appliedViewport = false;

        if (ENABLE_CONTRACT_ASSERTIONS) {
          const unsupported: string[] = [];
          if (typeof snapshot.text === 'string') {
            unsupported.push('text');
          }
          if (unsupported.length > 0) {
            console.warn(
              '[editor-contract:snapshot-apply] Ignoring unsupported snapshot fields:',
              unsupported,
            );
          }
        }

        if (nextViewport) {
          const h = Math.max(0, scrollerRef.current?.clientHeight ?? 0);
          const quantizedViewportHeight = quantizeViewportHeightToGrid(h, lineHeightPx);

          let nextTopBoundary = typeof nextViewport.topBoundaryPx === 'number'
          ? Math.max(0, Math.round(nextViewport.topBoundaryPx / lineHeightPx) * lineHeightPx)
          : topBoundary;
        let nextBottomBoundary = typeof nextViewport.bottomBoundaryPx === 'number'
          ? Math.min(Math.max(0, Math.round(nextViewport.bottomBoundaryPx / lineHeightPx) * lineHeightPx), quantizedViewportHeight)
          : bottomBoundary;

        const normalized = normalizeEditorBoundaryPair({
          topBoundaryPx: nextTopBoundary,
          bottomBoundaryPx: nextBottomBoundary,
          lineHeightPx,
          viewportHeightPx: h,
          preserve: typeof nextViewport.bottomBoundaryPx === 'number' ? 'bottom' : 'top',
        });

        if (typeof nextViewport.topBoundaryPx === 'number') {
          setTopBoundaryLines(Math.round(normalized.topBoundaryPx / lineHeightPx));
        }
        if (typeof nextViewport.bottomBoundaryPx === 'number') {
          setBottomBoundaryLines(Math.round(normalized.bottomBoundaryPx / lineHeightPx));
        }
          if (typeof nextViewport.scrollTopPx === 'number' && scrollerRef.current) {
            scrollerRef.current.scrollTo({ top: Math.max(0, nextViewport.scrollTopPx), behavior: 'auto' });
          }
          appliedViewport = true;
        }

        // Primary restore path: integer line counts, applied directly with
        // no clamping or measurement-dependent math (see EditorViewportLines
        // and clampBoundaryLines). This is the only path that should be used
        // for cross-session restore. Display boundaries are derived lazily
        // via clampBoundaryLines on every render once the container is
        // measured, so this is correct to call even before that happens.
        if (snapshot.viewportLines) {
          const lines = snapshot.viewportLines;
          setTopBoundaryLines(Math.max(0, Math.round(lines.topBoundaryLines)));
          setBottomBoundaryLines(Math.max(0, Math.round(lines.bottomBoundaryLines)));
          if (scrollerRef.current) {
            scrollerRef.current.scrollTo({
              top: Math.max(0, Math.round(lines.scrollTopLines) * lineHeightPx),
              behavior: 'auto',
            });
          }
          setHasViewportLines(true);
          appliedViewport = true;
        }

        if (snapshot.selection) {
          const rootEl = scrollerRef.current?.querySelector('.editor-text');
          if (rootEl instanceof HTMLElement) {
            const canonicalText = collapseEditorSeparators(latestTextRef.current);
            const textLength = canonicalText.length;
            const anchor = clampNumber(snapshot.selection.anchor, 0, textLength);
            const focus = clampNumber(snapshot.selection.focus, 0, textLength);
            const selectionScrollBehavior = snapshot.selectionScrollBehavior ?? 'center-caged';
            applyDomSelectionFromOffsets(
              rootEl,
              canonicalText,
              anchor,
              focus,
              scrollerRef.current,
              selectionScrollBehavior,
              lineHeightPx,
              syncCustomScrollbar,
            );

            // Selection application should never force viewport recentering here.
            // Viewport movement is controlled by explicit viewport snapshots and caged scroll logic.
          }
        }

        if (appliedViewport) {
          reportInvariantIssues('snapshot-apply', validateViewportInvariants(buildViewport()));
        }
      },
    };

    return () => {
      if (adapterRef.current) {
        adapterRef.current = null;
      }
    };
  }, [adapterRef, buildViewport, buildViewportLines, topBoundary, bottomBoundary, topBoundaryLines, bottomBoundaryLines, lineHeightPx]);

  useLayoutEffect(() => {
    const updateSize = () => {
      if (!containerRef.current) return;
      const container = containerRef.current;
      const rect = container.getBoundingClientRect();
      const framePaddingPx = readEditorFramePaddingPx(container);
      const availableInnerWidth = Math.max(1, rect.width - (framePaddingPx * 2));
      const availableInnerHeight = Math.max(lineHeightPx, rect.height - (framePaddingPx * 2));
      
      // Keep the editor viewport on exact cell multiples so separator math,
      // scroll cage math, and rendered grid rows share the same lattice.
      const snappedInnerWidth = Math.max(1, Math.floor((availableInnerWidth - 1) / cellWidthPx) * cellWidthPx + 1);
      const snappedInnerHeight = Math.max(lineHeightPx, Math.floor(availableInnerHeight / lineHeightPx) * lineHeightPx);
      const snappedWidth = snappedInnerWidth + (framePaddingPx * 2);
      const snappedHeight = snappedInnerHeight + (framePaddingPx * 2);
      
      const left = Math.floor((rect.width - snappedWidth) / 2);
      const top = Math.floor((rect.height - snappedHeight) / 2);

      setEditorSize((previous) => {
        if (
          previous.width === snappedWidth &&
          previous.height === snappedHeight &&
          previous.left === left &&
          previous.top === top &&
          previous.innerHeight === snappedInnerHeight
        ) {
          return previous;
        }
        return { width: snappedWidth, height: snappedHeight, left, top, innerHeight: snappedInnerHeight };
      });

      const scroller = scrollerRef.current;
      if (scroller) {
        const maxScrollTopPx = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
        const quantizedScrollTopPx = clampNumber(
          Math.round(scroller.scrollTop / lineHeightPx) * lineHeightPx,
          0,
          maxScrollTopPx,
        );
        if (Math.abs(quantizedScrollTopPx - scroller.scrollTop) > 0.01) {
          scroller.scrollTop = quantizedScrollTopPx;
        }
      }
    };

    const resizeObserver = new ResizeObserver(() => updateSize());
    if (containerRef.current) resizeObserver.observe(containerRef.current);
    
    updateSize();
    return () => resizeObserver.disconnect();
  }, [cellWidthPx, lineHeightPx]);

  // Global Mouse listeners for Dragging
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!scrollerRef.current) return;
      const rect = scrollerRef.current.getBoundingClientRect();
      const h = Math.max(0, scrollerRef.current.clientHeight);
      const relativeY = e.clientY - rect.top;
      const clampedY = Math.max(0, Math.min(relativeY, h));
      const dragLines = Math.max(0, Math.round(clampedY / lineHeightPx));

      if (isDraggingTop) {
        // The dragged value is the stored value going forward: "the current
        // distance to the edge becomes the new value" (per spec). Display
        // clamping (clampBoundaryLines) reconciles this against the bottom
        // boundary and available space on every render — no cross-boundary
        // adjustment is needed here.
        setTopBoundaryLines(dragLines);
      } else if (isDraggingBottom) {
        const availableLines = Math.max(0, Math.round(h / lineHeightPx));
        const bottomLines = Math.max(0, availableLines - dragLines);
        setBottomBoundaryLines(bottomLines);
      }
    };

    const handleMouseUp = () => {
      setIsDraggingTop(false);
      setIsDraggingBottom(false);
    };

    if (isDraggingTop || isDraggingBottom) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    }
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDraggingTop, isDraggingBottom, lineHeightPx]);

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

  const handleTrackMouseDown = (event: React.MouseEvent<HTMLDivElement>) => {
    const track = scrollbarTrackRef.current;
    const scroller = scrollerRef.current;
    if (!track || !scroller) return;

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

    scrollToQuantizedSmooth(scroller, targetScrollTop, {
      lineHeightPx,
      onStep: syncCustomScrollbar,
    });
  };

  const handleThumbMouseDown = (event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const scroller = scrollerRef.current;
    if (scroller) {
      cancelQuantizedSmoothScroll(scroller);
    }
    setIsDraggingScrollThumb(true);
    scrollThumbDragOriginRef.current = {
      pointerY: event.clientY,
      thumbTopPx: scrollThumbTopPx,
    };
  };

  const forwardHandleWheelToScroller = (event: React.WheelEvent<HTMLDivElement>) => {
    const scroller = scrollerRef.current;
    if (!scroller) return;

    // Some wheel events can arrive as non-cancelable after focus transitions.
    // Guard preventDefault to avoid noisy passive/cancelable warnings.
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

  const initialConfig = {
    namespace: 'MeaslyNotes',
    theme,
    onError,
    nodes: [MeaslyTokenNode],
  };

  const scrollbarRail = (
    <div className="measly-scroll-rail">
      <div
        ref={scrollbarTrackRef}
        className="measly-scroll-track"
        onMouseDown={handleTrackMouseDown}
      >
        <div
          className={`measly-scroll-thumb${isDraggingScrollThumb ? ' is-dragging' : ''}${isScrollThumbActive ? '' : ' is-inactive'}`}
          style={{
            top: `${scrollThumbTopPx}px`,
            height: `${Math.max(0, scrollThumbHeightPx)}px`,
          }}
          onMouseDown={handleThumbMouseDown}
        />
      </div>
    </div>
  );

  return (
    <div className="absolute inset-0 overflow-hidden min-w-0 min-h-0">
      {/* Absolute measurement tracker that is immune to content stretching */}
      <div ref={containerRef} className="absolute inset-0 pointer-events-none z-[-1]" />
      
      {editorSize.width > 0 && (
        <LexicalComposer initialConfig={initialConfig}>
          {/* Editor Container Base */}
          <div 
            className="absolute text-left"
            style={{ 
              ...({
                '--editor-font': fontFamily,
                '--editor-font-size': `${fontSizePx}px`,
                '--editor-line-height': `${lineHeightPx}px`,
                '--editor-glyph-width': `${glyphWidthPx}px`,
                '--editor-cell-width': `${cellWidthPx}px`,
              } as React.CSSProperties),
              width: editorSize.width, 
              height: editorSize.height,
              left: editorSize.left,
              top: editorSize.top,
              cursor: (isDraggingTop || isDraggingBottom) ? 'ns-resize' : 'auto',
              backgroundColor: 'transparent',
            }}
          >
            {/* Boundary-dependent visuals: background zones, grid lines, and
                drag handles all depend on topBoundary/bottomBoundary, which
                are only meaningful once the restored line counts have been
                applied (hasViewportLines). Rendering them before that would
                show a 0/0 frame that then jumps to the correct values —
                exactly the flash we want to avoid. Render nothing here until
                ready; the scroller below still mounts unconditionally so it
                can be measured. */}
            {hasViewportLines && fontReady && (
              <>
                {/* Regular background color is constrained to the middle zone only. */}
                <div
                  className="absolute pointer-events-none"
                  style={{
                    top: `calc(var(--editor-frame-padding) + ${topBoundary}px)`,
                    bottom: `calc(var(--editor-frame-padding) + ${bottomBoundary}px)`,
                    left: 'var(--editor-frame-padding)',
                    right: 'var(--editor-frame-padding)',
                    backgroundColor: 'var(--color-bg-regular)',
                    zIndex: 2,
                  }}
                />

                {/* Background color for top and bottom zones */}
                <div
                  className="absolute left-0 right-0 pointer-events-none"
                  style={{
                    top: 'var(--editor-frame-padding)',
                    left: 'var(--editor-frame-padding)',
                    right: 'var(--editor-frame-padding)',
                    height: topBoundary,
                    backgroundColor: 'var(--color-bg-leading)',
                    zIndex: 2,
                  }}
                />
                <div
                  className="absolute left-0 right-0 pointer-events-none"
                  style={{
                    bottom: 'var(--editor-frame-padding)',
                    left: 'var(--editor-frame-padding)',
                    right: 'var(--editor-frame-padding)',
                    height: bottomBoundary,
                    backgroundColor: 'var(--color-bg-trailing)',
                    zIndex: 2,
                  }}
                />
              </>
            )}

            {/* Grid lines: also gated on hasViewportLines since their pitch
                (--editor-line-height / --editor-cell-width) must be final
                before they render — otherwise the grid draws at a wrong
                pitch and redraws once font metrics settle. */}
            {hasViewportLines && fontReady && (
              <>
                <div className="absolute pointer-events-none measly-grid-outline-lines" style={{ inset: 'var(--editor-frame-padding) var(--editor-frame-padding) calc(var(--editor-frame-padding) - 1px) var(--editor-frame-padding)', zIndex: 29 }} />
                <div className="absolute pointer-events-none measly-grid-lines" style={{ inset: 'var(--editor-frame-padding) var(--editor-frame-padding) calc(var(--editor-frame-padding) - 1px) var(--editor-frame-padding)', zIndex: 30 }} />
              </>
            )}

            {hasViewportLines && fontReady && (
              <>
                {/* Top Drag Handle */}
                <div
                  className="absolute left-0 right-0 z-20 bg-transparent cursor-ns-resize"
                  style={{ top: `calc(var(--editor-frame-padding) + ${topBoundary}px - ${lineHeightPx}px)`, left: 'var(--editor-frame-padding)', right: 'var(--editor-frame-padding)', height: lineHeightPx }}
                  onWheel={forwardHandleWheelToScroller}
                  onMouseDown={(e) => { e.preventDefault(); setIsDraggingTop(true); }}
                />

                {/* Bottom Drag Handle */}
                <div
                  className="absolute left-0 right-0 z-20 bg-transparent cursor-ns-resize"
                  style={{ bottom: `calc(var(--editor-frame-padding) + ${bottomBoundary}px - ${lineHeightPx}px)`, left: 'var(--editor-frame-padding)', right: 'var(--editor-frame-padding)', height: lineHeightPx }}
                  onWheel={forwardHandleWheelToScroller}
                  onMouseDown={(e) => { e.preventDefault(); setIsDraggingBottom(true); }}
                />
              </>
            )}

            {/* Actual Scroller */}
            <div 
              ref={scrollerRef}
              className="absolute overflow-y-auto overflow-x-hidden outline-none z-10 measly-custom-scrollbar"
              style={{ inset: 'var(--editor-frame-padding)', scrollBehavior: 'auto' }}
            >
              <RichTextPlugin
                contentEditable={
                  <ContentEditable 
                    className="outline-none text-gray-800 editor-text min-h-full w-full relative z-10"
                    style={{
                      paddingTop: topBoundary,
                      paddingBottom: bottomBoundary,
                      paddingLeft: 0,
                      paddingRight: 0,
                      boxSizing: 'border-box',
                      // Hide content until the restored line counts have
                      // been applied (hasViewportLines). The padding above
                      // depends on topBoundary/bottomBoundary, which are
                      // 0/0 until then — rendering visible content with 0
                      // padding and then snapping to the correct padding
                      // would be exactly the "wrong frame, then corrected"
                      // flash we want to avoid. The element stays mounted
                      // (so Lexical's editable root exists and text
                      // hydration can proceed) but is not visible.
                      visibility: hasViewportLines && fontReady ? 'visible' : 'hidden',
                    }}
                    spellCheck={false} 
                  />
                }
                placeholder={
                  hasViewportLines && fontReady ? (
                    <div className="absolute text-gray-400 pointer-events-none select-none editor-text z-0" style={{ top: topBoundary, left: 0 }}>
                      Jot down a measly note...
                    </div>
                  ) : null
                }
                ErrorBoundary={LexicalErrorBoundary}
              />
            </div>

            {/* Native Caret Replacement overlayed in viewport space */}
            {hasViewportLines && fontReady && (
              <BlockCaretPlugin
                scrollerRef={scrollerRef}
                topBoundaryPx={topBoundary}
                bottomBoundaryPx={bottomBoundary}
                lineHeightPx={lineHeightPx}
                cellWidthPx={cellWidthPx}
              />
            )}
        
            <HistoryPlugin />
            <PasteSanitizationPlugin />
            <TextSanitizationPlugin />
            <SyntaxHighlightPlugin />
            <NoteTextHydrationPlugin text={initialText} scrollerRef={scrollerRef} />
            <ContractBridgePlugin
              onTextChange={handleTextChange}
              onSelectionChange={handleSelectionChange}
              onTabIndent={bindings?.onTabIndent}
              onTabIndentTransform={bindings?.onTabIndentTransform}
              onMarkdownShortcutTransform={bindings?.onMarkdownShortcutTransform}
              onEnterTransform={bindings?.onEnterTransform}
            />
            
            {/* The Magic Cage Scroller! */}
            {hasViewportLines && fontReady && (
              <CagedScrollPlugin
                scrollerRef={scrollerRef}
                topBoundaryPx={topBoundary}
                bottomBoundaryPx={bottomBoundary}
                lineHeightPx={lineHeightPx}
              />
            )}
          </div>
        </LexicalComposer>
      )}
      {scrollbarHost ? createPortal(scrollbarRail, scrollbarHost) : null}
    </div>
  );
}
