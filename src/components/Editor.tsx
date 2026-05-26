import React, { useRef, useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { LexicalComposer } from '@lexical/react/LexicalComposer';
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin';
import { ContentEditable } from '@lexical/react/LexicalContentEditable';
import { HistoryPlugin } from '@lexical/react/LexicalHistoryPlugin';
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary';
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
  EditorSelectionChangeEvent,
  EditorSelectionState,
  EditorSnapshot,
  EditorTextChangeEvent,
  EditorViewportState,
} from '../editor/EditorContract';
import {
  validateSelectionInvariants,
  validateTextInvariants,
  validateViewportInvariants,
} from '../editor/ContractInvariantHarness';
import { logScenarioProbe, readCaretGeometry } from '../editor/ScenarioProbe';
import { CELL_WIDTH_PX, LINE_HEIGHT_PX } from '../editor/LayoutConstants';
import { normalizeInternalText } from '../editor/TextPolicy';
import { scrollToQuantizedEase } from '../editor/QuantizedEaseScroll';

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
}

const ENABLE_CONTRACT_ASSERTIONS = import.meta.env.DEV;
const ENABLE_SCENARIO_PROBES = import.meta.env.DEV;
const SCROLL_TRACK_MIN_THUMB_HEIGHT_PX = 28;
const SCROLL_TRACK_EDGE_GAP_PX = 3;

const quantizeTopEdge = (valuePx: number) => Math.max(0, Math.round(valuePx / LINE_HEIGHT_PX) * LINE_HEIGHT_PX);

const bottomBoundaryFromTopEdge = (heightPx: number, topEdgePx: number) => {
  const h = Math.max(0, Math.round(heightPx));
  const topEdge = Math.max(0, Math.min(h, quantizeTopEdge(topEdgePx)));
  return h - topEdge;
};

const topEdgeFromBottomBoundary = (heightPx: number, bottomBoundaryPx: number) => {
  const h = Math.max(0, Math.round(heightPx));
  return Math.max(0, Math.min(h, h - bottomBoundaryPx));
};

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

function applyDomSelectionFromOffsets(rootEl: HTMLElement, canonicalText: string, anchor: number, focus: number): void {
  const safeAnchor = Math.max(0, anchor);
  const safeFocus = Math.max(0, focus);
  const anchorPoint = resolveDomPointForTextOffset(rootEl, canonicalText, safeAnchor);
  const focusPoint = resolveDomPointForTextOffset(rootEl, canonicalText, safeFocus);
  if (!anchorPoint || !focusPoint) return;

  const range = document.createRange();
  range.setStart(anchorPoint.node, anchorPoint.offset);
  range.setEnd(focusPoint.node, focusPoint.offset);

  const selection = window.getSelection();
  if (!selection) return;

  rootEl.focus();
  selection.removeAllRanges();
  selection.addRange(range);
}

function centerSelectionInCagedMiddle(
  scroller: HTMLElement,
  topBoundaryPx: number,
  bottomBoundaryPx: number,
  options?: { animate?: boolean },
): void {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return;

  const range = selection.getRangeAt(0);
  const rect = range.getBoundingClientRect();
  if (rect.height === 0 && rect.width === 0) return;

  const scrollerRect = scroller.getBoundingClientRect();
  const middleTopPx = topBoundaryPx;
  const middleBottomPx = Math.max(middleTopPx + LINE_HEIGHT_PX, scroller.clientHeight - bottomBoundaryPx);
  const middleCenterPx = (middleTopPx + middleBottomPx) / 2;

  const selectionCenterInViewportPx = ((rect.top + rect.bottom) / 2) - scrollerRect.top;
  const deltaPx = selectionCenterInViewportPx - middleCenterPx;
  if (Math.abs(deltaPx) < 0.5) return;

  const maxScrollTopPx = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
  const nextScrollTopPx = clampNumber(
    Math.round((scroller.scrollTop + deltaPx) / LINE_HEIGHT_PX) * LINE_HEIGHT_PX,
    0,
    maxScrollTopPx,
  );

  if (nextScrollTopPx !== scroller.scrollTop) {
    if (options?.animate) {
      scrollToQuantizedEase(scroller, nextScrollTopPx, {
        lineHeightPx: LINE_HEIGHT_PX,
      });
    } else {
      scroller.scrollTop = nextScrollTopPx;
    }
  }
}

