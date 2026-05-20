import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { useEffect } from 'react';
import { SELECTION_CHANGE_COMMAND, COMMAND_PRIORITY_LOW } from 'lexical';

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

      const range = domSelection.getRangeAt(0);
      const caretRect = range.getBoundingClientRect();
      const scrollerRect = scroller.getBoundingClientRect();
      const maxScrollTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight);

      // Calculate absolute positions relative to the viewport
      let caretTop = caretRect.top;
      let caretBottom = caretRect.bottom;

      // Some empty-line selections can report a zero rect; fall back to parent element bounds.
      if (caretTop === 0 && caretBottom === 0) {
        const anchorNode = domSelection.anchorNode;
        const element = anchorNode?.nodeType === Node.ELEMENT_NODE
          ? (anchorNode as Element)
          : anchorNode?.parentElement;

        if (element) {
          const rect = element.getBoundingClientRect();
          caretTop = rect.top;
          caretBottom = caretTop + LINE_HEIGHT_PX;
        } else {
          return false;
        }
      }

      // Convert to scroll-space and quantize to exact row boxes.
      const caretTopInScroll = (caretTop - scrollerRect.top) + scroller.scrollTop;
      const quantizedRowTop = Math.round(caretTopInScroll / LINE_HEIGHT_PX) * LINE_HEIGHT_PX;
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

