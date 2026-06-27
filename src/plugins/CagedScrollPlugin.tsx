import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { useEffect } from 'react';
import {
  $addUpdateTag,
  $getRoot,
  COMMAND_PRIORITY_CRITICAL,
  KEY_DOWN_COMMAND,
  SKIP_SCROLL_INTO_VIEW_TAG,
  SKIP_SELECTION_FOCUS_TAG,
} from 'lexical';
import { readSelectionRect } from '../editor/CaretRect';
import { resolveCaretTopInScroll } from '../editor/CaretVisualPosition';
import { PIXELS_PER_WHEEL_UNIT } from '../editor/LayoutConstants';
import { resolveCagedScrollTarget } from '../editor/CageMath';
import {
  buildReleaseRampDownPlanFromCurrentParams,
  CONTINUOUS_SCROLL_APEX_SPEED_MULTIPLIER,
  resolveApexSpeedPxPerSecFromCurrentParams,
  resolveRampCrossingTimeSecFromCurrentParams,
  sampleReleaseRampDownPlan,
} from '../editor/NonQuantizedSmoothScroll';
import { cancelQuantizedSmoothScroll, scrollToQuantizedSmooth } from '../editor/QuantizedSmoothScroll';
import {
  activateRefocusTransaction,
  clearRefocusTransaction,
  deactivateRefocusTransaction,
  scheduleRefocusTransactionDeactivation,
} from '../editor/RefocusTransaction';

interface CagedScrollPluginProps {
  scrollerRef: React.RefObject<HTMLElement>;
  topBoundaryPx: number;
  bottomBoundaryPx: number;
  lineHeightPx: number;
}

type ViewportIntent = 'none' | 'refocus-caged' | 'ensure-visible';

type ResolveIntentResult = {
  targetScrollTopPx: number | null;
  reason: string;
  caretTopInScrollPx?: number;
};

const EDITOR_PAGE_CONTINUOUS_SCROLL_APEX_MULTIPLIER = CONTINUOUS_SCROLL_APEX_SPEED_MULTIPLIER;

const computeVisibleMiddleRows = (
  scrollerClientHeightPx: number,
  topBoundaryPx: number,
  bottomBoundaryPx: number,
  lineHeightPx: number,
) => {
  const middleHeightPx = Math.max(
    lineHeightPx,
    Math.round(scrollerClientHeightPx) - Math.round(topBoundaryPx) - Math.round(bottomBoundaryPx),
  );
  return Math.max(1, Math.floor(middleHeightPx / lineHeightPx));
};

const isAlignedToRowGrid = (valuePx: number, lineHeightPx: number) => Math.abs(valuePx % lineHeightPx) < 0.01;

const resolveDirectionalQuantizedScrollTop = (
  currentScrollTopPx: number,
  previousScrollTopPx: number,
  maxScrollTopPx: number,
  lineHeightPx: number,
) => {
  const delta = currentScrollTopPx - previousScrollTopPx;
  if (Math.abs(delta) < 0.01) {
    return Math.max(0, Math.min(maxScrollTopPx, Math.round(currentScrollTopPx / lineHeightPx) * lineHeightPx));
  }

  if (delta > 0) {
    return Math.max(0, Math.min(maxScrollTopPx, Math.ceil(currentScrollTopPx / lineHeightPx) * lineHeightPx));
  }

  return Math.max(0, Math.min(maxScrollTopPx, Math.floor(currentScrollTopPx / lineHeightPx) * lineHeightPx));
};