export function Editor({ bindings, adapterRef, initialText = '', scrollbarHost = null }: EditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const scrollbarTrackRef = useRef<HTMLDivElement>(null);
  const lastInvariantKeyRef = useRef('');
  const lastProbeKeyRef = useRef('');
  const lastTypingEventAtRef = useRef(0);
  const rapidTypingBurstRef = useRef(0);
  const lastScrollEventAtRef = useRef(0);
  const latestTextRef = useRef('');
  const latestSelectionRef = useRef<EditorSelectionState>({
    anchor: 0,
    focus: 0,
    start: 0,
    end: 0,
    isCollapsed: true,
  });
  
  const [editorSize, setEditorSize] = useState({ width: 0, height: 0, top: 0, left: 0 });

  // Here are our user-configurable boundaries!
  const [topBoundary, setTopBoundary] = useState(144); // 6 * 24px
  const [bottomBoundary, setBottomBoundary] = useState(144); // 6 * 24px

  // Dragging state
  const [isDraggingTop, setIsDraggingTop] = useState(false);
  const [isDraggingBottom, setIsDraggingBottom] = useState(false);
  const [scrollThumbTopPx, setScrollThumbTopPx] = useState(0);
  const [scrollThumbHeightPx, setScrollThumbHeightPx] = useState(0);
  const [isScrollThumbActive, setIsScrollThumbActive] = useState(false);
  const [isDraggingScrollThumb, setIsDraggingScrollThumb] = useState(false);
  const scrollThumbDragOriginRef = useRef<{ pointerY: number; thumbTopPx: number } | null>(null);
  const scrollbarSyncRafRef = useRef<number | null>(null);

  const reportInvariantIssues = (context: string, issues: string[]) => {
    if (!ENABLE_CONTRACT_ASSERTIONS || issues.length === 0) return;
    const key = `${context}|${issues.join('|')}`;
    if (key === lastInvariantKeyRef.current) return;
    lastInvariantKeyRef.current = key;
    console.warn(`[editor-contract:${context}]`, issues);
  };

  const reportProbe = (context: string, payload: Record<string, unknown>) => {
    if (!ENABLE_SCENARIO_PROBES) return;
    const key = `${context}|${JSON.stringify(payload)}`;
    if (key === lastProbeKeyRef.current) return;
    lastProbeKeyRef.current = key;
    logScenarioProbe(context, payload, true);
  };

  const handleTextChange = (event: EditorTextChangeEvent) => {
    latestTextRef.current = event.text;
    latestSelectionRef.current = event.selection;
    reportInvariantIssues('text-change', [
      ...validateTextInvariants(event.text),
      ...validateSelectionInvariants(event.text, event.selection),
    ]);
    bindings?.onTextChange?.(event);
  };

  const handleSelectionChange = (event: EditorSelectionChangeEvent) => {
    latestSelectionRef.current = event.selection;
    reportInvariantIssues('selection-change', validateSelectionInvariants(latestTextRef.current, event.selection));
    bindings?.onSelectionChange?.(event);
  };

  const buildViewport = useCallback((): EditorViewportState => ({
    topBoundaryPx: topBoundary,
    bottomBoundaryPx: bottomBoundary,
    scrollTopPx: scrollerRef.current?.scrollTop ?? 0,
    lineHeightPx: LINE_HEIGHT_PX,
    cellWidthPx: CELL_WIDTH_PX,
  }), [topBoundary, bottomBoundary]);

  const syncCustomScrollbar = useCallback(() => {
    const scroller = scrollerRef.current;
    const track = scrollbarTrackRef.current;
    if (!scroller || !track) return;

    const viewportHeight = scroller.clientHeight;
    const contentHeight = scroller.scrollHeight;
    const trackHeight = track.clientHeight;
    const usableTrackHeight = Math.max(0, trackHeight - (SCROLL_TRACK_EDGE_GAP_PX * 2));
    if (viewportHeight <= 0 || contentHeight <= 0 || trackHeight <= 0) {
      setScrollThumbHeightPx(0);
      setScrollThumbTopPx(0);
      setIsScrollThumbActive(false);
      return;
    }

    if (contentHeight <= viewportHeight) {
      setScrollThumbHeightPx(usableTrackHeight);
      setScrollThumbTopPx(SCROLL_TRACK_EDGE_GAP_PX);
      setIsScrollThumbActive(false);
      return;
    }

    const visibleRatio = viewportHeight / contentHeight;
    const nextThumbHeight = Math.max(
      SCROLL_TRACK_MIN_THUMB_HEIGHT_PX,
      Math.min(usableTrackHeight, Math.round(usableTrackHeight * visibleRatio)),
    );

    const maxScrollTop = contentHeight - viewportHeight;
    const maxThumbTop = Math.max(0, usableTrackHeight - nextThumbHeight);
    const scrollRatio = maxScrollTop > 0 ? scroller.scrollTop / maxScrollTop : 0;
    const nextThumbTop = SCROLL_TRACK_EDGE_GAP_PX + Math.round(maxThumbTop * scrollRatio);

    setScrollThumbHeightPx(nextThumbHeight);
    setScrollThumbTopPx(nextThumbTop);
    setIsScrollThumbActive(true);
  }, []);

  const scrollFromThumbTop = useCallback((thumbTopPx: number) => {
    const scroller = scrollerRef.current;
    const track = scrollbarTrackRef.current;
    if (!scroller || !track) return;

    const trackHeight = track.clientHeight;
    const usableTrackHeight = Math.max(0, trackHeight - (SCROLL_TRACK_EDGE_GAP_PX * 2));
    const maxThumbTravel = Math.max(0, usableTrackHeight - scrollThumbHeightPx);
    const minThumbTop = SCROLL_TRACK_EDGE_GAP_PX;
    const maxThumbTop = SCROLL_TRACK_EDGE_GAP_PX + maxThumbTravel;
    const clampedTop = Math.max(minThumbTop, Math.min(thumbTopPx, maxThumbTop));
    const maxScrollTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
    const ratio = maxThumbTravel > 0 ? (clampedTop - SCROLL_TRACK_EDGE_GAP_PX) / maxThumbTravel : 0;
    const targetScrollTop = ratio * maxScrollTop;
    const quantizedScrollTop = clampNumber(
      Math.round(targetScrollTop / LINE_HEIGHT_PX) * LINE_HEIGHT_PX,
      0,
      maxScrollTop,
    );
    scroller.scrollTop = quantizedScrollTop;
  }, [scrollThumbHeightPx]);

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
  }, [syncCustomScrollbar, initialText]);

  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;

    const onScroll = () => {
      lastScrollEventAtRef.current = performance.now();
      const viewport = buildViewport();
      reportInvariantIssues('viewport-scroll', validateViewportInvariants(viewport));
      bindings?.onViewportChange?.({ source: 'user-input', viewport });
      syncCustomScrollbar();
    };

    scroller.addEventListener('scroll', onScroll, { passive: true });
    return () => scroller.removeEventListener('scroll', onScroll);
  }, [bindings, buildViewport, syncCustomScrollbar]);

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
        };
      },
      applySnapshot(snapshot: Partial<EditorSnapshot>) {
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

          if (typeof nextViewport.topBoundaryPx === 'number') {
            const quantized = Math.max(0, Math.round(nextViewport.topBoundaryPx / LINE_HEIGHT_PX) * LINE_HEIGHT_PX);
            setTopBoundary(Math.min(quantized, h));
          }
          if (typeof nextViewport.bottomBoundaryPx === 'number') {
            const requestedTopEdge = topEdgeFromBottomBoundary(h, nextViewport.bottomBoundaryPx);
            setBottomBoundary(bottomBoundaryFromTopEdge(h, requestedTopEdge));
          }
          if (typeof nextViewport.scrollTopPx === 'number' && scrollerRef.current) {
            scrollerRef.current.scrollTo({ top: Math.max(0, nextViewport.scrollTopPx), behavior: 'auto' });
          }
          appliedViewport = true;
        }

        if (snapshot.selection) {
          const rootEl = scrollerRef.current?.querySelector('.editor-text');
          if (rootEl instanceof HTMLElement) {
            const canonicalText = collapseEditorSeparators(latestTextRef.current);
            const textLength = canonicalText.length;
            const anchor = clampNumber(snapshot.selection.anchor, 0, textLength);
            const focus = clampNumber(snapshot.selection.focus, 0, textLength);
            applyDomSelectionFromOffsets(rootEl, canonicalText, anchor, focus);

            const scroller = scrollerRef.current;
            if (scroller) {
              // Reconcile after selection is in DOM so focus stays inside the middle cage.
              const shouldAnimateSelectionJump = !snapshot.selection.isCollapsed;
              centerSelectionInCagedMiddle(scroller, topBoundary, bottomBoundary, {
                animate: shouldAnimateSelectionJump,
              });
              requestAnimationFrame(() => centerSelectionInCagedMiddle(scroller, topBoundary, bottomBoundary, {
                animate: shouldAnimateSelectionJump,
              }));
            }
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
  }, [adapterRef, buildViewport]);

  useEffect(() => {
    const updateSize = () => {
      if (!containerRef.current) return;
      const container = containerRef.current;
      const rect = container.getBoundingClientRect();
      const framePaddingPx = readEditorFramePaddingPx(container);
      const availableInnerWidth = Math.max(1, rect.width - (framePaddingPx * 2));
      const availableInnerHeight = Math.max(LINE_HEIGHT_PX, rect.height - (framePaddingPx * 2));
      
      // Keep the editor viewport on exact cell multiples so separator math,
      // scroll cage math, and rendered grid rows share the same lattice.
      const snappedInnerWidth = Math.max(1, Math.floor((availableInnerWidth - 1) / CELL_WIDTH_PX) * CELL_WIDTH_PX + 1);
      const snappedInnerHeight = Math.max(LINE_HEIGHT_PX, Math.floor(availableInnerHeight / LINE_HEIGHT_PX) * LINE_HEIGHT_PX);
      const snappedWidth = snappedInnerWidth + (framePaddingPx * 2);
      const snappedHeight = snappedInnerHeight + (framePaddingPx * 2);
      
      const left = Math.floor((rect.width - snappedWidth) / 2);
      const top = Math.floor((rect.height - snappedHeight) / 2);
      
      setEditorSize({ width: snappedWidth, height: snappedHeight, left, top });
    };

    const resizeObserver = new ResizeObserver(() => updateSize());
    if (containerRef.current) resizeObserver.observe(containerRef.current);
    
    updateSize();
    return () => resizeObserver.disconnect();
  }, []);

  useEffect(() => {
    const updateLayout = () => {
      const scroller = scrollerRef.current;
      if (!scroller) return;
      const h = Math.max(0, scroller.clientHeight);
      
      // Auto-snap the bottom boundary to the absolute grid based on the current height!
      // This forces the "invisible line" to land flush with a grid row.
      setBottomBoundary(prev => {
        const topEdge = topEdgeFromBottomBoundary(h, prev);
        return bottomBoundaryFromTopEdge(h, topEdge);
      });
    };

    // Defer to next paint so the container size is resolved before quantizing boundaries.
    const frame = requestAnimationFrame(updateLayout);
    window.addEventListener('resize', updateLayout);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', updateLayout);
    };
  }, []);

  // Global Mouse listeners for Dragging
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!scrollerRef.current) return;
      const rect = scrollerRef.current.getBoundingClientRect();
      const h = Math.max(0, scrollerRef.current.clientHeight);
      const relativeY = e.clientY - rect.top;
      const clampedY = Math.max(0, Math.min(relativeY, h));

      if (isDraggingTop) {
        // Snap to 24px increments
        const snappedY = quantizeTopEdge(clampedY);
        setTopBoundary(Math.min(snappedY, h));
      } else if (isDraggingBottom) {
        // Quantize the top edge of the bottom boundary to land EXACTLY on an absolute grid line!
        // We do this by measuring from grid zero (relativeY) instead of window coordinates.
        setBottomBoundary(bottomBoundaryFromTopEdge(h, clampedY));
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
  }, [isDraggingTop, isDraggingBottom]);

  useEffect(() => {
    if (!isDraggingScrollThumb) return;

    const handleMouseMove = (event: MouseEvent) => {
      const origin = scrollThumbDragOriginRef.current;
      if (!origin) return;
      const deltaY = event.clientY - origin.pointerY;
      scrollFromThumbTop(origin.thumbTopPx + deltaY);
      syncCustomScrollbar();
    };

    const handleMouseUp = () => {
      setIsDraggingScrollThumb(false);
      scrollThumbDragOriginRef.current = null;
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDraggingScrollThumb, scrollFromThumbTop, syncCustomScrollbar]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const activeElement = document.activeElement as HTMLElement | null;
      if (!activeElement || !activeElement.classList.contains('editor-text')) return;

      const now = performance.now();
      const key = event.key;
      const isTypingKey = key.length === 1 || key === 'Enter' || key === 'Backspace' || key === 'Tab';
      if (!isTypingKey) return;

      const delta = now - lastTypingEventAtRef.current;
      rapidTypingBurstRef.current = delta < 90 ? rapidTypingBurstRef.current + 1 : 1;
      lastTypingEventAtRef.current = now;

      if (rapidTypingBurstRef.current >= 5) {
        reportProbe('rapid-input-burst', {
          key,
          burstCount: rapidTypingBurstRef.current,
          deltaMs: Math.round(delta),
          recentScrollMs: Math.round(now - lastScrollEventAtRef.current),
        });
      }

      if (key === 'Enter') {
        const scroller = scrollerRef.current;
        const caret = readCaretGeometry();
        if (!scroller || !caret) return;

        const scrollerRect = scroller.getBoundingClientRect();
        const cageTop = scrollerRect.top + topBoundary;
        const cageBottom = scrollerRect.bottom - bottomBoundary;
        const distanceToTop = caret.top - cageTop;
        const distanceToBottom = cageBottom - caret.bottom;
        const nearTop = distanceToTop <= LINE_HEIGHT_PX;
        const nearBottom = distanceToBottom <= LINE_HEIGHT_PX;

        if (nearTop || nearBottom) {
          reportProbe('enter-near-boundary', {
            nearTop,
            nearBottom,
            distanceToTop: Math.round(distanceToTop),
            distanceToBottom: Math.round(distanceToBottom),
            topBoundary,
            bottomBoundary,
            scrollTop: scroller.scrollTop,
            recentScrollMs: Math.round(now - lastScrollEventAtRef.current),
          });
        }
      }
    };

    const scroller = scrollerRef.current;
    if (!scroller) return;

    scroller.addEventListener('keydown', onKeyDown);
    return () => scroller.removeEventListener('keydown', onKeyDown);
  }, [topBoundary, bottomBoundary]);

  const handleTrackMouseDown = (event: React.MouseEvent<HTMLDivElement>) => {
    const track = scrollbarTrackRef.current;
    const scroller = scrollerRef.current;
    if (!track || !scroller) return;

    const rect = track.getBoundingClientRect();
    const clickY = event.clientY - rect.top;
    const targetThumbTop = clickY - (scrollThumbHeightPx / 2);
    const trackHeight = track.clientHeight;
    const usableTrackHeight = Math.max(0, trackHeight - (SCROLL_TRACK_EDGE_GAP_PX * 2));
    const maxThumbTravel = Math.max(0, usableTrackHeight - scrollThumbHeightPx);
    const minThumbTop = SCROLL_TRACK_EDGE_GAP_PX;
    const maxThumbTop = SCROLL_TRACK_EDGE_GAP_PX + maxThumbTravel;
    const clampedTop = Math.max(minThumbTop, Math.min(targetThumbTop, maxThumbTop));
    const maxScrollTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
    const ratio = maxThumbTravel > 0 ? (clampedTop - SCROLL_TRACK_EDGE_GAP_PX) / maxThumbTravel : 0;
    const targetScrollTop = ratio * maxScrollTop;

    scrollToQuantizedEase(scroller, targetScrollTop, {
      lineHeightPx: LINE_HEIGHT_PX,
    });
  };

  const handleThumbMouseDown = (event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDraggingScrollThumb(true);
    scrollThumbDragOriginRef.current = {
      pointerY: event.clientY,
      thumbTopPx: scrollThumbTopPx,
    };
  };

  const forwardHandleWheelToScroller = (event: React.WheelEvent<HTMLDivElement>) => {
    const scroller = scrollerRef.current;
    if (!scroller) return;

    event.preventDefault();

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
              width: editorSize.width, 
              height: editorSize.height,
              left: editorSize.left,
              top: editorSize.top,
              cursor: (isDraggingTop || isDraggingBottom) ? 'ns-resize' : 'auto',
              backgroundColor: 'transparent',
            }}
          >
            {/* Inset content surface: keeps frame gap transparent while preserving editor background. */}
            <div
              className="absolute pointer-events-none"
              style={{
                inset: 'var(--editor-frame-padding)',
                backgroundColor: 'var(--color-bg-regular)',
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
              }}
            />

            {/* The single unified full-screen grid lines */}
            <div className="absolute pointer-events-none measly-grid-lines" style={{ inset: 'var(--editor-frame-padding)', zIndex: 30 }} />
            
            {/* Top Drag Handle (Invisible, centered on the boundary line) */}
            <div 
              className="absolute left-0 right-0 z-20 bg-transparent cursor-ns-resize" 
              style={{ top: `calc(var(--editor-frame-padding) + ${topBoundary}px - 12px)`, left: 'var(--editor-frame-padding)', right: 'var(--editor-frame-padding)', height: 24 }} 
              onWheel={forwardHandleWheelToScroller}
              onMouseDown={(e) => { e.preventDefault(); setIsDraggingTop(true); }}
            />

            {/* Bottom Drag Handle */}
            <div 
              className="absolute left-0 right-0 z-20 bg-transparent cursor-ns-resize" 
              style={{ bottom: `calc(var(--editor-frame-padding) + ${bottomBoundary}px - 12px)`, left: 'var(--editor-frame-padding)', right: 'var(--editor-frame-padding)', height: 24 }} 
              onWheel={forwardHandleWheelToScroller}
              onMouseDown={(e) => { e.preventDefault(); setIsDraggingBottom(true); }}
            />

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
                    style={{ paddingTop: topBoundary, paddingBottom: bottomBoundary, paddingLeft: 0, paddingRight: 0, boxSizing: 'border-box' }}
                    spellCheck={false} 
                  />
                }
                placeholder={
                  <div className="absolute text-gray-400 pointer-events-none select-none editor-text z-0" style={{ top: topBoundary, left: 0 }}>
                    Jot down a measly note...
                  </div>
                }
                ErrorBoundary={LexicalErrorBoundary}
              />
            </div>

            {/* Native Caret Replacement overlayed in viewport space */}
            <BlockCaretPlugin
              scrollerRef={scrollerRef}
              topBoundaryPx={topBoundary}
              bottomBoundaryPx={bottomBoundary}
            />
        
            <HistoryPlugin />
            <PasteSanitizationPlugin />
            <TextSanitizationPlugin />
            <SyntaxHighlightPlugin />
            <NoteTextHydrationPlugin text={initialText} />
            <ContractBridgePlugin
              onTextChange={handleTextChange}
              onSelectionChange={handleSelectionChange}
            />
            
            {/* The Magic Cage Scroller! */}
            <CagedScrollPlugin scrollerRef={scrollerRef} topBoundaryPx={topBoundary} bottomBoundaryPx={bottomBoundary} />
          </div>
        </LexicalComposer>
      )}
      {scrollbarHost ? createPortal(scrollbarRail, scrollbarHost) : null}
    </div>
  );
}
