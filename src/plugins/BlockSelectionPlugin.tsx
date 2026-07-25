import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { $getSelection, $isRangeSelection } from 'lexical';
import { readSelectionLineRects } from '../editor/SelectionRects';

interface BlockSelectionPluginProps {
  scrollerRef: React.RefObject<HTMLElement>;
  lineHeightPx: number;
  cellWidthPx: number;
}

interface HighlightRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

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

export function BlockSelectionPlugin({ scrollerRef, lineHeightPx, cellWidthPx }: BlockSelectionPluginProps) {
  const [editor] = useLexicalComposerContext();
  const [highlightRects, setHighlightRects] = useState<HighlightRect[]>([]);
  const animationFrameRef = useRef<number | null>(null);

  const updateSelection = useCallback(() => {
    editor.getEditorState().read(() => {
      const selection = $getSelection();

      if (!$isRangeSelection(selection) || selection.isCollapsed()) {
        setHighlightRects([]);
        return;
      }

      const domSelection = window.getSelection();
      if (!domSelection || domSelection.rangeCount === 0 || domSelection.isCollapsed) {
        setHighlightRects([]);
        return;
      }

      if (document.activeElement !== editor.getRootElement()) {
        setHighlightRects([]);
        return;
      }

      const scroller = scrollerRef.current;
      if (!scroller) return;
      const highlightLayerEl = scroller.parentElement;
      if (!(highlightLayerEl instanceof HTMLElement)) {
        setHighlightRects([]);
        return;
      }

      const lineRects = readSelectionLineRects(domSelection.getRangeAt(0));
      if (lineRects.length === 0) {
        setHighlightRects([]);
        return;
      }

      const scrollerRect = scroller.getBoundingClientRect();
      const layerRect = highlightLayerEl.getBoundingClientRect();
      const scrollerLeftInLayer = scrollerRect.left - layerRect.left;
      const scrollerTopInLayer = scrollerRect.top - layerRect.top;
      const runtimeCellWidthPx = resolveRuntimeCellWidthPx(editor.getRootElement(), cellWidthPx);
      const scrollerWidth = scroller.clientWidth;

      const nextRects: HighlightRect[] = [];

      for (const lineRect of lineRects) {
        const topInScroll = (lineRect.top - scrollerRect.top) + scroller.scrollTop;
        const quantizedRowTopInScroll = Math.round(topInScroll / lineHeightPx) * lineHeightPx;
        const topInViewport = quantizedRowTopInScroll - scroller.scrollTop;

        const visibleTop = Math.max(0, topInViewport);
        const visibleBottom = Math.min(scroller.clientHeight, topInViewport + lineHeightPx);
        const visibleHeight = visibleBottom - visibleTop;
        if (visibleHeight <= 0) continue;

        // Native selection rects are anchored to each glyph's own visual
        // position, which the centering transform insets from the "ideal"
        // grid box edge by half the letter-spacing gap -- see index.css's
        // comment on .editor-text::selection. Rounding both edges to the
        // nearest cell boundary recovers the intended column indices
        // regardless of that constant offset.
        const rawLeft = lineRect.left - scrollerRect.left;
        const rawRight = lineRect.right - scrollerRect.left;
        const quantizedLeft = Math.round(rawLeft / runtimeCellWidthPx) * runtimeCellWidthPx;
        const quantizedRight = Math.round(rawRight / runtimeCellWidthPx) * runtimeCellWidthPx;

        const clippedLeft = Math.max(0, quantizedLeft);
        const clippedRight = Math.min(scrollerWidth, quantizedRight);
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
    });
  }, [editor, scrollerRef, lineHeightPx, cellWidthPx]);

  const scheduleUpdate = useCallback(() => {
    if (animationFrameRef.current !== null) {
      cancelAnimationFrame(animationFrameRef.current);
    }

    animationFrameRef.current = requestAnimationFrame(() => {
      animationFrameRef.current = null;
      updateSelection();
    });
  }, [updateSelection]);

  useEffect(() => {
    const removeUpdateListener = editor.registerUpdateListener(() => scheduleUpdate());
    window.addEventListener('resize', scheduleUpdate);
    document.addEventListener('focusin', scheduleUpdate, true);
    document.addEventListener('focusout', scheduleUpdate, true);

    const scroller = scrollerRef.current;
    if (scroller) {
      scroller.addEventListener('scroll', scheduleUpdate);
    }

    scheduleUpdate();

    return () => {
      if (animationFrameRef.current !== null) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
      removeUpdateListener();
      window.removeEventListener('resize', scheduleUpdate);
      document.removeEventListener('focusin', scheduleUpdate, true);
      document.removeEventListener('focusout', scheduleUpdate, true);
      if (scroller) {
        scroller.removeEventListener('scroll', scheduleUpdate);
      }
    };
  }, [editor, scheduleUpdate, scrollerRef]);

  if (highlightRects.length === 0) return null;

  return (
    <>
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
    </>
  );
}
