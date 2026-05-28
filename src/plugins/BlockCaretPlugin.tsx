import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { $getRoot, $getSelection, $isRangeSelection } from 'lexical';
import { readSelectionRect } from '../editor/CaretRect';
import { resolveCaretTopInScroll } from '../editor/CaretVisualPosition';
import { resolveCagedScrollTarget } from '../editor/CageMath';
import { isRefocusTransactionActive } from '../editor/RefocusTransaction';

interface BlockCaretPluginProps {
  scrollerRef: React.RefObject<HTMLElement>;
  topBoundaryPx: number;
  bottomBoundaryPx: number;
  lineHeightPx: number;
  cellWidthPx: number;
}

const CARET_INSET_PX = 1;

function resolveRuntimeCellWidthPx(rootEl: HTMLElement | null, fallbackCellWidthPx: number): number {
  if (!rootEl) {
    return fallbackCellWidthPx;
  }

  const cssValue = getComputedStyle(rootEl).getPropertyValue('--editor-cell-width').trim();
  const parsed = Number.parseFloat(cssValue);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallbackCellWidthPx;
  }

  return parsed;
}

export function BlockCaretPlugin({ scrollerRef, topBoundaryPx, bottomBoundaryPx, lineHeightPx, cellWidthPx }: BlockCaretPluginProps) {
  const [editor] = useLexicalComposerContext();
  const [caretStyle, setCaretStyle] = useState<React.CSSProperties | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const scheduleCaretUpdateRef = useRef<() => void>(() => {});

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

      const caretRect = readSelectionRect(domSelection, lineHeightPx);
      if (!caretRect) {
        setCaretStyle(null);
        return;
      }

      const scroller = scrollerRef.current;
      if (!scroller) return;
      const caretLayerEl = scroller.parentElement;
      if (!(caretLayerEl instanceof HTMLElement)) {
        setCaretStyle(null);
        return;
      }

      const scrollerRect = scroller.getBoundingClientRect();
      const caretLayerRect = caretLayerEl.getBoundingClientRect();

      const caretTopInScroll = resolveCaretTopInScroll({
        caretRect,
        scrollerRectTop: scrollerRect.top,
        scrollerScrollTop: scroller.scrollTop,
        rootEl: editor.getRootElement(),
        domSelection,
        rawText: $getRoot().getTextContent(),
        lineHeightPx,
      });

      const isCagedRefocusActive = isRefocusTransactionActive(scroller);
      if (isCagedRefocusActive) {
        const { targetScrollTopPx } = resolveCagedScrollTarget({
          caretTopInScrollPx: caretTopInScroll,
          scrollerScrollTopPx: scroller.scrollTop,
          scrollerClientHeightPx: scroller.clientHeight,
          scrollerScrollHeightPx: scroller.scrollHeight,
          topBoundaryPx,
          bottomBoundaryPx,
          lineHeightPx,
        });

        // While refocus is active, hide caret until centralized caged easing settles.
        if (targetScrollTopPx !== scroller.scrollTop) {
          setCaretStyle(null);
          return;
        }
      }

      const quantizedRowTopInScroll = Math.floor(caretTopInScroll / lineHeightPx) * lineHeightPx;
      const topInViewport = quantizedRowTopInScroll - scroller.scrollTop;

      if (topInViewport < 0 || topInViewport > scroller.clientHeight - lineHeightPx) {
        setCaretStyle(null);
        return;
      }

      const runtimeCellWidthPx = resolveRuntimeCellWidthPx(editor.getRootElement(), cellWidthPx);
      const scrollerLeftInLayer = scrollerRect.left - caretLayerRect.left;
      const scrollerTopInLayer = scrollerRect.top - caretLayerRect.top;
      let absoluteLeft = caretRect.left - scrollerRect.left;

      absoluteLeft = Math.round(absoluteLeft / runtimeCellWidthPx) * runtimeCellWidthPx;

      const caretWidthPx = Math.max(1, runtimeCellWidthPx - CARET_INSET_PX);
      const caretHeightPx = Math.max(1, lineHeightPx - CARET_INSET_PX);

      setCaretStyle({
        top: scrollerTopInLayer + topInViewport + CARET_INSET_PX,
        left: scrollerLeftInLayer + absoluteLeft + CARET_INSET_PX,
        width: caretWidthPx,
        height: caretHeightPx,
      });
    });
  }, [editor, scrollerRef, topBoundaryPx, bottomBoundaryPx, lineHeightPx, cellWidthPx]);

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

  scheduleCaretUpdateRef.current = scheduleCaretUpdate;

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
