import React, { useRef, useState, useEffect, useCallback } from 'react';
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

const theme = {
  paragraph: 'editor-paragraph',
};

function onError(error: Error) {
  console.error('Lexical Error:', error);
}

interface EditorProps {
  bindings?: EditorBindings;
  adapterRef?: React.MutableRefObject<EditorAdapter | null>;
}

const ENABLE_CONTRACT_ASSERTIONS = import.meta.env.DEV;
const ENABLE_SCENARIO_PROBES = import.meta.env.DEV;

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

export function Editor({ bindings, adapterRef }: EditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
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
    const scroller = scrollerRef.current;
    if (!scroller) return;

    const onScroll = () => {
      const viewport = buildViewport();
      reportInvariantIssues('viewport-scroll', validateViewportInvariants(viewport));
      bindings?.onViewportChange?.({ source: 'user-input', viewport });
    };

    scroller.addEventListener('scroll', onScroll, { passive: true });
    return () => scroller.removeEventListener('scroll', onScroll);
  }, [bindings, buildViewport]);

  useEffect(() => {
    if (!adapterRef) return;

    adapterRef.current = {
      getCapabilities() {
        return {
          textEvents: true,
          selectionEvents: true,
          viewportEvents: true,
          snapshotRead: true,
          snapshotWrite: true,
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
        if (!nextViewport) return;

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
        reportInvariantIssues('snapshot-apply', validateViewportInvariants(buildViewport()));
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
      const rect = containerRef.current.getBoundingClientRect();
      
      // Keep the editor viewport on exact cell multiples so separator math,
      // scroll cage math, and rendered grid rows share the same lattice.
      const snappedWidth = Math.max(1, Math.floor((rect.width - 1) / 10) * 10 + 1);
      const snappedHeight = Math.max(24, Math.floor(rect.height / 24) * 24);
      
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
    const scroller = scrollerRef.current;
    if (!scroller) return;

    const onScroll = () => {
      lastScrollEventAtRef.current = performance.now();
    };

    scroller.addEventListener('scroll', onScroll, { passive: true });
    return () => scroller.removeEventListener('scroll', onScroll);
  }, []);

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

  const initialConfig = {
    namespace: 'MeaslyNotes',
    theme,
    onError,
    nodes: [MeaslyTokenNode],
  };

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
              backgroundColor: 'var(--color-bg-regular)'
            }}
          >
            {/* Background color for top and bottom zones */}
            <div className="absolute left-0 right-0 pointer-events-none" style={{ top: 0, height: topBoundary, backgroundColor: 'var(--color-bg-leading)' }} />
            <div className="absolute left-0 right-0 pointer-events-none" style={{ bottom: 0, height: bottomBoundary, backgroundColor: 'var(--color-bg-trailing)' }} />

            {/* The single unified full-screen grid lines */}
            <div className="absolute inset-0 pointer-events-none measly-grid-lines" />
            
            {/* Top Drag Handle (Invisible, centered on the boundary line) */}
            <div 
              className="absolute left-0 right-0 z-20 bg-transparent cursor-ns-resize" 
              style={{ top: topBoundary - 12, height: 24 }} 
              onMouseDown={(e) => { e.preventDefault(); setIsDraggingTop(true); }}
            />

            {/* Bottom Drag Handle */}
            <div 
              className="absolute left-0 right-0 z-20 bg-transparent cursor-ns-resize" 
              style={{ bottom: bottomBoundary - 12, height: 24 }} 
              onMouseDown={(e) => { e.preventDefault(); setIsDraggingBottom(true); }}
            />

            {/* Actual Scroller */}
            <div 
              ref={scrollerRef}
              className="absolute inset-0 overflow-y-auto overflow-x-hidden outline-none z-10 measly-custom-scrollbar"
              style={{ scrollBehavior: 'auto' }}
            >
              <RichTextPlugin
                contentEditable={
                  <ContentEditable 
                    className="outline-none text-gray-800 editor-text min-h-full w-full relative z-10"
                    style={{ paddingTop: topBoundary, paddingBottom: bottomBoundary, paddingLeft: 40, paddingRight: 40, boxSizing: 'border-box' }}
                    spellCheck={false} 
                  />
                }
                placeholder={
                  <div className="absolute text-gray-400 pointer-events-none select-none editor-text z-0" style={{ top: topBoundary, left: 40 }}>
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
            <SyntaxHighlightPlugin />
            <ContractBridgePlugin
              onTextChange={handleTextChange}
              onSelectionChange={handleSelectionChange}
            />
            
            {/* The Magic Cage Scroller! */}
            <CagedScrollPlugin scrollerRef={scrollerRef} topBoundaryPx={topBoundary} bottomBoundaryPx={bottomBoundary} />
          </div>
        </LexicalComposer>
      )}
    </div>
  );
}
