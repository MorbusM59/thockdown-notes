import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { $getRoot, $getSelection, $isRangeSelection, COMMAND_PRIORITY_LOW, KEY_DOWN_COMMAND } from 'lexical';
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
  // scrollerRect/caretLayerRect don't change on a plain text keystroke --
  // only the selection Range rect does. Cache them across updateCaret calls
  // and only re-measure when a resize invalidates the cache, cutting 2 of
  // the ~4 forced synchronous layout reads paid on every keystroke.
  const scrollerRectRef = useRef<DOMRect | null>(null);
  const caretLayerRectRef = useRef<DOMRect | null>(null);
  // One-shot signal: set on an End/Shift+End keydown, consumed (and cleared)
  // by the very next updateCaret run. End's intent is "stay on this line,"
  // the opposite of the general downstream-at-a-wrap-join default -- see
  // readSelectionRect's forceUpstreamAffinity param.
  const forceUpstreamAffinityRef = useRef(false);

  const invalidateRectCache = useCallback(() => {
    scrollerRectRef.current = null;
    caretLayerRectRef.current = null;
  }, []);

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

      const forceUpstreamAffinity = forceUpstreamAffinityRef.current;
      forceUpstreamAffinityRef.current = false;

      const caretRect = readSelectionRect(domSelection, lineHeightPx, editor.getRootElement(), forceUpstreamAffinity);
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

      if (!scrollerRectRef.current) {
        scrollerRectRef.current = scroller.getBoundingClientRect();
      }
      if (!caretLayerRectRef.current) {
        caretLayerRectRef.current = caretLayerEl.getBoundingClientRect();
      }
      const scrollerRect = scrollerRectRef.current;
      const caretLayerRect = caretLayerRectRef.current;

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

      // Math.round, not Math.floor: the real DOM caret rect lands within a
      // few px of each row's exact multiple of lineHeightPx, but which side
      // of the boundary it lands on depends on the active font's baseline/
      // hinting (e.g. Lekton measured ~1px *above* a row's clean multiple,
      // 311px against a 312px boundary, where Math.floor(311/26)=11 instead
      // of the intended 12). Flooring assumed that jitter only ever
      // overshoots the boundary; rounding tolerates it in either direction.
      const quantizedRowTopInScroll = Math.round(caretTopInScroll / lineHeightPx) * lineHeightPx;
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

      // Positioned via transform instead of top/left so caret movement is a
      // compositor-only operation (no layout/paint of the surrounding
      // stacking context on every keystroke).
      setCaretStyle({
        transform: `translate3d(${scrollerLeftInLayer + absoluteLeft + CARET_INSET_PX}px, ${scrollerTopInLayer + topInViewport + CARET_INSET_PX}px, 0)`,
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

  const scheduleCaretUpdateAfterResize = useCallback(() => {
    invalidateRectCache();
    scheduleCaretUpdate();
  }, [invalidateRectCache, scheduleCaretUpdate]);

  useEffect(() => {
    const removeUpdateListener = editor.registerUpdateListener(() => scheduleCaretUpdate());
    // Every keydown updates the flag (true only for End) rather than just
    // setting it on End, so a stale request can't survive past whatever key
    // the user actually presses next.
    const removeKeyDownListener = editor.registerCommand(
      KEY_DOWN_COMMAND,
      (event: KeyboardEvent) => {
        forceUpstreamAffinityRef.current = event.key === 'End';
        return false;
      },
      COMMAND_PRIORITY_LOW,
    );
    window.addEventListener('resize', scheduleCaretUpdateAfterResize);

    // Neither editor.registerUpdateListener nor the scroll/resize listeners
    // fire when THIS editor loses or gains DOM focus (e.g. clicking into a
    // different split-view section) -- updateCaret's own focus check only
    // gets re-evaluated as a side effect of state/scroll changes. Without
    // this, switching sections leaves the previously-focused editor's caret
    // frozen on screen instead of disappearing.
    document.addEventListener('focusin', scheduleCaretUpdate, true);
    document.addEventListener('focusout', scheduleCaretUpdate, true);

    const scroller = scrollerRef.current;
    if (scroller) {
      scroller.addEventListener('scroll', scheduleCaretUpdate);
    }

    // Covers layout shifts that don't fire a window resize event (sidebar
    // toggle, split-view pane resize, font-size change) -- anything that
    // moves or resizes the scroller/caret-layer needs to invalidate the
    // cached rects from B1, not just window-level resizes.
    let resizeObserver: ResizeObserver | null = null;
    const caretLayerEl = scroller?.parentElement;
    if (typeof ResizeObserver !== 'undefined' && scroller) {
      resizeObserver = new ResizeObserver(() => scheduleCaretUpdateAfterResize());
      resizeObserver.observe(scroller);
      if (caretLayerEl instanceof HTMLElement && caretLayerEl !== scroller) {
        resizeObserver.observe(caretLayerEl);
      }
    }

    scheduleCaretUpdate();

    return () => {
      if (animationFrameRef.current !== null) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
      removeUpdateListener();
      removeKeyDownListener();
      window.removeEventListener('resize', scheduleCaretUpdateAfterResize);
      document.removeEventListener('focusin', scheduleCaretUpdate, true);
      document.removeEventListener('focusout', scheduleCaretUpdate, true);
      if (scroller) {
        scroller.removeEventListener('scroll', scheduleCaretUpdate);
      }
      resizeObserver?.disconnect();
    };
  }, [editor, scheduleCaretUpdate, scheduleCaretUpdateAfterResize, scrollerRef]);

  if (!caretStyle) return null;

  return (
    <div
      className="thockdown-block-caret"
      style={{
        position: 'absolute',
        pointerEvents: 'none',
        zIndex: 5,
        top: 0,
        left: 0,
        willChange: 'transform',
        ...caretStyle
      }}
    />
  );
}
