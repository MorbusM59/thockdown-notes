import React, { useEffect, useState, useCallback } from 'react';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { $getRoot, $getSelection, $isRangeSelection } from 'lexical';
import { readSelectionRect } from '../editor/CaretRect';
import { normalizePlainText, readSelectionStateFromDom } from '../editor/SelectionOffsets';

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

      if (!$isRangeSelection(selection) || !selection.isCollapsed()) {
        setCaretStyle(null);
        return;
      }

      const domSelection = window.getSelection();
      if (!domSelection || domSelection.rangeCount === 0) {
        setCaretStyle(null);
        return;
      }

      if (document.activeElement !== editor.getRootElement()) {
        setCaretStyle(null);
        return;
      }

      const caretRect = readSelectionRect(domSelection, LINE_HEIGHT_PX);
      if (!caretRect) {
        setCaretStyle(null);
        return;
      }

      const scroller = scrollerRef.current;
      if (!scroller) return;

      const scrollerRect = scroller.getBoundingClientRect();

      let terminalVisualOffsetPx = 0;
      if (caretRect.source === 'adjacent-probe' || caretRect.source === 'anchor-fallback') {
        const rootEl = editor.getRootElement();
        if (rootEl) {
          const normalizedText = normalizePlainText($getRoot().getTextContent());
          const selectionState = readSelectionStateFromDom(rootEl, domSelection, normalizedText.length);
          const trailingNewlines = normalizedText.match(/\n+$/)?.[0].length ?? 0;
          const trailingExtraRows = Math.max(0, trailingNewlines - 1);

          if (selectionState.isCollapsed && selectionState.anchor === normalizedText.length && trailingExtraRows > 0) {
            terminalVisualOffsetPx = trailingExtraRows * LINE_HEIGHT_PX;
          }
        }
      }

      let absoluteTop = (caretRect.top - scrollerRect.top) + scroller.scrollTop + terminalVisualOffsetPx;
      let absoluteLeft = (caretRect.left - scrollerRect.left) + scroller.scrollLeft;

      absoluteLeft = Math.round(absoluteLeft / CELL_WIDTH_PX) * CELL_WIDTH_PX;
      absoluteTop = Math.floor(absoluteTop / LINE_HEIGHT_PX) * LINE_HEIGHT_PX;

      const minTop = scroller.scrollTop + topBoundaryPx;
      const maxTop = scroller.scrollTop + Math.max(topBoundaryPx, scroller.clientHeight - bottomBoundaryPx - LINE_HEIGHT_PX);
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
