import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { useEffect } from 'react';
import { $getRoot, SELECTION_CHANGE_COMMAND, COMMAND_PRIORITY_LOW } from 'lexical';
import { readSelectionRect } from '../editor/CaretRect';
import { normalizePlainText, readSelectionStateFromDom } from '../editor/SelectionOffsets';

interface CagedScrollPluginProps {
  scrollerRef: React.RefObject<HTMLElement>;
  topBoundaryPx: number;
  bottomBoundaryPx: number;
}

export function CagedScrollPlugin({ scrollerRef, topBoundaryPx, bottomBoundaryPx }: CagedScrollPluginProps) {
  const [editor] = useLexicalComposerContext();
  const LINE_HEIGHT_PX = 24;
  const PIXELS_PER_WHEEL_UNIT = 100;

  useEffect(() => {
    const checkScroll = () => {
      const scroller = scrollerRef.current;
      if (!scroller) return false;

      const domSelection = window.getSelection();
      if (!domSelection || domSelection.rangeCount === 0) return false;

      const scrollerRect = scroller.getBoundingClientRect();
      const maxScrollTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
      const caretRect = readSelectionRect(domSelection, LINE_HEIGHT_PX);
      if (!caretRect) return false;

      let terminalVisualOffsetPx = 0;
      if (caretRect.source === 'adjacent-probe' || caretRect.source === 'anchor-fallback') {
        editor.getEditorState().read(() => {
          const rootEl = editor.getRootElement();
          if (!rootEl) return;
          const normalizedText = normalizePlainText($getRoot().getTextContent());
          const selectionState = readSelectionStateFromDom(rootEl, domSelection, normalizedText.length);
          const trailingNewlines = normalizedText.match(/\n+$/)?.[0].length ?? 0;
          const trailingExtraRows = Math.max(0, trailingNewlines - 1);

          if (selectionState.isCollapsed && selectionState.anchor === normalizedText.length && trailingExtraRows > 0) {
            terminalVisualOffsetPx = trailingExtraRows * LINE_HEIGHT_PX;
          }
        });
      }

      // Convert to scroll-space and quantize to exact row boxes.
      const caretTopInScroll = (caretRect.top - scrollerRect.top) + scroller.scrollTop + terminalVisualOffsetPx;
      const quantizedRowTop = Math.floor(caretTopInScroll / LINE_HEIGHT_PX) * LINE_HEIGHT_PX;
      const quantizedRowBottom = quantizedRowTop + LINE_HEIGHT_PX;

      const cageTopInScroll = scroller.scrollTop + topBoundaryPx;
      const cageBottomInScroll = scroller.scrollTop + scroller.clientHeight - bottomBoundaryPx;

      let targetScrollTop = scroller.scrollTop;

      if (quantizedRowTop < cageTopInScroll) {
        const difference = cageTopInScroll - quantizedRowTop;
        const rows = Math.ceil(difference / LINE_HEIGHT_PX);
        targetScrollTop -= rows * LINE_HEIGHT_PX;
      } else if (quantizedRowBottom > cageBottomInScroll) {
        const difference = quantizedRowBottom - cageBottomInScroll;
        const rows = Math.ceil(difference / LINE_HEIGHT_PX);
        targetScrollTop += rows * LINE_HEIGHT_PX;
      }

      targetScrollTop = Math.round(targetScrollTop / LINE_HEIGHT_PX) * LINE_HEIGHT_PX;
      targetScrollTop = Math.max(0, Math.min(maxScrollTop, targetScrollTop));

      if (targetScrollTop !== scroller.scrollTop) {
        scroller.scrollTo({
          top: targetScrollTop,
          behavior: 'auto',
        });
      }

      return false;
    };

    const removeUpdateListener = editor.registerUpdateListener(({ editorState }) => {
      editorState.read(() => {
        checkScroll();
      });
    });

    const removeSelectionListener = editor.registerCommand(
      SELECTION_CHANGE_COMMAND,
      () => {
        checkScroll();
        return false;
      },
      COMMAND_PRIORITY_LOW
    );

    const scroller = scrollerRef.current;
    let pendingWheelPx = 0;

    const handleWheel = (event: WheelEvent) => {
      if (!scroller) return;
      if (event.deltaY === 0) return;

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

    scroller?.addEventListener('wheel', handleWheel, { passive: false });

    return () => {
      scroller?.removeEventListener('wheel', handleWheel);
      removeUpdateListener();
      removeSelectionListener();
    };
  }, [editor, scrollerRef, topBoundaryPx, bottomBoundaryPx]);

  return null;
}

