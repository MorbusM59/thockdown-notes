import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { $getRoot, $getSelection, $isRangeSelection } from 'lexical';
import { readSelectionRect } from '../editor/CaretRect';
import { resolveCaretTopInScroll } from '../editor/CaretVisualPosition';
import { CELL_WIDTH_PX, LINE_HEIGHT_PX } from '../editor/LayoutConstants';
import { resolveCagedScrollTarget } from '../editor/CageMath';

interface BlockCaretPluginProps {
  scrollerRef: React.RefObject<HTMLElement>;
  topBoundaryPx: number;
  bottomBoundaryPx: number;
}

export function BlockCaretPlugin({ scrollerRef, topBoundaryPx, bottomBoundaryPx }: BlockCaretPluginProps) {
  const [editor] = useLexicalComposerContext();
  const [caretStyle, setCaretStyle] = useState<React.CSSProperties | null>(null);
  const animationFrameRef = useRef<number | null>(null);

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

      const caretTopInScroll = resolveCaretTopInScroll({
        caretRect,
        scrollerRectTop: scrollerRect.top,
        scrollerScrollTop: scroller.scrollTop,
        rootEl: editor.getRootElement(),
        domSelection,
        rawText: $getRoot().getTextContent(),
        lineHeightPx: LINE_HEIGHT_PX,
      });

      const { targetScrollTopPx } = resolveCagedScrollTarget({
        caretTopInScrollPx: caretTopInScroll,
        scrollerScrollTopPx: scroller.scrollTop,
        scrollerClientHeightPx: scroller.clientHeight,
        scrollerScrollHeightPx: scroller.scrollHeight,
        topBoundaryPx,
        bottomBoundaryPx,
        lineHeightPx: LINE_HEIGHT_PX,
      });

      // Never paint from a pre-correction state; reconcile scroll first.
      if (targetScrollTopPx !== scroller.scrollTop) {
        scroller.scrollTop = targetScrollTopPx;
      }

      const quantizedRowTopInScroll = Math.floor(caretTopInScroll / LINE_HEIGHT_PX) * LINE_HEIGHT_PX;
      const topInViewport = quantizedRowTopInScroll - targetScrollTopPx;

      let absoluteLeft = caretRect.left - scrollerRect.left;

      absoluteLeft = Math.round(absoluteLeft / CELL_WIDTH_PX) * CELL_WIDTH_PX;

      const minTop = topBoundaryPx;
      const maxTop = Math.max(topBoundaryPx, scroller.clientHeight - bottomBoundaryPx - LINE_HEIGHT_PX);
      const clampedTop = Math.max(minTop, Math.min(maxTop, topInViewport));

      setCaretStyle({
        top: clampedTop,
        left: absoluteLeft,
        width: CELL_WIDTH_PX,
        height: LINE_HEIGHT_PX,
      });
    });
  }, [editor, scrollerRef, topBoundaryPx, bottomBoundaryPx]);

  const scheduleCaretUpdate = useCallback(() => {
    if (animationFrameRef.current !== null) {
      cancelAnimationFrame(animationFrameRef.current);
    }

    // Resolve geometry once per frame after selection/scroll layout has settled.
    animationFrameRef.current = requestAnimationFrame(() => {
      animationFrameRef.current = null;
      updateCaret();
    });
  }, [updateCaret]);

  useEffect(() => {
    const removeUpdateListener = editor.registerUpdateListener(() => scheduleCaretUpdate());
    window.addEventListener('resize', scheduleCaretUpdate);

    const scroller = scrollerRef.current;
    if (scroller) {
      scroller.addEventListener('scroll', scheduleCaretUpdate);
    }

    scheduleCaretUpdate();

    return () => {
      if (animationFrameRef.current !== null) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
      removeUpdateListener();
      window.removeEventListener('resize', scheduleCaretUpdate);
      if (scroller) {
        scroller.removeEventListener('scroll', scheduleCaretUpdate);
      }
    };
  }, [editor, scheduleCaretUpdate, scrollerRef]);

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
