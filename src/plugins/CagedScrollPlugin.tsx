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
        // Caret went above the cage, scroll up!
        const difference = cageTop - caretTop;
        targetScrollTop -= difference;
      } else if (caretBottom > cageBottom) {
        // Caret went below the cage, scroll down!
        const difference = caretBottom - cageBottom;
        targetScrollTop += difference;
      }

      // Fix: Quantize scrolling to strictly snap to our 24px grid rows!
      targetScrollTop = Math.round(targetScrollTop / 24) * 24;

      if (targetScrollTop !== scroller.scrollTop) {
        // Use 'auto' instead of 'smooth' to prevent fighting with 
        // the browser's native scroll-to-caret speed. We instantly clamp it.
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

    return () => {
      removeUpdateListener();
      removeSelectionListener();
    };
  }, [editor, scrollerRef, topBoundaryPx, bottomBoundaryPx]);

  return null;
}

