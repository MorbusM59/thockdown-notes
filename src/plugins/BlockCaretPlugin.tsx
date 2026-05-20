import React, { useEffect, useState, useCallback } from 'react';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { $getSelection, $isRangeSelection } from 'lexical';
import { getEffectiveCageBoundaries } from '../editor/ViewportCage';

interface BlockCaretPluginProps {
  scrollerRef: React.RefObject<HTMLElement>;
  topBoundaryPx: number;
  bottomBoundaryPx: number;
}

const LINE_HEIGHT_PX = 24;
const CELL_WIDTH_PX = 10;

export function BlockCaretPlugin({ scrollerRef, topBoundaryPx, bottomBoundaryPx }: BlockCaretPluginProps) {
  const [editor] = useLexicalComposerContext();
  const [caretStyle, setCaretStyle] = useState<React.CSSProperties | null>(null);

  const updateCaret = useCallback(() => {
    editor.getEditorState().read(() => {
      const selection = $getSelection();
      
      // Only render caret when selection is a collapsed single point
      if (!$isRangeSelection(selection) || !selection.isCollapsed()) {
        setCaretStyle(null);
        return;
      }

      const domSelection = window.getSelection();
      if (!domSelection || domSelection.rangeCount === 0) {
        setCaretStyle(null);
        return;
      }

      // Hide custom caret if the editor does not have focus
      if (document.activeElement !== editor.getRootElement()) {
        setCaretStyle(null);
        return;
      }

      const range = domSelection.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      let top = rect.top;
      let left = rect.left;

      // Handle completely empty lines returning 0,0 bounding box
      if (top === 0 && left === 0) {
        const anchorNode = domSelection.anchorNode;
        const element = anchorNode?.nodeType === Node.ELEMENT_NODE 
          ? (anchorNode as Element) 
          : anchorNode?.parentElement;
        if (element) {
          const elementRect = element.getBoundingClientRect();
          top = elementRect.top;
          left = elementRect.left;
        }
      }

      if (top === 0 && left === 0) {
        setCaretStyle(null);
        return;
      }

      // We need absolute coordinates scoped entirely inside our scrolling <div>!
      const scroller = scrollerRef.current;
      if (!scroller) return;
      
      const scrollerRect = scroller.getBoundingClientRect();
      const maxScrollTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
      const effective = getEffectiveCageBoundaries({
        scrollTop: scroller.scrollTop,
        maxScrollTop,
        topBoundaryPx,
        bottomBoundaryPx,
      });

      let absoluteTop = (top - scrollerRect.top) + scroller.scrollTop;
      let absoluteLeft = (left - scrollerRect.left) + scroller.scrollLeft;

      // Quantize coordinates to lock perfectly into the CRT grid.
      // Since our grid background is aligned to 0px 0px, our caret should snap to exact multiples of 10 and 24.
      absoluteLeft = Math.round(absoluteLeft / CELL_WIDTH_PX) * CELL_WIDTH_PX;
      absoluteTop = Math.round(absoluteTop / LINE_HEIGHT_PX) * LINE_HEIGHT_PX;

      // Keep the visual caret strictly inside the caged middle section.
      const minTop = scroller.scrollTop + effective.topPx;
      const maxTop = scroller.scrollTop + Math.max(effective.topPx, scroller.clientHeight - effective.bottomPx - LINE_HEIGHT_PX);
      absoluteTop = Math.max(minTop, Math.min(maxTop, absoluteTop));

      setCaretStyle({
        top: absoluteTop,
        left: absoluteLeft,
        width: CELL_WIDTH_PX,
        height: LINE_HEIGHT_PX,
      });
    });
  }, [editor, scrollerRef, topBoundaryPx, bottomBoundaryPx]);

  useEffect(() => {
    const removeUpdateListener = editor.registerUpdateListener(() => updateCaret());
    document.addEventListener('selectionchange', updateCaret);
    window.addEventListener('resize', updateCaret);

    // Track scroll events explicitly
    const scroller = scrollerRef.current;
    if (scroller) {
      scroller.addEventListener('scroll', updateCaret);
    }

    return () => {
      removeUpdateListener();
      document.removeEventListener('selectionchange', updateCaret);
      window.removeEventListener('resize', updateCaret);
      if (scroller) {
        scroller.removeEventListener('scroll', updateCaret);
      }
    };
  }, [editor, updateCaret, scrollerRef]);

  if (!caretStyle) return null;

  return (
    <div 
      className="measly-block-caret"
      style={{
        position: 'absolute',
        pointerEvents: 'none',
        zIndex: 50,
        ...caretStyle
      }}
    />
  );
}
