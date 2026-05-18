import React, { useRef, useState, useEffect } from 'react';
import { LexicalComposer } from '@lexical/react/LexicalComposer';
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin';
import { ContentEditable } from '@lexical/react/LexicalContentEditable';
import { HistoryPlugin } from '@lexical/react/LexicalHistoryPlugin';
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary';
import { CagedScrollPlugin } from '../plugins/CagedScrollPlugin';
import { SyntaxHighlightPlugin } from '../plugins/SyntaxHighlightPlugin';
import { BlockCaretPlugin } from '../plugins/BlockCaretPlugin';
import { MeaslyTokenNode } from '../nodes/MeaslyTokenNode';

const theme = {
  paragraph: 'editor-paragraph',
};

function onError(error: Error) {
  console.error('Lexical Error:', error);
}

export function Editor() {
  const scrollerRef = useRef<HTMLDivElement>(null);
  
  // Here are our user-configurable boundaries!
  const [topBoundary, setTopBoundary] = useState(144); // 6 * 24px
  const [bottomBoundary, setBottomBoundary] = useState(144); // 6 * 24px

  // Dragging state
  const [isDraggingTop, setIsDraggingTop] = useState(false);
  const [isDraggingBottom, setIsDraggingBottom] = useState(false);

  useEffect(() => {
    const updateLayout = () => {
      const scroller = scrollerRef.current;
      if (!scroller) return;
      const h = scroller.clientHeight;
      
      // Auto-snap the bottom boundary to the absolute grid based on the current height!
      // This forces the "invisible line" to land flush with a grid row.
      setBottomBoundary(prev => {
        const topEdge = h - prev;
        const snappedTopEdge = Math.round(topEdge / 24) * 24;
        return h - snappedTopEdge;
      });
    };
    
    // We defer slightly on mount so the container size is physically resolved in the DOM
    setTimeout(updateLayout, 0);
    window.addEventListener('resize', updateLayout);
    return () => window.removeEventListener('resize', updateLayout);
  }, []);

  // Retro Quantized Scroll Listener
  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;

    const handleWheel = (e: WheelEvent) => {
      // Only hijack vertical scrolls
      if (Math.abs(e.deltaY) > 0) {
        e.preventDefault(); // Stop native smooth scrolling

        // Calculate scroll direction and force movement by exactly 3 lines (72px)
        const scrollAmount = Math.sign(e.deltaY) * 24 * 3;
        
        // Calculate new target and rigidly snap to the 24px grid rows
        const target = scroller.scrollTop + scrollAmount;
        const snappedTarget = Math.round(target / 24) * 24;
        
        scroller.scrollTo({
          top: snappedTarget,
          behavior: 'auto' // Instant jump
        });
      }
    };

    // Passive: false is crucial here so we can call e.preventDefault()
    scroller.addEventListener('wheel', handleWheel, { passive: false });
    return () => scroller.removeEventListener('wheel', handleWheel);
  }, []);

  // Global Mouse listeners for Dragging
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!scrollerRef.current) return;
      const rect = scrollerRef.current.getBoundingClientRect();
      const relativeY = e.clientY - rect.top;

      if (isDraggingTop) {
        // Snap to 24px increments
        const snappedY = Math.max(0, Math.round(relativeY / 24) * 24);
        setTopBoundary(snappedY);
      } else if (isDraggingBottom) {
        // Quantize the top edge of the bottom boundary to land EXACTLY on an absolute grid line!
        // We do this by measuring from grid zero (relativeY) instead of window coordinates.
        const snappedTopEdge = Math.max(0, Math.round(relativeY / 24) * 24);
        setBottomBoundary(rect.height - snappedTopEdge);
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

  const initialConfig = {
    namespace: 'MeaslyNotes',
    theme,
    onError,
    nodes: [MeaslyTokenNode],
  };

  return (
    <LexicalComposer initialConfig={initialConfig}>
      {/* Editor Container */}
      <div 
        className="w-full h-full flex flex-col relative text-left"
        style={{ cursor: (isDraggingTop || isDraggingBottom) ? 'ns-resize' : 'auto' }}
      >
        
        {/* Scrollable Viewport Wrapper */}
        <div className="flex-1 relative min-h-0 relative">
          
          {/* Top Zone Overlay */}
          <div className="zone-overlay" style={{ top: 0, height: topBoundary }} />
          {/* Top Drag Handle (Invisible, centered on the boundary line) */}
          <div 
            className="zone-drag-handle" 
            style={{ top: topBoundary - 12 }} 
            onMouseDown={(e) => { e.preventDefault(); setIsDraggingTop(true); }}
          />

          {/* Bottom Zone Overlay */}
          <div className="zone-overlay" style={{ bottom: 0, height: bottomBoundary }} />
          {/* Bottom Drag Handle */}
          <div 
            className="zone-drag-handle" 
            style={{ bottom: bottomBoundary - 12 }} 
            onMouseDown={(e) => { e.preventDefault(); setIsDraggingBottom(true); }}
          />

          {/* Actual Scroller */}
          <div 
            ref={scrollerRef}
            className="h-full w-full overflow-y-auto outline-none measly-grid-bg relative"
          >
            <RichTextPlugin
              contentEditable={
                <ContentEditable 
                  className="outline-none text-gray-800 editor-text min-h-full w-full relative z-10"
                  style={{ paddingTop: topBoundary + 4, paddingBottom: bottomBoundary, paddingLeft: 40, paddingRight: 40 }}
                  spellCheck={false} 
                />
              }
              placeholder={
                <div className="absolute text-gray-400 pointer-events-none select-none editor-text z-0" style={{ top: topBoundary + 4, left: 40 }}>
                  Jot down a measly note...
                </div>
              }
              ErrorBoundary={LexicalErrorBoundary}
            />
            {/* Native Caret Replacement! */}
            <BlockCaretPlugin scrollerRef={scrollerRef} />
          </div>
        </div>
        
        <HistoryPlugin />
        <SyntaxHighlightPlugin />
        
        {/* The Magic Cage Scroller! */}
        <CagedScrollPlugin scrollerRef={scrollerRef} topBoundaryPx={topBoundary} bottomBoundaryPx={bottomBoundary} />
      </div>
    </LexicalComposer>
  );
}
