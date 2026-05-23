import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { useEffect } from 'react';
import { $getRoot } from 'lexical';
import { readSelectionRect } from '../editor/CaretRect';
import { resolveCaretTopInScroll } from '../editor/CaretVisualPosition';
import { LINE_HEIGHT_PX, PIXELS_PER_WHEEL_UNIT } from '../editor/LayoutConstants';
import { resolveCagedScrollTarget } from '../editor/CageMath';

interface CagedScrollPluginProps {
  scrollerRef: React.RefObject<HTMLElement>;
  topBoundaryPx: number;
  bottomBoundaryPx: number;
}

type ViewportIntent = 'none' | 'refocus-caged' | 'ensure-visible';

const computeVisibleMiddleRows = (
  scrollerClientHeightPx: number,
  topBoundaryPx: number,
  bottomBoundaryPx: number,
) => {
  const middleHeightPx = Math.max(
    LINE_HEIGHT_PX,
    Math.round(scrollerClientHeightPx) - Math.round(topBoundaryPx) - Math.round(bottomBoundaryPx),
  );
  return Math.max(1, Math.floor(middleHeightPx / LINE_HEIGHT_PX));
};

export function CagedScrollPlugin({ scrollerRef, topBoundaryPx, bottomBoundaryPx }: CagedScrollPluginProps) {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    const resolveIntentScrollTarget = (intent: Exclude<ViewportIntent, 'none'>) => {
      const scroller = scrollerRef.current;
      if (!scroller) return null;

      const domSelection = window.getSelection();
      if (!domSelection || domSelection.rangeCount === 0) return null;

      const scrollerRect = scroller.getBoundingClientRect();
      const caretRect = readSelectionRect(domSelection, LINE_HEIGHT_PX);
      if (!caretRect) return null;

      let rawText = '';
      editor.getEditorState().read(() => {
        rawText = $getRoot().getTextContent();
      });

      const caretTopInScroll = resolveCaretTopInScroll({
        caretRect,
        scrollerRectTop: scrollerRect.top,
        scrollerScrollTop: scroller.scrollTop,
        rootEl: editor.getRootElement(),
        domSelection,
        rawText,
        lineHeightPx: LINE_HEIGHT_PX,
      });

      if (intent === 'refocus-caged' || intent === 'ensure-visible') {
        const { targetScrollTopPx } = resolveCagedScrollTarget({
          caretTopInScrollPx: caretTopInScroll,
          scrollerScrollTopPx: scroller.scrollTop,
          scrollerClientHeightPx: scroller.clientHeight,
          scrollerScrollHeightPx: scroller.scrollHeight,
          topBoundaryPx,
          bottomBoundaryPx,
          lineHeightPx: LINE_HEIGHT_PX,
        });

        return targetScrollTopPx;
      }

      return null;
    };

    const applyIntentReconcile = (intent: Exclude<ViewportIntent, 'none'>) => {
      const scroller = scrollerRef.current;
      if (!scroller) return;

      const targetScrollTopPx = resolveIntentScrollTarget(intent);
      if (targetScrollTopPx === null) return;

      if (targetScrollTopPx !== scroller.scrollTop) {
        scroller.scrollTop = targetScrollTopPx;
      }

      if (intent === 'refocus-caged') {
        // Keep active for sustained key-repeat; cleared on keyup.
      }

      if (intent === 'ensure-visible') {
        if (clearRefocusFlagFrame !== null) {
          cancelAnimationFrame(clearRefocusFlagFrame);
        }
        clearRefocusFlagFrame = requestAnimationFrame(() => {
          clearRefocusFlagFrame = null;
          scroller.dataset.cagedRefocusActive = '0';
        });
      }
    };

    let pendingIntent: ViewportIntent = 'none';
    let refocusFrame: number | null = null;
    let clearRefocusFlagFrame: number | null = null;
    let clearRefocusFallbackTimeout: ReturnType<typeof setTimeout> | null = null;
    const pressedRefocusKeys = new Set<string>();

    const clearCagedRefocusState = () => {
      if (!scroller) return;
      if (clearRefocusFlagFrame !== null) {
        cancelAnimationFrame(clearRefocusFlagFrame);
        clearRefocusFlagFrame = null;
      }
      if (clearRefocusFallbackTimeout !== null) {
        clearTimeout(clearRefocusFallbackTimeout);
        clearRefocusFallbackTimeout = null;
      }
      pressedRefocusKeys.clear();
      if (pendingIntent === 'refocus-caged') {
        pendingIntent = 'none';
      }
      scroller.dataset.cagedRefocusActive = '0';
    };

    const scheduleRefocus = () => {
      if (pendingIntent === 'none') return;
      if (refocusFrame !== null) {
        cancelAnimationFrame(refocusFrame);
      }

      // Reconcile after native selection/caret movement has been applied.
      refocusFrame = requestAnimationFrame(() => {
        refocusFrame = null;
        const intent = pendingIntent;
        pendingIntent = 'none';
        if (intent === 'none') return;
        applyIntentReconcile(intent);
      });
    };

    const removeUpdateListener = editor.registerUpdateListener(({ editorState }) => {
      editorState.read(() => {
        scheduleRefocus();
      });
    });

    const scroller = scrollerRef.current;
    if (scroller) {
      scroller.dataset.cagedRefocusActive = '0';
    }
    let pendingWheelPx = 0;

    const isRefocusKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return false;
      if (
        event.key === 'ArrowUp' ||
        event.key === 'ArrowDown' ||
        event.key === 'ArrowLeft' ||
        event.key === 'ArrowRight'
      ) {
        return true;
      }
      if (event.ctrlKey || event.metaKey || event.altKey) return false;
      if (event.key.length === 1) return true;
      return event.key === 'Enter' || event.key === 'Backspace' || event.key === 'Delete' || event.key === 'Tab';
    };

    const isRefocusKeyName = (key: string) => (
      key === 'ArrowUp' ||
      key === 'ArrowDown' ||
      key === 'ArrowLeft' ||
      key === 'ArrowRight' ||
      key === 'Enter' ||
      key === 'Backspace' ||
      key === 'Delete' ||
      key === 'Tab'
    );

    const handleKeyDown = (event: KeyboardEvent) => {
      if (!scroller) return;

      if (event.key === 'PageUp' || event.key === 'PageDown') {
        event.preventDefault();
        clearCagedRefocusState();

        const visibleRows = computeVisibleMiddleRows(scroller.clientHeight, topBoundaryPx, bottomBoundaryPx);
        const delta = (event.key === 'PageDown' ? 1 : -1) * visibleRows * LINE_HEIGHT_PX;

        const maxScrollTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
        const currentAligned = Math.round(scroller.scrollTop / LINE_HEIGHT_PX) * LINE_HEIGHT_PX;
        const target = Math.max(0, Math.min(maxScrollTop, currentAligned + delta));
        const quantizedTarget = Math.round(target / LINE_HEIGHT_PX) * LINE_HEIGHT_PX;

        scroller.scrollTo({ top: quantizedTarget, behavior: 'auto' });
        return;
      }

      if (isRefocusKey(event)) {
        pressedRefocusKeys.add(event.key);
        scroller.dataset.cagedRefocusActive = '1';
        pendingIntent = 'refocus-caged';

        // Fail-safe: never allow caged refocus to remain latched indefinitely.
        if (clearRefocusFallbackTimeout !== null) {
          clearTimeout(clearRefocusFallbackTimeout);
        }
        clearRefocusFallbackTimeout = setTimeout(() => {
          clearRefocusFallbackTimeout = null;
          if (pendingIntent === 'none') {
            clearCagedRefocusState();
          }
        }, 350);
      }
    };

    const handleKeyUp = (event: KeyboardEvent) => {
      if (!scroller) return;
      if (!isRefocusKeyName(event.key)) return;

      pressedRefocusKeys.delete(event.key);
      if (pressedRefocusKeys.size > 0) return;

      if (clearRefocusFlagFrame !== null) {
        cancelAnimationFrame(clearRefocusFlagFrame);
      }
      clearRefocusFlagFrame = requestAnimationFrame(() => {
        clearRefocusFlagFrame = null;
        if (pendingIntent === 'none') {
          scroller.dataset.cagedRefocusActive = '0';
        }
      });
    };

    const handleWheel = (event: WheelEvent) => {
      if (!scroller) return;
      if (event.deltaY === 0) return;

      // Wheel is always free-scroll intent and should never be caged.
      clearCagedRefocusState();

      event.preventDefault();

      let units = 0;

      if (event.deltaMode === WheelEvent.DOM_DELTA_LINE) {
        const lineUnits = Math.trunc(Math.abs(event.deltaY));
        units = Math.max(1, lineUnits) * (event.deltaY > 0 ? 1 : -1);
      } else if (event.deltaMode === WheelEvent.DOM_DELTA_PAGE) {
        const pageUnits = Math.trunc(Math.abs(event.deltaY));
        units = Math.max(1, pageUnits) * (event.deltaY > 0 ? 1 : -1);
      } else {
        pendingWheelPx += event.deltaY;
        const stepSign = pendingWheelPx < 0 ? -1 : 1;
        const unitCount = Math.floor(Math.abs(pendingWheelPx) / PIXELS_PER_WHEEL_UNIT);
        if (unitCount === 0) return;
        units = unitCount * stepSign;
        pendingWheelPx -= unitCount * PIXELS_PER_WHEEL_UNIT * stepSign;
      }

      if (units === 0) return;

      const maxScrollTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
      const target = Math.max(0, Math.min(maxScrollTop, scroller.scrollTop + units * LINE_HEIGHT_PX));
      scroller.scrollTop = Math.round(target / LINE_HEIGHT_PX) * LINE_HEIGHT_PX;
    };

    const handlePaste = () => {
      clearCagedRefocusState();
      if (scroller) {
        // Use guarded transaction so paste reconcile cannot flash a pre-cage frame.
        scroller.dataset.cagedRefocusActive = '1';
      }
      pendingIntent = 'ensure-visible';
    };

    scroller?.addEventListener('keydown', handleKeyDown);
    scroller?.addEventListener('keyup', handleKeyUp);
    scroller?.addEventListener('paste', handlePaste);
    scroller?.addEventListener('wheel', handleWheel, { passive: false });

    return () => {
      if (refocusFrame !== null) {
        cancelAnimationFrame(refocusFrame);
        refocusFrame = null;
      }
      if (clearRefocusFlagFrame !== null) {
        cancelAnimationFrame(clearRefocusFlagFrame);
        clearRefocusFlagFrame = null;
      }
      if (clearRefocusFallbackTimeout !== null) {
        clearTimeout(clearRefocusFallbackTimeout);
        clearRefocusFallbackTimeout = null;
      }
      scroller?.removeEventListener('keydown', handleKeyDown);
      scroller?.removeEventListener('keyup', handleKeyUp);
      scroller?.removeEventListener('paste', handlePaste);
      scroller?.removeEventListener('wheel', handleWheel);
      if (scroller) {
        delete scroller.dataset.cagedRefocusActive;
      }
      removeUpdateListener();
    };
  }, [editor, scrollerRef, topBoundaryPx, bottomBoundaryPx]);

  return null;
}