export function CagedScrollPlugin({ scrollerRef, topBoundaryPx, bottomBoundaryPx, lineHeightPx }: CagedScrollPluginProps) {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    const resolveIntentScrollTarget = (intent: Exclude<ViewportIntent, 'none'>) => {
      const scroller = scrollerRef.current;
      if (!scroller) {
        return { targetScrollTopPx: null, reason: 'no-scroller' } satisfies ResolveIntentResult;
      }

      const domSelection = window.getSelection();
      if (!domSelection || domSelection.rangeCount === 0) {
        return { targetScrollTopPx: null, reason: 'no-dom-selection' } satisfies ResolveIntentResult;
      }

      const scrollerRect = scroller.getBoundingClientRect();
      const caretRect = readSelectionRect(domSelection, lineHeightPx);
      if (!caretRect) {
        return { targetScrollTopPx: null, reason: 'no-caret-rect' } satisfies ResolveIntentResult;
      }

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
        lineHeightPx,
      });

      if (intent === 'refocus-caged' || intent === 'ensure-visible') {
        const { targetScrollTopPx } = resolveCagedScrollTarget({
          caretTopInScrollPx: caretTopInScroll,
          scrollerScrollTopPx: scroller.scrollTop,
          scrollerClientHeightPx: scroller.clientHeight,
          scrollerScrollHeightPx: scroller.scrollHeight,
          topBoundaryPx,
          bottomBoundaryPx,
          lineHeightPx,
        });

        return {
          targetScrollTopPx,
          reason: 'ok',
          caretTopInScrollPx: caretTopInScroll,
        } satisfies ResolveIntentResult;
      }

      return { targetScrollTopPx: null, reason: 'unsupported-intent' } satisfies ResolveIntentResult;
    };

    const applyIntentReconcile = (intent: Exclude<ViewportIntent, 'none'>) => {
      const scroller = scrollerRef.current;
      if (!scroller) return false;

      const result = resolveIntentScrollTarget(intent);
      console.warn('[CSP:applyIntentReconcile]', {
        intent,
        targetScrollTopPx: result.targetScrollTopPx,
        reason: result.reason,
        caretTopInScrollPx: result.caretTopInScrollPx,
        currentScrollTop: scroller.scrollTop,
      });

      let targetScrollTopPx = result.targetScrollTopPx;

      if (targetScrollTopPx === null) {
        console.warn('[CSP:targetScrollTopPx is null]');
        return;
      }

      if (intent === 'refocus-caged' && clampNextEnterReconcileToSingleRow) {
        const maxScrollTopPx = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
        const singleStepMinPx = scroller.scrollTop;
        const singleStepMaxPx = scroller.scrollTop + lineHeightPx;
        const steppedTargetPx = Math.max(singleStepMinPx, Math.min(singleStepMaxPx, targetScrollTopPx));
        targetScrollTopPx = Math.max(
          0,
          Math.min(maxScrollTopPx, Math.round(steppedTargetPx / lineHeightPx) * lineHeightPx),
        );
      }

      if (targetScrollTopPx !== scroller.scrollTop) {
        if (intent === 'refocus-caged') {
          scrollToQuantizedSmooth(scroller, targetScrollTopPx, {
            lineHeightPx,
          });
        } else {
          scroller.scrollTop = targetScrollTopPx;
        }
      }

      if (intent === 'refocus-caged') {
        clampNextEnterReconcileToSingleRow = false;
        // Keep active for sustained key-repeat; cleared on keyup.
      }

      if (intent === 'ensure-visible') {
        scheduleRefocusTransactionDeactivation(scroller);
      }

      return true;
    };

    let pendingIntent: ViewportIntent = 'none';
    let isRefocusReconcileQueued = false;
    let refocusRetryFrameId: number | null = null;
    let deterministicEnterBoundaryScrollTopPx: number | null = null;
    let clampNextEnterReconcileToSingleRow = false;
    const pressedRefocusKeys = new Set<string>();
    let initialRefocusAnchorScrollTopPx: number | null = null;
    let shouldSuppressInitialNativeJump = false;
    let isPrimaryPointerDown = false;
    let lastDragScrollTopPx = 0;
    let isApplyingDragQuantizedCorrection = false;
    let dragCorrectionFrame: number | null = null;

    const resolveQuantizedAnchorScrollTopPx = () => {
      if (!scroller || initialRefocusAnchorScrollTopPx === null) return null;
      const maxScrollTopPx = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
      return Math.max(
        0,
        Math.min(maxScrollTopPx, Math.round(initialRefocusAnchorScrollTopPx / lineHeightPx) * lineHeightPx),
      );
    };

    const clearCagedRefocusState = () => {
      if (!scroller) return;
      pressedRefocusKeys.clear();
      initialRefocusAnchorScrollTopPx = null;
      shouldSuppressInitialNativeJump = false;
      deterministicEnterBoundaryScrollTopPx = null;
      clampNextEnterReconcileToSingleRow = false;
      if (refocusRetryFrameId !== null) {
        cancelAnimationFrame(refocusRetryFrameId);
        refocusRetryFrameId = null;
      }
      if (pendingIntent === 'refocus-caged') {
        pendingIntent = 'none';
      }
      deactivateRefocusTransaction(scroller);
    };

    const endPointerDragSelection = () => {
      isPrimaryPointerDown = false;
      if (dragCorrectionFrame !== null) {
        cancelAnimationFrame(dragCorrectionFrame);
        dragCorrectionFrame = null;
      }
    };

    const scheduleRefocus = () => {
      if (pendingIntent === 'none') return;
      if (isRefocusReconcileQueued) return;

      isRefocusReconcileQueued = true;
      // Reconcile in the same task tick after Lexical applies selection changes,
      // avoiding a one-frame paint window where native auto-scroll can flicker.
      queueMicrotask(() => {
        isRefocusReconcileQueued = false;
        const intent = pendingIntent;
        pendingIntent = 'none';
        if (intent === 'none') return;

        console.warn('[CSP:scheduleRefocus:microtask]', {
          intent,
          deterministicEnterBoundaryScrollTopPx,
          scrollTop: scrollerRef.current?.scrollTop,
        });

        if (intent === 'refocus-caged' && deterministicEnterBoundaryScrollTopPx !== null) {
          const currentScroller = scrollerRef.current;
          let didApplyDeterministicStep = false;
          if (currentScroller) {
            const maxScrollTopPx = Math.max(0, currentScroller.scrollHeight - currentScroller.clientHeight);
            const deterministicTargetPx = Math.max(
              0,
              Math.min(
                maxScrollTopPx,
                Math.round((deterministicEnterBoundaryScrollTopPx + lineHeightPx) / lineHeightPx) * lineHeightPx,
              ),
            );

            console.warn('[CSP:scheduleRefocus:deterministicStep]', {
              deterministicTargetPx,
              currentScrollTop: currentScroller.scrollTop,
              willApply: deterministicTargetPx > currentScroller.scrollTop,
            });

            if (deterministicTargetPx > currentScroller.scrollTop) {
              currentScroller.scrollTop = deterministicTargetPx;
              didApplyDeterministicStep = true;
              const capturedScroller = currentScroller;
              const capturedTarget = deterministicTargetPx;

              // Prototype-level scrollTop trap to identify what resets scroll after the deterministic step.
              const trapProto = Object.getPrototypeOf(capturedScroller) as typeof HTMLElement.prototype;
              const descriptor =
                Object.getOwnPropertyDescriptor(trapProto, 'scrollTop') ??
                Object.getOwnPropertyDescriptor(Element.prototype, 'scrollTop') ??
                Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollTop');

              console.warn('[CSP:trap-setup]', {
                foundDescriptor: !!descriptor,
                protoName: trapProto?.constructor?.name,
              });

              if (descriptor?.set) {
                const originalSet = descriptor.set;
                const originalGet = descriptor.get;
                Object.defineProperty(trapProto, 'scrollTop', {
                  get: originalGet,
                  set: function(this: HTMLElement, value: number) {
                    if (this === capturedScroller && Math.abs(value - capturedTarget) > 1) {
                      console.error('[CSP:scrollTop-STOMPER]', {
                        newValue: value,
                        expectedTarget: capturedTarget,
                        stack: new Error().stack,
                      });
                    }
                    originalSet.call(this, value);
                  },
                  configurable: true,
                });
                requestAnimationFrame(() => requestAnimationFrame(() => {
                  Object.defineProperty(trapProto, 'scrollTop', descriptor);
                }));
              }

              requestAnimationFrame(() => {
                console.warn('[CSP:deterministicStep:RAF-verify]', {
                  scrollTopAfterRAF: capturedScroller.scrollTop,
                  expectedTarget: capturedTarget,
                  survived: Math.abs(capturedScroller.scrollTop - capturedTarget) < 1,
                });
              });
            }
          }

          deterministicEnterBoundaryScrollTopPx = null;

          if (didApplyDeterministicStep) {
            clampNextEnterReconcileToSingleRow = false;
            // Deterministic Enter boundary correction intentionally owns this
            // cycle to avoid a second reconcile adding another row in the same tick.
            shouldSuppressInitialNativeJump = false;
            return;
          }
        }

        const didReconcile = applyIntentReconcile(intent);
        if (didReconcile) {
          shouldSuppressInitialNativeJump = false;
          return;
        }

        // Enter at the cage edge can temporarily produce no measurable caret rect.
        // Retry on the next frame so the scroll-up reconcile still happens immediately.
        const shouldRetryRefocus = pressedRefocusKeys.has('Enter');
        if (intent === 'refocus-caged' && shouldRetryRefocus) {
          pendingIntent = 'refocus-caged';
          if (refocusRetryFrameId !== null) {
            cancelAnimationFrame(refocusRetryFrameId);
          }
          refocusRetryFrameId = requestAnimationFrame(() => {
            refocusRetryFrameId = null;
            scheduleRefocus();
          });
          return;
        }

        shouldSuppressInitialNativeJump = false;
      });
    };

    const shouldBypassRefocusForTransformUpdate = (tags: ReadonlySet<string>) => {
      // Tab/shortcut transforms replay selection with explicit preserve-scroll semantics.
      // Any stale refocus intent from a previous key must not mutate viewport here.
      return tags.has('tab-indent') || tags.has('shortcut-transform');
    };

    const removeUpdateListener = editor.registerUpdateListener(({ editorState, tags }) => {
      editorState.read(() => {
        if (shouldBypassRefocusForTransformUpdate(tags)) {
          pendingIntent = 'none';
          shouldSuppressInitialNativeJump = false;
          deterministicEnterBoundaryScrollTopPx = null;
          clampNextEnterReconcileToSingleRow = false;
          initialRefocusAnchorScrollTopPx = null;

          if (refocusRetryFrameId !== null) {
            cancelAnimationFrame(refocusRetryFrameId);
            refocusRetryFrameId = null;
          }

          const currentScroller = scrollerRef.current;
          if (currentScroller && pressedRefocusKeys.size === 0) {
            scheduleRefocusTransactionDeactivation(currentScroller);
          }

          return;
        }

        scheduleRefocus();
      });
    });

    const scroller = scrollerRef.current;
    if (scroller) {
      deactivateRefocusTransaction(scroller);
      lastDragScrollTopPx = scroller.scrollTop;
    }
    let pendingWheelPx = 0;
    const pageKeysHeld = new Set<string>();
    let pageContinuousDirection: -1 | 0 | 1 = 0;
    let pageContinuousRafId: number | null = null;
    let pageContinuousLastTs: number | null = null;
    let pageContinuousHandoffTimeoutId: number | null = null;
    let pageReleaseRampDownRafId: number | null = null;

    const clearPageContinuousHandoff = () => {
      if (pageContinuousHandoffTimeoutId !== null) {
        window.clearTimeout(pageContinuousHandoffTimeoutId);
        pageContinuousHandoffTimeoutId = null;
      }
    };

    const stopPageContinuousScroll = () => {
      pageContinuousDirection = 0;
      pageContinuousLastTs = null;
      if (pageContinuousRafId !== null) {
        cancelAnimationFrame(pageContinuousRafId);
        pageContinuousRafId = null;
      }
      if (pageReleaseRampDownRafId !== null) {
        cancelAnimationFrame(pageReleaseRampDownRafId);
        pageReleaseRampDownRafId = null;
      }
    };

    const startPageReleaseRampDown = (direction: -1 | 1) => {
      if (!scroller) {
        stopPageContinuousScroll();
        return;
      }

      const visibleRows = computeVisibleMiddleRows(scroller.clientHeight, topBoundaryPx, bottomBoundaryPx, lineHeightPx);
      const pageStepDistancePx = visibleRows * lineHeightPx;
      const releaseSpeedPxPerSec = Math.max(
        1,
        resolveApexSpeedPxPerSecFromCurrentParams(pageStepDistancePx)
          * EDITOR_PAGE_CONTINUOUS_SCROLL_APEX_MULTIPLIER,
      );
      const rampDownPlan = buildReleaseRampDownPlanFromCurrentParams(direction, releaseSpeedPxPerSec);
      if (!rampDownPlan) {
        stopPageContinuousScroll();
        return;
      }

      if (pageContinuousRafId !== null) {
        cancelAnimationFrame(pageContinuousRafId);
        pageContinuousRafId = null;
      }
      pageContinuousDirection = 0;
      pageContinuousLastTs = null;

      if (pageReleaseRampDownRafId !== null) {
        cancelAnimationFrame(pageReleaseRampDownRafId);
        pageReleaseRampDownRafId = null;
      }

      const startScrollTop = scroller.scrollTop;
      const maxScrollTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
      let startMs: number | null = null;

      const animateRampDown = (nowMs: number) => {
        if (!scroller) {
          stopPageContinuousScroll();
          return;
        }

        if (startMs === null) {
          startMs = nowMs;
        }

        const elapsedSec = Math.max(0, (nowMs - startMs) / 1000);
        const displacement = sampleReleaseRampDownPlan(rampDownPlan, elapsedSec);
        const nextScrollTop = Math.max(0, Math.min(maxScrollTop, startScrollTop + displacement));
        const quantizedTarget = Math.round(nextScrollTop / lineHeightPx) * lineHeightPx;

        if (Math.abs(quantizedTarget - scroller.scrollTop) > 0.01) {
          scroller.scrollTop = quantizedTarget;
        }

        const hitBoundary = quantizedTarget <= 0.01 || quantizedTarget >= maxScrollTop - 0.01;
        if (elapsedSec >= rampDownPlan.tailDurationSec || hitBoundary) {
          pageReleaseRampDownRafId = null;
          return;
        }

        pageReleaseRampDownRafId = requestAnimationFrame(animateRampDown);
      };

      pageReleaseRampDownRafId = requestAnimationFrame(animateRampDown);
    };

    const runPageContinuousScroll = (nowMs: number) => {
      if (!scroller || pageContinuousDirection === 0) {
        pageContinuousRafId = null;
        pageContinuousLastTs = null;
        return;
      }

      const previousTs = pageContinuousLastTs;
      pageContinuousLastTs = nowMs;

      if (previousTs !== null) {
        const deltaSec = Math.max(0, (nowMs - previousTs) / 1000);
        const visibleRows = computeVisibleMiddleRows(scroller.clientHeight, topBoundaryPx, bottomBoundaryPx, lineHeightPx);
        const pageStepDistancePx = visibleRows * lineHeightPx;
        const speedPxPerSec = Math.max(
          1,
          resolveApexSpeedPxPerSecFromCurrentParams(pageStepDistancePx)
            * EDITOR_PAGE_CONTINUOUS_SCROLL_APEX_MULTIPLIER,
        );
        const maxScrollTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
        const nextScrollTop = Math.max(
          0,
          Math.min(maxScrollTop, scroller.scrollTop + pageContinuousDirection * speedPxPerSec * deltaSec),
        );
        const quantizedTarget = Math.round(nextScrollTop / lineHeightPx) * lineHeightPx;

        if (Math.abs(quantizedTarget - scroller.scrollTop) > 0.01) {
          scroller.scrollTop = quantizedTarget;
        }

        const hitBoundary = (pageContinuousDirection < 0 && quantizedTarget <= 0.01)
          || (pageContinuousDirection > 0 && quantizedTarget >= maxScrollTop - 0.01);
        if (hitBoundary) {
          stopPageContinuousScroll();
          return;
        }
      }

      pageContinuousRafId = requestAnimationFrame(runPageContinuousScroll);
    };

    const startPageContinuousScroll = (direction: -1 | 1) => {
      if (!scroller) return;
      cancelQuantizedSmoothScroll(scroller);
      const previousDirection = pageContinuousDirection;
      pageContinuousDirection = direction;
      if (pageContinuousRafId === null || previousDirection !== direction) {
        pageContinuousLastTs = null;
      }
      if (pageContinuousRafId === null) {
        pageContinuousRafId = requestAnimationFrame(runPageContinuousScroll);
      }
    };

    const isRefocusKey = (event: KeyboardEvent) => {
      if (
        event.key === 'ArrowUp' ||
        event.key === 'ArrowDown' ||
        event.key === 'ArrowLeft' ||
        event.key === 'ArrowRight' ||
        event.key === 'Home' ||
        event.key === 'End'
      ) {
        return true;
      }
      if (event.ctrlKey || event.metaKey || event.altKey) return false;
      if (event.key.length === 1) return true;
      return event.key === 'Enter' || event.key === 'Backspace' || event.key === 'Delete';
    };

    const shouldSuppressNativeCaretScroll = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return false;
      return isRefocusKey(event) || event.key === 'PageUp' || event.key === 'PageDown';
    };

    const removeKeyDownScrollSuppressor = editor.registerCommand(
      KEY_DOWN_COMMAND,
      (event: KeyboardEvent) => {
        if (!scroller) return false;
        const isRefocusActive = pendingIntent === 'refocus-caged' || pressedRefocusKeys.size > 0;
        if (!isRefocusActive) return false;
        if (!shouldSuppressNativeCaretScroll(event)) return false;

        // Surgical suppression: keep native key handling, but stop Lexical/browser
        // from auto-focusing the caret into viewport during this refocus transaction.
        $addUpdateTag(SKIP_SCROLL_INTO_VIEW_TAG);
        $addUpdateTag(SKIP_SELECTION_FOCUS_TAG);
        return false;
      },
      COMMAND_PRIORITY_CRITICAL,
    );

    const runQuantizedJump = (targetScrollTopPx: number) => {
      if (!scroller) return;
      scrollToQuantizedSmooth(scroller, targetScrollTopPx, {
            lineHeightPx,
      });
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (!scroller) return;

      if (event.key === 'PageUp' || event.key === 'PageDown') {
        event.preventDefault();
        clearCagedRefocusState();
        const direction: -1 | 1 = event.key === 'PageDown' ? 1 : -1;
        pageKeysHeld.add(event.key);

        if (event.repeat) {
          if (pageContinuousHandoffTimeoutId === null) {
            startPageContinuousScroll(direction);
          }
          return;
        }

        clearPageContinuousHandoff();
        stopPageContinuousScroll();

        const visibleRows = computeVisibleMiddleRows(scroller.clientHeight, topBoundaryPx, bottomBoundaryPx, lineHeightPx);
        const delta = direction * visibleRows * lineHeightPx;

        const maxScrollTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
        const currentAligned = Math.round(scroller.scrollTop / lineHeightPx) * lineHeightPx;
        const target = Math.max(0, Math.min(maxScrollTop, currentAligned + delta));
        const quantizedTarget = Math.round(target / lineHeightPx) * lineHeightPx;

        runQuantizedJump(quantizedTarget);

        const targetContinuousSpeedPxPerSec = Math.max(
          1,
          resolveApexSpeedPxPerSecFromCurrentParams(quantizedTarget - currentAligned)
            * EDITOR_PAGE_CONTINUOUS_SCROLL_APEX_MULTIPLIER,
        );
        const crossingTimeSec = resolveRampCrossingTimeSecFromCurrentParams(
          quantizedTarget - currentAligned,
          targetContinuousSpeedPxPerSec,
        );

        if (crossingTimeSec !== null) {
          const delayMs = Math.max(0, Math.round(crossingTimeSec * 1000));
          const key = event.key;
          pageContinuousHandoffTimeoutId = window.setTimeout(() => {
            pageContinuousHandoffTimeoutId = null;
            if (!pageKeysHeld.has(key)) return;
            startPageContinuousScroll(direction);
          }, delayMs);
        }
        return;
      }

      if (isRefocusKey(event)) {
        clampNextEnterReconcileToSingleRow = event.key === 'Enter' && !event.ctrlKey && !event.metaKey && !event.altKey;
        const isNewRefocusPress = !pressedRefocusKeys.has(event.key);
        if (isNewRefocusPress) {
          initialRefocusAnchorScrollTopPx = scroller.scrollTop;
          shouldSuppressInitialNativeJump = true;
        }
        if (event.key === 'Enter') {
          const domSelection = window.getSelection();
          const caretRect = domSelection ? readSelectionRect(domSelection, lineHeightPx) : null;
          if (domSelection && caretRect) {
            const isAuthoritativeRect = caretRect.source === 'primary' || caretRect.source === 'client-rect';
            if (!isAuthoritativeRect) {
              // Adjacent/anchor fallback can point at neighboring rows around empty trailing lines.
              // Skip deterministic arming in that case to avoid false boundary promotion.
              deterministicEnterBoundaryScrollTopPx = null;
            }

            let rawText = '';
            editor.getEditorState().read(() => {
              rawText = $getRoot().getTextContent();
            });

            const scrollerRect = scroller.getBoundingClientRect();
            const caretTopInScroll = resolveCaretTopInScroll({
              caretRect,
              scrollerRectTop: scrollerRect.top,
              scrollerScrollTop: scroller.scrollTop,
              rootEl: editor.getRootElement(),
              domSelection,
              rawText,
              lineHeightPx,
            });

            const middleBottomInScrollPx = scroller.scrollTop + scroller.clientHeight - bottomBoundaryPx;
            const quantizedCaretRowTopPx = Math.round(caretTopInScroll / lineHeightPx) * lineHeightPx;
            const lastMiddleRowTopPx = Math.round((middleBottomInScrollPx - lineHeightPx) / lineHeightPx) * lineHeightPx;
            const isAtLastMiddleRow = Math.abs(quantizedCaretRowTopPx - lastMiddleRowTopPx) < 0.01;
            console.warn('[CSP:keydown:enter]', {
              caretSource: caretRect?.source,
              isAuthoritativeRect,
              quantizedCaretRowTopPx,
              lastMiddleRowTopPx,
              isAtLastMiddleRow,
              scrollTop: scroller.scrollTop,
              deterministicArmed: isAtLastMiddleRow,
            });
          if (isAtLastMiddleRow) {
              deterministicEnterBoundaryScrollTopPx = scroller.scrollTop;
            }
          }
        }
        pressedRefocusKeys.add(event.key);
        activateRefocusTransaction(scroller);
        pendingIntent = 'refocus-caged';
        // Reconcile only after Lexical commits the key effect.
        // This avoids measuring stale pre-mutation caret geometry for Enter.
      }
    };

    const handleInitialRefocusNativeJumpSuppression = () => {
      if (!scroller) return;
      if (!shouldSuppressInitialNativeJump) return;

      const quantizedAnchorPx = resolveQuantizedAnchorScrollTopPx();
      if (quantizedAnchorPx === null) return;

      if (Math.abs(scroller.scrollTop - quantizedAnchorPx) >= 0.01) {
        // One-shot corrective write for the native jump frame only.
        scroller.scrollTop = quantizedAnchorPx;
      }

      shouldSuppressInitialNativeJump = false;
    };

    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.key === 'PageUp' || event.key === 'PageDown') {
        pageKeysHeld.delete(event.key);
        clearPageContinuousHandoff();
        if (pageKeysHeld.size === 0) {
          const activeDirection = pageContinuousDirection;
          if (activeDirection !== 0) {
            startPageReleaseRampDown(activeDirection);
          } else {
            stopPageContinuousScroll();
          }
        }
      }

      if (!scroller) return;
      if (!pressedRefocusKeys.has(event.key)) return;

      pressedRefocusKeys.delete(event.key);
      if (pressedRefocusKeys.size > 0) return;

      if (pendingIntent === 'none') {
        scheduleRefocusTransactionDeactivation(scroller);
      }
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
      const target = Math.max(0, Math.min(maxScrollTop, scroller.scrollTop + units * lineHeightPx));
      scroller.scrollTop = Math.round(target / lineHeightPx) * lineHeightPx;
    };

    const handlePaste = () => {
      clearCagedRefocusState();
      if (scroller) {
        // Use guarded transaction so paste reconcile cannot flash a pre-cage frame.
        activateRefocusTransaction(scroller);
      }
      pendingIntent = 'ensure-visible';
    };

    const handlePointerDown = (event: PointerEvent) => {
      if (!scroller) return;
      if (event.button !== 0) return;
      isPrimaryPointerDown = true;
      lastDragScrollTopPx = scroller.scrollTop;
    };

    const handleMouseDown = (event: MouseEvent) => {
      if (!scroller) return;
      if (event.button !== 0) return;
      isPrimaryPointerDown = true;
      lastDragScrollTopPx = scroller.scrollTop;
    };

    const handlePointerUp = () => {
      endPointerDragSelection();
    };

    const handlePointerCancel = () => {
      endPointerDragSelection();
    };

    const handleSelectionDragScrollQuantization = () => {
      if (!scroller) return;

      const observedScrollTopPx = scroller.scrollTop;

      if (isApplyingDragQuantizedCorrection) {
        lastDragScrollTopPx = observedScrollTopPx;
        return;
      }

      if (!isPrimaryPointerDown) {
        lastDragScrollTopPx = observedScrollTopPx;
        return;
      }

      const root = editor.getRootElement();
      const domSelection = window.getSelection();
      if (!root || !domSelection || domSelection.rangeCount === 0 || domSelection.isCollapsed) {
        lastDragScrollTopPx = observedScrollTopPx;
        return;
      }

      const range = domSelection.getRangeAt(0);
      if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) {
        lastDragScrollTopPx = observedScrollTopPx;
        return;
      }

      if (dragCorrectionFrame !== null) {
        cancelAnimationFrame(dragCorrectionFrame);
      }

      dragCorrectionFrame = requestAnimationFrame(() => {
        dragCorrectionFrame = null;
        if (!scroller || !isPrimaryPointerDown) return;

        const currentScrollTopPx = scroller.scrollTop;
        if (isAlignedToRowGrid(currentScrollTopPx, lineHeightPx)) {
          lastDragScrollTopPx = currentScrollTopPx;
          return;
        }

        const maxScrollTopPx = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
        const quantizedTargetPx = resolveDirectionalQuantizedScrollTop(
          currentScrollTopPx,
          lastDragScrollTopPx,
          maxScrollTopPx,
          lineHeightPx,
        );

        if (Math.abs(quantizedTargetPx - currentScrollTopPx) < 0.01) {
          lastDragScrollTopPx = currentScrollTopPx;
          return;
        }

        isApplyingDragQuantizedCorrection = true;
        scroller.scrollTop = quantizedTargetPx;
        isApplyingDragQuantizedCorrection = false;
        lastDragScrollTopPx = quantizedTargetPx;
      });
    };

    const handleWindowBlur = () => {
      pageKeysHeld.clear();
      clearPageContinuousHandoff();
      stopPageContinuousScroll();
      endPointerDragSelection();
      clearCagedRefocusState();
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState !== 'visible') {
        pageKeysHeld.clear();
        clearPageContinuousHandoff();
        stopPageContinuousScroll();
        endPointerDragSelection();
        clearCagedRefocusState();
      }
    };

    scroller?.addEventListener('keydown', handleKeyDown, { capture: true });
    scroller?.addEventListener('keyup', handleKeyUp, { capture: true });
    scroller?.addEventListener('paste', handlePaste);
    scroller?.addEventListener('wheel', handleWheel, { passive: false });
    scroller?.addEventListener('scroll', handleInitialRefocusNativeJumpSuppression, { passive: true });
    document.addEventListener('pointerdown', handlePointerDown, { capture: true, passive: true });
    document.addEventListener('mousedown', handleMouseDown, { capture: true, passive: true });
    scroller?.addEventListener('scroll', handleSelectionDragScrollQuantization, { passive: true });
    window.addEventListener('pointerup', handlePointerUp, { passive: true });
    window.addEventListener('mouseup', handlePointerUp, { passive: true });
    window.addEventListener('pointercancel', handlePointerCancel, { passive: true });
    window.addEventListener('blur', handleWindowBlur);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      pageKeysHeld.clear();
      clearPageContinuousHandoff();
      stopPageContinuousScroll();
      if (refocusRetryFrameId !== null) {
        cancelAnimationFrame(refocusRetryFrameId);
        refocusRetryFrameId = null;
      }
      if (dragCorrectionFrame !== null) {
        cancelAnimationFrame(dragCorrectionFrame);
        dragCorrectionFrame = null;
      }
      scroller?.removeEventListener('keydown', handleKeyDown, true);
      scroller?.removeEventListener('keyup', handleKeyUp, true);
      scroller?.removeEventListener('paste', handlePaste);
      scroller?.removeEventListener('wheel', handleWheel);
      scroller?.removeEventListener('scroll', handleInitialRefocusNativeJumpSuppression);
      document.removeEventListener('pointerdown', handlePointerDown, true);
      document.removeEventListener('mousedown', handleMouseDown, true);
      scroller?.removeEventListener('scroll', handleSelectionDragScrollQuantization);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('mouseup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerCancel);
      window.removeEventListener('blur', handleWindowBlur);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      if (scroller) {
        clearRefocusTransaction(scroller);
      }
      removeKeyDownScrollSuppressor();
      removeUpdateListener();
    };
  }, [editor, scrollerRef, topBoundaryPx, bottomBoundaryPx, lineHeightPx]);

  return null;
}

