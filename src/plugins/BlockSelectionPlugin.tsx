import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { $getSelection, $isRangeSelection, $isElementNode, type LexicalEditor, type LexicalNode, type RangeSelection } from 'lexical';
import { readSelectionLineRects } from '../editor/SelectionRects';

const EMPTY_LINE_TOP_TOLERANCE_PX = 2;

/**
 * Top (viewport) coordinates of every empty paragraph spanned by the
 * selection, start to end inclusive. A Range crossing an empty line still
 * yields a full-width client rect for it (there's no glyph content to bound
 * it to), which would otherwise paint a stray full-row highlight on a line
 * with nothing selected -- these are filtered out by top-position match.
 */
function collectEmptyLineTops(editor: LexicalEditor, selection: RangeSelection): number[] {
  const points = selection.getStartEndPoints();
  if (!points) return [];

  const [startPoint, endPoint] = points;
  const startTop = startPoint.getNode().getTopLevelElementOrThrow();
  const endTop = endPoint.getNode().getTopLevelElementOrThrow();

  const tops: number[] = [];
  let node: LexicalNode | null = startTop;
  while (node) {
    if ($isElementNode(node) && node.getTextContentSize() === 0) {
      const el = editor.getElementByKey(node.getKey());
      if (el) {
        tops.push(el.getBoundingClientRect().top);
      }
    }
    if (node.getKey() === endTop.getKey()) break;
    node = node.getNextSibling<LexicalNode>();
  }

  return tops;
}

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

      const emptyLineTops = collectEmptyLineTops(editor, selection);

      const scrollerRect = scroller.getBoundingClientRect();
      const layerRect = highlightLayerEl.getBoundingClientRect();
      const scrollerLeftInLayer = scrollerRect.left - layerRect.left;
      const scrollerTopInLayer = scrollerRect.top - layerRect.top;
      const runtimeCellWidthPx = resolveRuntimeCellWidthPx(editor.getRootElement(), cellWidthPx);
      const scrollerWidth = scroller.clientWidth;

      // A heading or bold span can make Chromium report the same visual
      // row as two separate rect-groups (a full-width one plus a narrower
      // one scoped to just that span, a few px apart in raw top -- outside
      // readSelectionLineRects's per-row merge tolerance since it only
      // looks at raw pixels). Left unmerged, both get rendered and their
      // overlap gets double-painted. Quantized row position is the actual
      // grid these live on, so merge on that instead of raw proximity.
      const rowsByQuantizedTop = new Map<number, { left: number; right: number }>();

      for (const lineRect of lineRects) {
        const isEmptyLine = emptyLineTops.some(
          (top) => Math.abs(top - lineRect.top) < EMPTY_LINE_TOP_TOLERANCE_PX,
        );
        if (isEmptyLine) continue;

        const topInScroll = (lineRect.top - scrollerRect.top) + scroller.scrollTop;
        const quantizedRowTopInScroll = Math.round(topInScroll / lineHeightPx) * lineHeightPx;

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

        const existingRow = rowsByQuantizedTop.get(quantizedRowTopInScroll);
        if (existingRow) {
          existingRow.left = Math.min(existingRow.left, quantizedLeft);
          existingRow.right = Math.max(existingRow.right, quantizedRight);
        } else {
          rowsByQuantizedTop.set(quantizedRowTopInScroll, { left: quantizedLeft, right: quantizedRight });
        }
      }

      const nextRects: HighlightRect[] = [];

      for (const [quantizedRowTopInScroll, row] of rowsByQuantizedTop) {
        const topInViewport = quantizedRowTopInScroll - scroller.scrollTop;

        const visibleTop = Math.max(0, topInViewport);
        const visibleBottom = Math.min(scroller.clientHeight, topInViewport + lineHeightPx);
        const visibleHeight = visibleBottom - visibleTop;
        if (visibleHeight <= 0) continue;

        const clippedLeft = Math.max(0, row.left);
        const clippedRight = Math.min(scrollerWidth, row.right);
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
