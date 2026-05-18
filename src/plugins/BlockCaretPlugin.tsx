import React, { useEffect, useState, useCallback } from 'react';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { $getSelection, $isRangeSelection } from 'lexical';

export function BlockCaretPlugin({ scrollerRef }: { scrollerRef: React.RefObject<HTMLElement> }) {
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

      let absoluteTop = (top - scrollerRect.top) + scroller.scrollTop;
      let absoluteLeft = (left - scrollerRect.left) + scroller.scrollLeft;

      // Quantize coordinates to lock perfectly into the CRT grid.
      // Since our grid background is aligned to 0px 0px, our caret should snap to exact multiples of 10 and 24.
      absoluteLeft = Math.round(absoluteLeft / 10) * 10;
      absoluteTop = Math.round(absoluteTop / 24) * 24;

      setCaretStyle({
        top: absoluteTop,
        left: absoluteLeft,
        width: 10,   // var(--editor-cell-width)
        height: 24,  // var(--editor-line-height)
      });
    });
  }, [editor, scrollerRef]);

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
