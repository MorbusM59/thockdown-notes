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
    // We register a listener for off-screen selection changes
    const checkScroll = () => {
      const scroller = scrollerRef.current;
      if (!scroller) return false;

      const domSelection = window.getSelection();
      if (!domSelection || domSelection.rangeCount === 0) return false;

      const range = domSelection.getRangeAt(0);
      const caretRect = range.getBoundingClientRect();
      const scrollerRect = scroller.getBoundingClientRect();

      // Calculate absolute positions relative to the viewport
      let caretTop = caretRect.top;
      let caretBottom = caretRect.bottom;

      // When the selection is on a completely empty line (mostly due to a collapsed range in an empty text node),
      // the browser frequently returns 0 for all bounds. Fall back to the parent DOM element's boundary.
      if (caretTop === 0 && caretBottom === 0) {
        const anchorNode = domSelection.anchorNode;
        const element = anchorNode?.nodeType === Node.ELEMENT_NODE 
          ? (anchorNode as Element) 
          : anchorNode?.parentElement;
          
        if (element) {
          const rect = element.getBoundingClientRect();
          caretTop = rect.top;
          // Force a 24px height on the assumption of a single empty line
          caretBottom = caretTop + 24; 
        } else {
          return false;
        }
      }

      const cageTop = scrollerRect.top + topBoundaryPx;
      const cageBottom = scrollerRect.bottom - bottomBoundaryPx;

      let targetScrollTop = scroller.scrollTop;

      if (caretTop < cageTop) {
        // Move in hard row increments until the caret reaches the cage.
        const difference = cageTop - caretTop;
        const rows = Math.ceil(difference / LINE_HEIGHT_PX);
        targetScrollTop -= rows * LINE_HEIGHT_PX;
      } else if (caretBottom > cageBottom) {
        // Move in hard row increments until the caret reaches the cage.
        const difference = caretBottom - cageBottom;
        const rows = Math.ceil(difference / LINE_HEIGHT_PX);
        targetScrollTop += rows * LINE_HEIGHT_PX;
      }

      // Quantize and clamp to valid scroll range.
      targetScrollTop = Math.round(targetScrollTop / LINE_HEIGHT_PX) * LINE_HEIGHT_PX;
      const maxScrollTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
      targetScrollTop = Math.max(0, Math.min(maxScrollTop, targetScrollTop));

      if (targetScrollTop !== scroller.scrollTop) {
        // Never smooth-scroll; force deterministic row jumps.
        scroller.scrollTo({
          top: targetScrollTop,
          behavior: 'auto',
        });
      }

      return false; // Don't stop command propagation
    };

    const removeUpdateListener = editor.registerUpdateListener(({ editorState }) => {
      editorState.read(() => {
        // Execute synchronously after DOM mutation but BEFORE the browser paints!
        // This completely eliminates the visual "flicker".
        checkScroll();
      });
    });

    const removeSelectionListener = editor.registerCommand(
      SELECTION_CHANGE_COMMAND,
      () => {
        // Execute synchronously
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
        // One wheel line unit maps to one editor row step.
        const lineUnits = Math.trunc(Math.abs(event.deltaY));
        units = Math.max(1, lineUnits) * (event.deltaY > 0 ? 1 : -1);
      } else if (event.deltaMode === WheelEvent.DOM_DELTA_PAGE) {
        // Page wheel intent still moves in row units; use at least one unit.
        const pageUnits = Math.trunc(Math.abs(event.deltaY));
        units = Math.max(1, pageUnits) * (event.deltaY > 0 ? 1 : -1);
      } else {
        // Pixel mode (common touchpad/mouse on Windows): accumulate and convert
        // each full wheel unit worth of pixels into exactly one row step.
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

