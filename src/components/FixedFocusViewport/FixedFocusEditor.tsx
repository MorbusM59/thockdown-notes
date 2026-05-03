/**
 * FixedFocusEditor: React component for the three-zone fixed viewport editor.
 *
 * Architecture:
 * - Model manages all state (text, viewport, caret)
 * - Component renders three hard-clipped zones from model state
 * - Center zone is the only editable area (contenteditable div)
 * - Top/bottom are display-only divs
 */

import React, { useMemo, useRef, useState, useEffect, useLayoutEffect, useCallback } from 'react';
import { FixedFocusViewportModel } from './viewportModel';
import { WrappedLine, findRowForCharIndex } from './textWrapping';
import { ComputedMetrics, heightForRows } from './lineMetrics';
import './FixedFocusEditor.scss';

// ─── Contenteditable helpers ─────────────────────────────────────────────────

/**
 * Returns the character offset of (node, offsetInNode) within a contenteditable
 * container, counting text-node characters and <br> elements as 1 newline each.
 *
 * Two cases:
 *  - node is a Text node: offsetInNode is a UTF-16 code-unit offset within that text.
 *  - node is an Element: offsetInNode is a child index (the browser uses this form
 *    when the caret sits on a <br>, e.g. on a blank line).  We count chars up to
 *    (but not including) children[offsetInNode].
 */
function ceCharOffset(container: HTMLElement, node: Node, offsetInNode: number): number {
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_ALL, null);
  let charCount = 0;
  let current: Node | null = walker.nextNode();

  if (node.nodeType !== Node.TEXT_NODE) {
    // Element node: offsetInNode is a child index.  Stop counting when we reach
    // children[offsetInNode]; if it's past the last child, consume everything.
    const stopAt: Node | null = offsetInNode < node.childNodes.length
      ? node.childNodes[offsetInNode]
      : null;
    while (current !== null) {
      if (current === stopAt) return charCount;
      if (current.nodeType === Node.TEXT_NODE) charCount += (current as Text).length;
      else if ((current as Element).tagName === 'BR') charCount += 1;
      current = walker.nextNode();
    }
    return charCount;
  }

  // Text node: offsetInNode is a character offset within the text.
  while (current !== null) {
    if (current === node) return charCount + offsetInNode;
    if (current.nodeType === Node.TEXT_NODE) {
      charCount += (current as Text).length;
    } else if ((current as Element).tagName === 'BR') {
      charCount += 1;
    }
    current = walker.nextNode();
  }
  return charCount + offsetInNode;
}

/** Reads the current selection start/end from a contenteditable element. */
export function ceGetSelection(el: HTMLElement): { start: number; end: number } | null {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return null;
  const range = sel.getRangeAt(0);
  if (!el.contains(range.commonAncestorContainer)) return null;
  const start = ceCharOffset(el, range.startContainer, range.startOffset);
  const end = range.collapsed ? start : ceCharOffset(el, range.endContainer, range.endOffset);
  return { start, end };
}

/** Sets the selection range in a contenteditable element by character offsets. */
export function ceSetSelection(el: HTMLElement, start: number, end: number): void {
  const sel = window.getSelection();
  if (!sel) return;
  let charCount = 0;
  let startNode: Node | null = null; let startOff = 0;
  let endNode: Node | null = null; let endOff = 0;
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_ALL, null);
  let node: Node | null = walker.nextNode();
  while (node !== null && (startNode === null || endNode === null)) {
    if (node.nodeType === Node.TEXT_NODE) {
      const len = (node as Text).length;
      if (startNode === null && charCount + len >= start) { startNode = node; startOff = start - charCount; }
      if (endNode === null && charCount + len >= end) { endNode = node; endOff = end - charCount; }
      charCount += len;
    } else if ((node as Element).tagName === 'BR') {
      if (startNode === null && charCount >= start) {
        startNode = node.parentNode!;
        startOff = Array.prototype.indexOf.call(node.parentNode!.childNodes, node);
      }
      if (endNode === null && charCount >= end) {
        endNode = node.parentNode!;
        endOff = Array.prototype.indexOf.call(node.parentNode!.childNodes, node);
      }
      charCount += 1;
    }
    node = walker.nextNode();
  }
  if (startNode === null) { startNode = el; startOff = el.childNodes.length; }
  if (endNode === null) { endNode = el; endOff = el.childNodes.length; }
  try {
    const range = document.createRange();
    range.setStart(startNode, startOff);
    range.setEnd(endNode, endOff);
    sel.removeAllRanges();
    sel.addRange(range);
  } catch {
    // stale node reference — ignore
  }
}

/**
 * Sets the text content of a contenteditable element by rebuilding child nodes
 * from scratch (text nodes + <br> for newlines).  More reliable than innerText
 * because it avoids browser-specific trailing-newline quirks.
 */
function ceSetText(el: HTMLElement, text: string): void {
  el.textContent = '';
  const lines = text.split('\n');
  lines.forEach((line, i) => {
    if (line) el.appendChild(document.createTextNode(line));
    if (i < lines.length - 1) el.appendChild(document.createElement('br'));
  });
}

/**
 * Reads the text content of a contenteditable element, treating <br> as \n.
 * Does NOT include any browser-injected sentinel <br> at the end.
 */
export function ceGetText(el: HTMLElement): string {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_ALL, null);
  let result = '';
  let node: Node | null = walker.nextNode();
  while (node) {
    if (node.nodeType === Node.TEXT_NODE) {
      result += (node as Text).data;
    } else if ((node as Element).tagName === 'BR') {
      result += '\n';
    }
    node = walker.nextNode();
  }
  // Strip a single sentinel trailing newline that Chromium may inject
  return result.endsWith('\n') && !result.endsWith('\n\n') ? result.slice(0, -1) : result;
}

/**
 * Returns the bounding DOMRect of the current collapsed caret selection,
 * or null if not available / selection is not collapsed.
 */
function getCaretBoundingRect(): DOMRect | null {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return null;
  const range = sel.getRangeAt(0).cloneRange();
  range.collapse(true);
  const rect = range.getBoundingClientRect();
  // A zero-size rect means the caret position couldn't be determined
  if (rect.width === 0 && rect.height === 0) return null;
  return rect;
}

// ─────────────────────────────────────────────────────────────────────────────

const charWidthCache = new Map<string, number>();
const VIEWPORT_JUMP_ANIMATION_DURATION_MS = 400;
const VIEWPORT_JUMP_MAX_STEP_MS = 100;
const VIEWPORT_JUMP_CURVE_EXPONENT = 1;
const VIEWPORT_JUMP_CURVE_EXPONENT_DISTANCE_FACTOR = 0.002;
const VIEWPORT_JUMP_CURVE_EXPONENT_MAX = 1.5;
const VIEWPORT_JUMP_STEP_DURATION_OFFSET_MS = 0.05;
const CARET_ANIMATION_RESUME_DELAY_MS = 200;
const GRID_STROKE_WIDTH_PX = 1;

interface ViewportAnimationStep {
  atMs: number;
  targetRow: number;
}

function getViewportJumpStepWeight(stepIndex: number, totalSteps: number, exponent: number): number {
  const k = -1 + ((2 * (stepIndex + 0.5)) / totalSteps);
  return Math.pow(k * k, exponent);
}

function getViewportJumpCurveExponent(totalDistance: number): number {
  return Math.min(
    VIEWPORT_JUMP_CURVE_EXPONENT_MAX,
    VIEWPORT_JUMP_CURVE_EXPONENT + (totalDistance * VIEWPORT_JUMP_CURVE_EXPONENT_DISTANCE_FACTOR)
  );
}

function buildViewportAnimationSchedule(
  startRow: number,
  targetRow: number,
  preferredDurationMs: number
): ViewportAnimationStep[] {
  const totalDistance = Math.abs(targetRow - startRow);
  if (totalDistance === 0) return [];

  const direction = targetRow > startRow ? 1 : -1;
  const curveExponent = getViewportJumpCurveExponent(totalDistance);
  const weights = Array.from(
    { length: totalDistance },
    (_, stepIndex) => getViewportJumpStepWeight(stepIndex, totalDistance, curveExponent) + VIEWPORT_JUMP_STEP_DURATION_OFFSET_MS
  );
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  if (totalWeight <= 0) {
    return [{ atMs: Math.min(preferredDurationMs, VIEWPORT_JUMP_MAX_STEP_MS), targetRow }];
  }

  const scaleFactor = preferredDurationMs / totalWeight;
  const firstStepDurationMs = weights[0] * scaleFactor;
  const secondaryScaleFactor = firstStepDurationMs > VIEWPORT_JUMP_MAX_STEP_MS
    ? (VIEWPORT_JUMP_MAX_STEP_MS / firstStepDurationMs)
    : 1;
  let elapsedMs = 0;
  return weights.map((weight, stepIndex) => {
    elapsedMs += weight * scaleFactor * secondaryScaleFactor;
    return {
      atMs: elapsedMs,
      targetRow: startRow + (direction * (stepIndex + 1)),
    };
  });
}

interface IndentHighlight {
  kind: CellHighlightKind;
  topPx: number;
  leftPx: number;
  widthPx: number;
  heightPx: number;
}

type CellHighlightKind = 'caret' | 'selection' | 'leading' | 'trailing';

interface HighlightColors {
  caret: string;
  selection: string;
  leading: string;
  trailing: string;
  grid: string;
  background: string;
  topBackground: string;
  bottomBackground: string;
}

interface FixedFocusEditorProps {
  text: string;
  caretPos: number;
  selectionStart?: number;
  selectionEnd?: number;
  fontSizePx: number;
  spacingPreset: string;
  highlightColors?: HighlightColors;
  fontFamily?: string;
  horizontalPaddingPx?: number;
  topRowCount?: number;
  bottomRowCount?: number;
  minCenterRowCount?: number;
  containerWidthPx?: number;
  containerHeightPx?: number;
  viewportStartRow?: number;
  onViewportStartRowChange?: (nextViewportStartRow: number) => void;
  onTopRowCountChange?: (nextTopRowCount: number) => void;
  onBottomRowCountChange?: (nextBottomRowCount: number) => void;
  onTextChange: (newText: string, newSelectionStart: number, newSelectionEnd: number) => void;
  onCaretChange?: (newCaretPos: number) => void;
  onSelectionChange?: (selectionStart: number, selectionEnd: number) => void;
  textareaRef?: React.MutableRefObject<HTMLDivElement | null>;
  textareaClassName?: string;
  textareaStyle?: React.CSSProperties;
  placeholder?: string;
  onKeyDown?: (e: React.KeyboardEvent<HTMLDivElement>) => void;
  onKeyUp?: (e: React.KeyboardEvent<HTMLDivElement>) => void;
  onCopy?: (e: React.ClipboardEvent<HTMLDivElement>) => void;
  onPaste?: (e: React.ClipboardEvent<HTMLDivElement>) => void;
  onCompositionStart?: React.CompositionEventHandler<HTMLDivElement>;
  onCompositionEnd?: React.CompositionEventHandler<HTMLDivElement>;
}

// ─────────────────────────────────────────────────────────────────────────────

export const FixedFocusEditor: React.FC<FixedFocusEditorProps> = ({
  text,
  caretPos,
  selectionStart = caretPos,
  selectionEnd = caretPos,
  fontSizePx,
  spacingPreset,
  highlightColors,
  fontFamily = '"Syne Mono", Menlo, Monaco, monospace',
  horizontalPaddingPx = 20,
  topRowCount,
  bottomRowCount,
  minCenterRowCount = 1,
  containerWidthPx = 500,
  containerHeightPx = 400,
  viewportStartRow,
  onViewportStartRowChange,
  onTopRowCountChange,
  onBottomRowCountChange,
  onTextChange,
  onCaretChange,
  onSelectionChange,
  textareaRef,
  textareaClassName,
  textareaStyle,
  placeholder,
  onKeyDown,
  onKeyUp,
  onCopy,
  onPaste,
  onCompositionStart,
  onCompositionEnd,
}) => {
  const [uncontrolledViewportStartRow, setUncontrolledViewportStartRow] = useState(0);
  const [uncontrolledTopRowCount, setUncontrolledTopRowCount] = useState(topRowCount ?? 3);
  const [uncontrolledBottomRowCount, setUncontrolledBottomRowCount] = useState(bottomRowCount ?? 3);
  const [activeResizeHandle, setActiveResizeHandle] = useState<'top' | 'bottom' | null>(null);
  const [isScrollIndicatorDragging, setIsScrollIndicatorDragging] = useState(false);
  const [isPointerSelecting, setIsPointerSelecting] = useState(false);
  const [isViewportAnimating, setIsViewportAnimating] = useState(false);
  const [isCaretAnimationPaused, setIsCaretAnimationPaused] = useState(false);
  const [resizeAnchorViewportStartRow, setResizeAnchorViewportStartRow] = useState<number | null>(null);
  const editorRootRef = useRef<HTMLDivElement>(null);
  const scrollIndicatorRef = useRef<HTMLDivElement>(null);
  const centerInputRef = useRef<HTMLDivElement>(null);
  const caretOverlayRef = useRef<HTMLDivElement>(null);
  const resizeStateRef = useRef<{
    handle: 'top' | 'bottom';
    startY: number;
    startTopRowCount: number;
    startBottomRowCount: number;
    totalVisibleRows: number;
  } | null>(null);
  const scrollIndicatorDragStateRef = useRef<{
    pointerId: number;
    dragOffsetPx: number;
  } | null>(null);
  const selectionDragStateRef = useRef<{
    pointerId: number;
    anchorPos: number;
    clientX: number;
    clientY: number;
    scrollDirection: -1 | 0 | 1;
    scrollDistancePx: number;
    fractionalRows: number;
  } | null>(null);
  const viewportAnimationRef = useRef<{
    frameId: number;
    nextStepIndex: number;
    onComplete?: () => void;
    startTimeMs: number | null;
    steps: ViewportAnimationStep[];
  } | null>(null);
  const preferredCaretVisualColumnRef = useRef<number | null>(null);
  const boundaryCaretRowPreferenceRef = useRef<number | null>(null);
  const pendingAutomaticCaretPosRef = useRef<number | null>(null);
  const pendingPreferredCaretVisualColumnRef = useRef<number | null>(null);
  const latestEffectiveViewportStartRowRef = useRef(0);
  const previousCaretPosRef = useRef(0);
  const previousViewportStartRowRef = useRef(0);
  const lastCaretViewportOffsetRef = useRef(0);
  const previousWrapWidthPxRef = useRef<number | null>(null);
  const previousCaretPosForAnimationRef = useRef(caretPos);
  const caretAnimationResumeTimeoutRef = useRef<number | null>(null);
  const centerStartRow = viewportStartRow ?? uncontrolledViewportStartRow;
  const resolvedTopRowCount = topRowCount ?? uncontrolledTopRowCount;
  const resolvedBottomRowCount = bottomRowCount ?? uncontrolledBottomRowCount;
  const contentWidthPx = Math.max(1, containerWidthPx - (horizontalPaddingPx * 2));
  const topInsetPx = Math.max(0, computeTopInsetPx(spacingPreset));
  const drawableHeightPx = Math.max(1, containerHeightPx - topInsetPx);
  const charCellWidthPx = useMemo(
    () => measureMonospaceCellWidthPx(fontSizePx, fontFamily),
    [fontFamily, fontSizePx]
  );

  const setViewportStartRow = useCallback((nextViewportStartRow: number | ((prev: number) => number)) => {
    const resolvedNextRow = typeof nextViewportStartRow === 'function'
      ? nextViewportStartRow(centerStartRow)
      : nextViewportStartRow;
    const clampedNextRow = Math.max(0, resolvedNextRow);
    if (viewportStartRow === undefined) {
      setUncontrolledViewportStartRow(clampedNextRow);
    }
    onViewportStartRowChange?.(clampedNextRow);
  }, [centerStartRow, onViewportStartRowChange, viewportStartRow]);

  const setTopZoneRowCount = useCallback((nextTopRowCount: number) => {
    const clampedTopRowCount = Math.max(0, Math.floor(nextTopRowCount));
    if (topRowCount === undefined) {
      setUncontrolledTopRowCount(clampedTopRowCount);
    }
    onTopRowCountChange?.(clampedTopRowCount);
  }, [onTopRowCountChange, topRowCount]);

  const setBottomZoneRowCount = useCallback((nextBottomRowCount: number) => {
    const clampedBottomRowCount = Math.max(0, Math.floor(nextBottomRowCount));
    if (bottomRowCount === undefined) {
      setUncontrolledBottomRowCount(clampedBottomRowCount);
    }
    onBottomRowCountChange?.(clampedBottomRowCount);
  }, [bottomRowCount, onBottomRowCountChange]);

  useEffect(() => {
    if (!textareaRef) return;
    textareaRef.current = centerInputRef.current;
  }, [textareaRef]);

  // Sync external text-prop changes into the contenteditable DOM.
  // When the user types, ceGetText(el) === text and this is a no-op.
  // When undo/redo/programmatic changes arrive, we rebuild the DOM.
  useLayoutEffect(() => {
    const el = centerInputRef.current;
    if (!el) return;
    if (ceGetText(el) !== text) {
      const savedSel = ceGetSelection(el);
      ceSetText(el, text);
      if (savedSel && document.activeElement === el) {
        ceSetSelection(el, savedSel.start, savedSel.end);
      }
    }
  }, [text]);

  useEffect(() => {
    if (caretPos === previousCaretPosForAnimationRef.current) return;

    previousCaretPosForAnimationRef.current = caretPos;
    setIsCaretAnimationPaused(true);
    if (caretAnimationResumeTimeoutRef.current != null) {
      window.clearTimeout(caretAnimationResumeTimeoutRef.current);
    }
    caretAnimationResumeTimeoutRef.current = window.setTimeout(() => {
      setIsCaretAnimationPaused(false);
      caretAnimationResumeTimeoutRef.current = null;
    }, CARET_ANIMATION_RESUME_DELAY_MS);
  }, [caretPos]);

  useEffect(() => () => {
    if (caretAnimationResumeTimeoutRef.current != null) {
      window.clearTimeout(caretAnimationResumeTimeoutRef.current);
    }
  }, []);

  // Build model for zone slicing + layout; viewport driven entirely by centerStartRow state.
  // Contract:
  // - rightmost 1 column is the scrollbar indicator
  // - next 2 columns are reserved visual-only columns (no text)
  // - text wraps within the remaining columns
  // Use a tiny safety margin so sub-pixel measurement drift does not create
  // an extra phantom terminal column at soft-wrap boundaries.
  const wrapSafetyPx = 1;
  const totalColumnCount = Math.max(1, Math.floor((contentWidthPx - wrapSafetyPx) / charCellWidthPx));
  const gridColumnCount = Math.max(0, totalColumnCount - 1);
  const reservedVisualOnlyColumns = 2;
  const textColumnCount = Math.max(1, gridColumnCount - reservedVisualOnlyColumns);
  const wrapWidthPx = Math.max(1, textColumnCount * charCellWidthPx);
  const textareaRightPaddingPx = Math.max(
    horizontalPaddingPx,
    containerWidthPx - horizontalPaddingPx - wrapWidthPx
  );
  const model = useMemo(() => {
    const m = new FixedFocusViewportModel(
      fontSizePx,
      spacingPreset,
      wrapWidthPx,
      drawableHeightPx,
      fontFamily,
      resolvedTopRowCount,
      resolvedBottomRowCount,
      charCellWidthPx
    );
    m.setText(text, wrapWidthPx);
    return m;
  }, [
    text,
    fontSizePx,
    spacingPreset,
    wrapWidthPx,
    drawableHeightPx,
    fontFamily,
    resolvedTopRowCount,
    resolvedBottomRowCount,
    charCellWidthPx,
  ]);

  const wrappedLines = model.getWrappedLines();
  const provisionalViewport = model.getViewport();
  const caretGridCell = getCaretGridCell(caretPos, wrappedLines, text, boundaryCaretRowPreferenceRef.current);
  const caretRow = caretGridCell.gridRow;

  const maxStart = Math.max(0, wrappedLines.length - provisionalViewport.centerRowCount);
  const maxViewportStartRow = Math.max(0, wrappedLines.length - 1);
  const clampedCenterStartRow = Math.max(0, Math.min(centerStartRow, maxViewportStartRow));
  const effectiveCenterStartRow = activeResizeHandle && resizeAnchorViewportStartRow != null
    ? Math.max(0, Math.min(resizeAnchorViewportStartRow, maxViewportStartRow))
    : clampedCenterStartRow;

  model.setViewportStartRow(effectiveCenterStartRow);

  const metrics = model.getMetrics();
  const layout = model.getLayout();
  const viewport = model.getViewport();
  const topRows = model.getTopZoneRows();
  const centerRows = model.getCenterZoneRows();
  const bottomRows = model.getBottomZoneRows();
  const gridRowCount = Math.max(0, Math.floor(drawableHeightPx / metrics.rowHeightPx));
  const quantizedGridWidthPx = gridColumnCount * charCellWidthPx;
  const quantizedBackgroundWidthPx = Math.max(0, quantizedGridWidthPx - charCellWidthPx);
  const quantizedGridHeightPx = gridRowCount * metrics.rowHeightPx;
  const totalVisibleRows = viewport.topRowCount + viewport.centerRowCount + viewport.bottomRowCount;
  const totalWrappedRowCount = Math.max(1, wrappedLines.length);
  const rowsAboveCenter = Math.max(0, effectiveCenterStartRow);
  const centerVisibleRowCount = Math.min(viewport.centerRowCount, totalWrappedRowCount);
  const rowsBelowCenter = Math.max(0, totalWrappedRowCount - rowsAboveCenter - centerVisibleRowCount);
  const middleIndicatorRowCount = Math.max(
    1,
    Math.min(totalVisibleRows, Math.round((totalVisibleRows * centerVisibleRowCount) / totalWrappedRowCount))
  );
  const remainingIndicatorRows = Math.max(0, totalVisibleRows - middleIndicatorRowCount);
  const topIndicatorRowCount = Math.max(
    0,
    Math.min(remainingIndicatorRows, Math.round((totalVisibleRows * rowsAboveCenter) / totalWrappedRowCount))
  );
  const bottomIndicatorRowCount = Math.max(0, totalVisibleRows - middleIndicatorRowCount - topIndicatorRowCount);
  const indicatorHeightPx = totalVisibleRows * metrics.rowHeightPx;
  const indicatorThumbTopPx = topIndicatorRowCount * metrics.rowHeightPx;
  const indicatorThumbHeightPx = middleIndicatorRowCount * metrics.rowHeightPx;
  const maxIndicatorThumbTopPx = Math.max(0, indicatorHeightPx - indicatorThumbHeightPx);

  // Keep maxStart fresh for use inside the stable wheel listener
  const maxStartRef = useRef(maxStart);

  useEffect(() => {
    maxStartRef.current = maxStart;
  }, [maxStart]);

  useEffect(() => {
    latestEffectiveViewportStartRowRef.current = effectiveCenterStartRow;
  }, [effectiveCenterStartRow]);

  const rememberPreferredCaretVisualColumn = useCallback((nextVisualColumn: number) => {
    pendingPreferredCaretVisualColumnRef.current = Math.max(0, Math.floor(nextVisualColumn));
  }, []);

  const getVisualColumnForCaretPos = useCallback((charIndex: number) => {
    return getVisualColumnForCaretPosition(charIndex, wrappedLines, text);
  }, [text, wrappedLines]);

  useEffect(() => {
    if (selectionStart !== selectionEnd) return;

    const pendingPreferredVisualColumn = pendingPreferredCaretVisualColumnRef.current;
    if (pendingPreferredVisualColumn != null) {
      preferredCaretVisualColumnRef.current = pendingPreferredVisualColumn;
      pendingPreferredCaretVisualColumnRef.current = null;
      if (pendingAutomaticCaretPosRef.current === selectionEnd) {
        pendingAutomaticCaretPosRef.current = null;
      }
      return;
    }

    if (pendingAutomaticCaretPosRef.current === selectionEnd) {
      pendingAutomaticCaretPosRef.current = null;
      return;
    }

    preferredCaretVisualColumnRef.current = getVisualColumnForCaretPos(selectionEnd);
  }, [getVisualColumnForCaretPos, selectionEnd, selectionStart]);

  const cancelViewportAnimation = useCallback(() => {
    const animationState = viewportAnimationRef.current;
    if (!animationState) return;

    window.cancelAnimationFrame(animationState.frameId);
    viewportAnimationRef.current = null;
    setIsViewportAnimating(false);
  }, []);

  const animateViewportStartRow = useCallback((nextViewportStartRow: number, onComplete?: () => void) => {
    const clampedTargetRow = Math.max(0, Math.min(maxStartRef.current, nextViewportStartRow));
    const startRow = latestEffectiveViewportStartRowRef.current;
    if (clampedTargetRow === startRow) {
      onComplete?.();
      return;
    }

    cancelViewportAnimation();

    const steps = buildViewportAnimationSchedule(
      startRow,
      clampedTargetRow,
      VIEWPORT_JUMP_ANIMATION_DURATION_MS
    );

    if (steps.length === 0) {
      onComplete?.();
      return;
    }

    setIsViewportAnimating(true);
    const animationState = {
      frameId: 0,
      nextStepIndex: 0,
      onComplete,
      startTimeMs: null as number | null,
      steps,
    };

    const finishAnimation = () => {
      const completedAnimation = viewportAnimationRef.current;
      viewportAnimationRef.current = null;
      setIsViewportAnimating(false);
      completedAnimation?.onComplete?.();
    };

    const stepAnimation = (timestamp: number) => {
      const currentAnimation = viewportAnimationRef.current;
      if (!currentAnimation) return;

      if (currentAnimation.startTimeMs == null) {
        currentAnimation.startTimeMs = timestamp;
      }

      const elapsedMs = timestamp - currentAnimation.startTimeMs;
      while (
        currentAnimation.nextStepIndex < currentAnimation.steps.length
        && elapsedMs >= currentAnimation.steps[currentAnimation.nextStepIndex].atMs
      ) {
        const stepTargetRow = currentAnimation.steps[currentAnimation.nextStepIndex].targetRow;
        latestEffectiveViewportStartRowRef.current = stepTargetRow;
        setViewportStartRow(stepTargetRow);
        currentAnimation.nextStepIndex += 1;
      }

      if (currentAnimation.nextStepIndex >= currentAnimation.steps.length) {
        finishAnimation();
        return;
      }

      currentAnimation.frameId = window.requestAnimationFrame(stepAnimation);
    };

    viewportAnimationRef.current = animationState;
    animationState.frameId = window.requestAnimationFrame(stepAnimation);
  }, [cancelViewportAnimation, setViewportStartRow]);

  useEffect(() => () => {
    cancelViewportAnimation();
  }, [cancelViewportAnimation]);

  const finishResize = () => {
    setViewportStartRow(latestEffectiveViewportStartRowRef.current);
    resizeStateRef.current = null;
    setResizeAnchorViewportStartRow(null);
    setActiveResizeHandle(null);
    document.body.style.userSelect = '';
    document.body.style.cursor = '';
  };

  const getViewportBoundaryCaretPos = useCallback((viewportStartRowForSnap: number) => {
    if (wrappedLines.length === 0) return caretPos;

    const visibleStartRow = Math.max(0, Math.min(viewportStartRowForSnap, wrappedLines.length - 1));
    const visibleEndRow = Math.max(
      visibleStartRow,
      Math.min(wrappedLines.length - 1, visibleStartRow + viewport.centerRowCount - 1)
    );
    const preferredVisualColumn = preferredCaretVisualColumnRef.current ?? getVisualColumnForCaretPos(caretPos);

    if (caretRow < visibleStartRow) {
      return getCharIndexForVisualCellInRow(wrappedLines[visibleStartRow], text, preferredVisualColumn);
    }

    if (caretRow > visibleEndRow) {
      return getCharIndexForVisualCellInRow(wrappedLines[visibleEndRow], text, preferredVisualColumn);
    }

    return caretPos;
  }, [caretPos, caretRow, getVisualColumnForCaretPos, text, viewport.centerRowCount, wrappedLines]);

  const applyAutomaticCaretPos = useCallback((nextCaretPos: number) => {
    pendingAutomaticCaretPosRef.current = nextCaretPos;
    onCaretChange?.(nextCaretPos);
  }, [onCaretChange]);

  useLayoutEffect(() => {
    // Track wrap width changes and caret/viewport sync in a single effect so they
    // can never conflict within the same commit.  Two separate effects both running
    // in the same commit would leave effectiveCenterStartRow stale in the second
    // effect while the first has already queued a viewport state update, causing
    // the caret to be snapped to the old (wrong) viewport boundary.
    const previousWrapWidthPx = previousWrapWidthPxRef.current;
    previousWrapWidthPxRef.current = wrapWidthPx;
    const wrapWidthJustChanged = previousWrapWidthPx !== null && wrapWidthPx !== previousWrapWidthPx;

    // When the wrap width changes (window resize reflows text), re-anchor the
    // viewport so the caret stays at its previous visual offset from the top of
    // the center zone.  Skip caret-boundary clamping this render — effectiveCenterStartRow
    // is still the pre-resize value, so clamping would snap the caret incorrectly.
    if (wrapWidthJustChanged && !activeResizeHandle) {
      const preferredOffset = Math.max(0, Math.min(viewport.centerRowCount - 1, lastCaretViewportOffsetRef.current));
      const nextViewportStartRow = Math.max(0, Math.min(maxStart, caretRow - preferredOffset));
      latestEffectiveViewportStartRowRef.current = nextViewportStartRow;
      setViewportStartRow(nextViewportStartRow);
      // Pre-seed the prev-state refs so the next render's effect does not see a
      // phantom "caretMoved" or "viewportMoved" caused by this reanchor.
      previousCaretPosRef.current = caretPos;
      previousViewportStartRowRef.current = nextViewportStartRow;
      return;
    }

    if (activeResizeHandle || isScrollIndicatorDragging || isPointerSelecting || isViewportAnimating || selectionStart !== selectionEnd) {
      previousCaretPosRef.current = caretPos;
      previousViewportStartRowRef.current = effectiveCenterStartRow;
      return;
    }

    const visibleStartRow = Math.max(0, Math.min(effectiveCenterStartRow, wrappedLines.length - 1));
    const visibleEndRow = Math.max(
      visibleStartRow,
      Math.min(wrappedLines.length - 1, visibleStartRow + viewport.centerRowCount - 1)
    );
    const caretOutsideVisibleCenter = wrappedLines.length > 0
      && (caretRow < visibleStartRow || caretRow > visibleEndRow);

    if (!caretOutsideVisibleCenter && wrappedLines.length > 0) {
      lastCaretViewportOffsetRef.current = Math.max(0, caretRow - visibleStartRow);
    }

    if (caretOutsideVisibleCenter) {
      const caretMoved = caretPos !== previousCaretPosRef.current;
      const viewportMoved = effectiveCenterStartRow !== previousViewportStartRowRef.current;

      // When caret movement drives the out-of-bounds state (typing, Enter, Home/End, etc.),
      // scroll the viewport to keep the caret in center instead of snapping caret backwards.
      if (caretMoved && !viewportMoved) {
        const preferredOffset = Math.max(0, Math.min(viewport.centerRowCount - 1, lastCaretViewportOffsetRef.current));
        const nextViewportStartRow = Math.max(0, caretRow - preferredOffset);
        if (nextViewportStartRow !== effectiveCenterStartRow) {
          setViewportStartRow(nextViewportStartRow);
          previousCaretPosRef.current = caretPos;
          previousViewportStartRowRef.current = effectiveCenterStartRow;
          return;
        }
      }
    }

    const clampedCaretPos = getViewportBoundaryCaretPos(effectiveCenterStartRow);
    if (clampedCaretPos !== caretPos) {
      applyAutomaticCaretPos(clampedCaretPos);
    }

    previousCaretPosRef.current = caretPos;
    previousViewportStartRowRef.current = effectiveCenterStartRow;
  }, [activeResizeHandle, applyAutomaticCaretPos, caretPos, caretRow, effectiveCenterStartRow, getViewportBoundaryCaretPos, isPointerSelecting, isScrollIndicatorDragging, isViewportAnimating, maxStart, selectionEnd, selectionStart, setViewportStartRow, viewport.centerRowCount, wrapWidthPx, wrappedLines.length]);

  const handleResizeMove = useCallback((event: PointerEvent) => {
    const resizeState = resizeStateRef.current;
    if (!resizeState) return;

    const deltaRows = Math.round((event.clientY - resizeState.startY) / metrics.rowHeightPx);
    if (resizeState.handle === 'top') {
      const maxTopRowCount = Math.max(0, resizeState.totalVisibleRows - minCenterRowCount - resizeState.startBottomRowCount);
      setTopZoneRowCount(Math.max(0, Math.min(maxTopRowCount, resizeState.startTopRowCount + deltaRows)));
      return;
    }

    const maxBottomRowCount = Math.max(0, resizeState.totalVisibleRows - minCenterRowCount - resizeState.startTopRowCount);
    setBottomZoneRowCount(Math.max(0, Math.min(maxBottomRowCount, resizeState.startBottomRowCount - deltaRows)));
  }, [metrics.rowHeightPx, minCenterRowCount, setBottomZoneRowCount, setTopZoneRowCount]);

  useEffect(() => {
    if (!activeResizeHandle) return;

    const handlePointerUp = () => finishResize();
    window.addEventListener('pointermove', handleResizeMove);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerUp);

    return () => {
      window.removeEventListener('pointermove', handleResizeMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerUp);
    };
  }, [activeResizeHandle, finishResize, handleResizeMove]);

  const setViewportStartRowFromIndicatorThumbTopPx = useCallback((thumbTopPx: number) => {
    if (maxStart <= 0 || maxIndicatorThumbTopPx <= 0) {
      setViewportStartRow(0);
      return;
    }

    const clampedThumbTopPx = Math.max(0, Math.min(maxIndicatorThumbTopPx, thumbTopPx));
    const nextViewportStartRow = Math.round((clampedThumbTopPx / maxIndicatorThumbTopPx) * maxStart);
    setViewportStartRow(nextViewportStartRow);
  }, [maxIndicatorThumbTopPx, maxStart, setViewportStartRow]);

  const handleScrollIndicatorPointerMove = useCallback((event: PointerEvent) => {
    const dragState = scrollIndicatorDragStateRef.current;
    const scrollIndicatorElement = scrollIndicatorRef.current;
    if (!dragState || !scrollIndicatorElement) return;

    const indicatorBounds = scrollIndicatorElement.getBoundingClientRect();
    const relativePointerY = event.clientY - indicatorBounds.top;
    setViewportStartRowFromIndicatorThumbTopPx(relativePointerY - dragState.dragOffsetPx);
  }, [setViewportStartRowFromIndicatorThumbTopPx]);

  const getAutoScrollRowsPerSecond = useCallback((distancePx: number) => {
    if (distancePx <= 0) return 0;
    if (distancePx <= 10) return 1;
    if (distancePx >= 100) return 20;
    return 1 + (((distancePx - 10) / 90) * 19);
  }, []);

  useEffect(() => {
    if (!isScrollIndicatorDragging) return;

    const handlePointerUp = () => {
      const finalViewportStartRow = latestEffectiveViewportStartRowRef.current;
      const snappedCaretPos = getViewportBoundaryCaretPos(finalViewportStartRow);
      scrollIndicatorDragStateRef.current = null;
      setIsScrollIndicatorDragging(false);
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
      if (snappedCaretPos !== caretPos) {
        applyAutomaticCaretPos(snappedCaretPos);
      }
      centerInputRef.current?.focus();
    };

    window.addEventListener('pointermove', handleScrollIndicatorPointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerUp);

    return () => {
      window.removeEventListener('pointermove', handleScrollIndicatorPointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerUp);
    };
  }, [applyAutomaticCaretPos, caretPos, getViewportBoundaryCaretPos, handleScrollIndicatorPointerMove, isScrollIndicatorDragging]);

  // Sync selection state into the contenteditable DOM (e.g. after programmatic
  // caret moves from Up/Down/Home/End keys and after undo/redo).
  useEffect(() => {
    const el = centerInputRef.current;
    if (!el || document.activeElement !== el) return;
    const live = ceGetSelection(el);
    if (!live || live.start !== selectionStart || live.end !== selectionEnd) {
      ceSetSelection(el, selectionStart, selectionEnd);
    }
    // Suppress any internal scroll the browser may apply
    if (el.scrollTop) el.scrollTop = 0;
    if (el.scrollLeft) el.scrollLeft = 0;
  }, [selectionEnd, selectionStart]);

  // After every render, read the native caret rect and update the caret overlay
  // div imperatively — no extra React render needed.
  useLayoutEffect(() => {
    const overlay = caretOverlayRef.current;
    const container = editorRootRef.current;
    const el = centerInputRef.current;
    if (!overlay || !container || !el) return;

    if (selectionStart !== selectionEnd || document.activeElement !== el) {
      overlay.style.display = 'none';
      return;
    }

    const caretRect = getCaretBoundingRect();

    let cellCol: number;
    let cellRow: number;

    if (caretRect) {
      const containerRect = container.getBoundingClientRect();
      // Snap to grid cell so the box aligns with the background grid
      const relLeft = caretRect.left - containerRect.left - horizontalPaddingPx;
      const relTop = caretRect.top - containerRect.top;
      cellCol = Math.max(0, Math.round(relLeft / charCellWidthPx));
      cellRow = Math.max(0, Math.floor(relTop / metrics.rowHeightPx));
    } else {
      // Fallback for blank lines: Chrome returns an all-zero rect for a collapsed
      // range sitting on a <br> node.  Derive position from the model instead.
      cellCol = caretGridCell.gridColumn;
      const relTopFallback = topInsetPx + layout.topHeightPx
        + (caretRow - effectiveCenterStartRow) * metrics.rowHeightPx;
      cellRow = Math.max(0, Math.floor(relTopFallback / metrics.rowHeightPx));
    }

    const cellLeftBoundaryPx = snapToDevicePixels(horizontalPaddingPx + cellCol * charCellWidthPx);
    const cellRightBoundaryPx = snapToDevicePixels(horizontalPaddingPx + (cellCol + 1) * charCellWidthPx);
    const cellTopBoundaryPx = snapToDevicePixels(cellRow * metrics.rowHeightPx);
    const cellBottomBoundaryPx = snapToDevicePixels((cellRow + 1) * metrics.rowHeightPx);

    overlay.style.display = 'block';
    overlay.style.left = `${cellLeftBoundaryPx + GRID_STROKE_WIDTH_PX}px`;
    overlay.style.top = `${cellTopBoundaryPx + GRID_STROKE_WIDTH_PX}px`;
    overlay.style.width = `${Math.max(0, cellRightBoundaryPx - cellLeftBoundaryPx - GRID_STROKE_WIDTH_PX * 2)}px`;
    overlay.style.height = `${Math.max(0, cellBottomBoundaryPx - cellTopBoundaryPx - GRID_STROKE_WIDTH_PX * 2)}px`;
  });

  const handleInput = (e: React.FormEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    const newText = ceGetText(el);
    const sel = ceGetSelection(el);
    const newSelectionStart = sel?.start ?? 0;
    const newSelectionEnd = sel?.end ?? newSelectionStart;
    onTextChange(newText, newSelectionStart, newSelectionEnd);
  };

  // Track caret changes from mouse clicks / selection
  const handleSelect = (e: React.SyntheticEvent<HTMLDivElement>) => {
    if (selectionDragStateRef.current) return;

    const el = e.currentTarget;
    const sel = ceGetSelection(el);
    if (!sel) return;
    const { start: newSelectionStart, end: newSelectionEnd } = sel;

    // If this is a user-driven caret change (Left/Right arrows, click, etc.)
    // and not a programmatic setSelectionRange we issued ourselves, clear any
    // stale boundary-row preference.  Stale preferences cause the custom caret
    // to land on a different row than the native caret at wrap boundaries.
    if (newSelectionStart === newSelectionEnd &&
        pendingAutomaticCaretPosRef.current !== newSelectionEnd) {
      boundaryCaretRowPreferenceRef.current = null;
    }

    onSelectionChange?.(newSelectionStart, newSelectionEnd);
  };

  const getCharIndexForVisualCell = useCallback((row: WrappedLine, targetCell: number) => {
    return getCharIndexForVisualCellInRow(row, text, targetCell);
  }, [text]);

  const moveCaretToWrappedRow = useCallback((targetRowIndex: number) => {
    if (wrappedLines.length === 0) return null;

    const clampedTargetRowIndex = Math.max(0, Math.min(wrappedLines.length - 1, targetRowIndex));
    const targetRow = wrappedLines[clampedTargetRowIndex];
    if (!targetRow) return null;

    const preferredVisualColumn = preferredCaretVisualColumnRef.current ?? getVisualColumnForCaretPos(caretPos);
    const nextCaretPos = getCharIndexForVisualCell(targetRow, preferredVisualColumn);
    boundaryCaretRowPreferenceRef.current = clampedTargetRowIndex;
    pendingAutomaticCaretPosRef.current = nextCaretPos;
    onCaretChange?.(nextCaretPos);
    return {
      nextCaretPos,
      targetRowIndex: clampedTargetRowIndex,
    };
  }, [caretPos, getCharIndexForVisualCell, getVisualColumnForCaretPos, onCaretChange, wrappedLines]);

  const handlePassiveZonePointerDown = (
    zone: 'top' | 'bottom',
    zoneRows: WrappedLine[],
    zoneStartRow: number,
    insetTopPx = 0
  ) => (event: React.PointerEvent<HTMLDivElement>) => {
    if (zoneRows.length === 0) return;

    cancelViewportAnimation();

    const zoneBounds = event.currentTarget.getBoundingClientRect();
    const relativeY = event.clientY - zoneBounds.top - insetTopPx;
    const rawRowIndex = Math.floor(relativeY / metrics.rowHeightPx);
    const rowIndex = Math.max(0, Math.min(zoneRows.length - 1, rawRowIndex));
    const targetRowIndex = zoneStartRow + rowIndex;
    const targetRow = wrappedLines[targetRowIndex];
    if (!targetRow) return;

    const relativeX = event.clientX - zoneBounds.left - horizontalPaddingPx;
    const targetCell = Math.max(0, Math.round(relativeX / charCellWidthPx));
    boundaryCaretRowPreferenceRef.current = targetRowIndex;
    rememberPreferredCaretVisualColumn(targetCell);
    const nextCaretPos = getCharIndexForVisualCell(targetRow, targetCell);
    const nextViewportStartRow = zone === 'top'
      ? targetRowIndex
      : Math.max(0, targetRowIndex - viewport.centerRowCount + 1);

    if (event.shiftKey) {
      animateViewportStartRow(nextViewportStartRow, () => {
        const nextSelectionStart = Math.min(caretPos, nextCaretPos);
        const nextSelectionEnd = Math.max(caretPos, nextCaretPos);
        onSelectionChange?.(nextSelectionStart, nextSelectionEnd);
        window.requestAnimationFrame(() => {
          centerInputRef.current?.focus();
        });
      });
      return;
    }

    animateViewportStartRow(nextViewportStartRow, () => {
      onCaretChange?.(nextCaretPos);
      window.requestAnimationFrame(() => {
        centerInputRef.current?.focus();
      });
    });
  };

  const handleScrollIndicatorPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (totalWrappedRowCount <= viewport.centerRowCount) return;

    event.preventDefault();
    const indicatorBounds = event.currentTarget.getBoundingClientRect();
    const relativePointerY = Math.max(0, Math.min(indicatorHeightPx, event.clientY - indicatorBounds.top));
    const thumbBottomPx = indicatorThumbTopPx + indicatorThumbHeightPx;
    const clickedInsideThumb = relativePointerY >= indicatorThumbTopPx && relativePointerY <= thumbBottomPx;
    const dragOffsetPx = clickedInsideThumb
      ? relativePointerY - indicatorThumbTopPx
      : (indicatorThumbHeightPx / 2);

    cancelViewportAnimation();

    if (!clickedInsideThumb) {
      if (maxStart <= 0 || maxIndicatorThumbTopPx <= 0) {
        animateViewportStartRow(0);
        return;
      }

      const clampedThumbTopPx = Math.max(0, Math.min(maxIndicatorThumbTopPx, relativePointerY - dragOffsetPx));
      const nextViewportStartRow = Math.round((clampedThumbTopPx / maxIndicatorThumbTopPx) * maxStart);
      animateViewportStartRow(nextViewportStartRow);
      return;
    }

    scrollIndicatorDragStateRef.current = {
      pointerId: event.pointerId,
      dragOffsetPx,
    };
    setIsScrollIndicatorDragging(true);
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'pointer';
  };

  const handleCenterPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;

    cancelViewportAnimation();
    event.preventDefault();

    const editorRoot = editorRootRef.current;
    const rootBounds = editorRoot?.getBoundingClientRect();
    const pointerCell = rootBounds
      ? Math.max(0, Math.round((event.clientX - rootBounds.left - horizontalPaddingPx) / charCellWidthPx))
      : 0;
    rememberPreferredCaretVisualColumn(pointerCell);
    const clickedPos = getCharIndexForPointer(event.clientX, event.clientY);

    if (event.shiftKey) {
      const nextSelectionStart = Math.min(caretPos, clickedPos);
      const nextSelectionEnd = Math.max(caretPos, clickedPos);
      event.currentTarget.focus();
      ceSetSelection(event.currentTarget, nextSelectionStart, nextSelectionEnd);
      onSelectionChange?.(nextSelectionStart, nextSelectionEnd);
      return;
    }

    const anchorPos = clickedPos;
    event.currentTarget.focus();
    ceSetSelection(event.currentTarget, anchorPos, anchorPos);

    selectionDragStateRef.current = {
      pointerId: event.pointerId,
      anchorPos,
      clientX: event.clientX,
      clientY: event.clientY,
      scrollDirection: 0,
      scrollDistancePx: 0,
      fractionalRows: 0,
    };
    onSelectionChange?.(anchorPos, anchorPos);
    setIsPointerSelecting(true);
  };

  // Register non-passive wheel listener once so we can call preventDefault.
  // (React's synthetic onWheel cannot preventDefault on passive listeners.)
  useEffect(() => {
    const editorRoot = editorRootRef.current;
    if (!editorRoot) return;
    const onWheel = (e: WheelEvent) => {
      cancelViewportAnimation();
      e.preventDefault();
      const dir = e.deltaY > 0 ? 1 : -1;
      const scrollCeiling = Math.max(maxStartRef.current, effectiveCenterStartRow);
      const nextViewportStartRow = Math.max(0, Math.min(scrollCeiling, effectiveCenterStartRow + dir));
      if (nextViewportStartRow === effectiveCenterStartRow) return;

      setViewportStartRow(nextViewportStartRow);

      if (isPointerSelecting || selectionStart !== selectionEnd) {
        return;
      }

      const clampedCaretPos = getViewportBoundaryCaretPos(nextViewportStartRow);
      if (clampedCaretPos !== caretPos) {
        applyAutomaticCaretPos(clampedCaretPos);
      }
    };
    editorRoot.addEventListener('wheel', onWheel, { passive: false });
    return () => editorRoot.removeEventListener('wheel', onWheel);
  }, [applyAutomaticCaretPos, cancelViewportAnimation, caretPos, effectiveCenterStartRow, getViewportBoundaryCaretPos, isPointerSelecting, selectionEnd, selectionStart]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!(e.shiftKey || e.ctrlKey || e.altKey)) {
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        const caretRow = findRowForCharIndex(caretPos, wrappedLines);
        if (caretRow > 0) {
          const prevRow = caretRow - 1;
          moveCaretToWrappedRow(prevRow);
          if (prevRow < centerStartRow) {
            setViewportStartRow(row => Math.max(0, row - 1));
          }
        }
        return;
      }

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        const caretRow = findRowForCharIndex(caretPos, wrappedLines);
        if (caretRow < wrappedLines.length - 1) {
          const nextRow = caretRow + 1;
          moveCaretToWrappedRow(nextRow);
          if (nextRow >= effectiveCenterStartRow + viewport.centerRowCount) {
            setViewportStartRow(row => Math.min(Math.max(maxStartRef.current, row), row + 1));
          }
        }
        return;
      }

      if (e.key === 'PageUp') {
        e.preventDefault();
        const pageRowDelta = Math.max(1, viewport.centerRowCount);
        const caretRow = findRowForCharIndex(caretPos, wrappedLines);
        const targetRow = Math.max(0, caretRow - pageRowDelta);
        const targetViewportStartRow = Math.max(0, effectiveCenterStartRow - pageRowDelta);
        setViewportStartRow(targetViewportStartRow);
        moveCaretToWrappedRow(targetRow);
        return;
      }

      if (e.key === 'PageDown') {
        e.preventDefault();
        const pageRowDelta = Math.max(1, viewport.centerRowCount);
        const caretRow = findRowForCharIndex(caretPos, wrappedLines);
        const targetRow = Math.min(wrappedLines.length - 1, caretRow + pageRowDelta);
        const targetViewportStartRow = Math.min(maxStartRef.current, effectiveCenterStartRow + pageRowDelta);
        setViewportStartRow(targetViewportStartRow);
        moveCaretToWrappedRow(targetRow);
        return;
      }

      if (e.key === 'Home' || e.key === 'End') {
        e.preventDefault();
        if (wrappedLines.length === 0) return;

        const currentRowIndex = resolveRowForCaretIndex(
          caretPos,
          wrappedLines,
          boundaryCaretRowPreferenceRef.current
        );
        const currentRow = wrappedLines[currentRowIndex];
        if (!currentRow) return;

        const nextCaretPos = e.key === 'Home'
          ? currentRow.startCharIndex
          : currentRow.endCharIndex;

        // For Home: position is at the start of this row (= end of previous row),
        // which the browser renders at the start of currentRowIndex — set that.
        // For End: position is at the end of this row (= start of next row),
        // which the browser renders at the start of the next row — clear the
        // preference so the downstream default (baseRow + 1) handles it.
        boundaryCaretRowPreferenceRef.current = e.key === 'Home' ? currentRowIndex : null;

        if (e.key === 'Home') {
          rememberPreferredCaretVisualColumn(0);
        } else {
          const rowText = text.slice(currentRow.startCharIndex, currentRow.endCharIndex);
          rememberPreferredCaretVisualColumn(countVisualCells(rowText));
        }

        if (selectionStart !== selectionEnd) {
          onSelectionChange?.(nextCaretPos, nextCaretPos);
          return;
        }

        onCaretChange?.(nextCaretPos);
        return;
      }
    }

    onKeyDown?.(e);
  };

  const startResize = (handle: 'top' | 'bottom') => (event: React.PointerEvent<HTMLDivElement>) => {
    cancelViewportAnimation();
    event.preventDefault();
    resizeStateRef.current = {
      handle,
      startY: event.clientY,
      startTopRowCount: viewport.topRowCount,
      startBottomRowCount: viewport.bottomRowCount,
      totalVisibleRows,
    };
    setResizeAnchorViewportStartRow(effectiveCenterStartRow);
    setActiveResizeHandle(handle);
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'row-resize';
  };

  // Translate the textarea vertically so that row `centerStartRow` aligns with
  // the top of the center zone. The parent div clips via overflow:hidden.
  const textareaTopPx = -(effectiveCenterStartRow * metrics.rowHeightPx);
  const textareaHeightPx = Math.max(
    layout.centerHeightPx,
    wrappedLines.length * metrics.rowHeightPx
  );
  const topRowsInsetPx = Math.max(0, layout.topHeightPx - (topRows.length * metrics.rowHeightPx));
  const topDividerTopPx = Math.max(0, Math.round(topInsetPx + heightForRows(viewport.topRowCount, metrics)));
  const bottomDividerTopPx = Math.max(0, Math.round(
    topInsetPx +
    layout.topHeightPx +
    heightForRows(viewport.centerRowCount, metrics)
  ));

  const getVisibleRowIndexForPointer = useCallback((clientY: number) => {
    const editorRoot = editorRootRef.current;
    if (!editorRoot || wrappedLines.length === 0) return 0;

    const rootBounds = editorRoot.getBoundingClientRect();
    const relativeY = clientY - rootBounds.top - topInsetPx;
    const topStartRow = Math.max(0, effectiveCenterStartRow - topRows.length);
    const centerTopPx = layout.topHeightPx;
    const centerBottomPx = layout.topHeightPx + layout.centerHeightPx;
    const bottomStartRow = effectiveCenterStartRow + viewport.centerRowCount;

    if (relativeY <= centerTopPx) {
      if (topRows.length === 0) {
        return Math.max(0, Math.min(wrappedLines.length - 1, effectiveCenterStartRow));
      }

      const adjustedY = Math.max(0, relativeY - topRowsInsetPx);
      const rowOffset = Math.max(0, Math.min(topRows.length - 1, Math.floor(adjustedY / metrics.rowHeightPx)));
      return Math.max(0, Math.min(wrappedLines.length - 1, topStartRow + rowOffset));
    }

    if (relativeY < centerBottomPx) {
      const rowOffset = Math.max(0, Math.min(centerRows.length - 1, Math.floor((relativeY - centerTopPx) / metrics.rowHeightPx)));
      return Math.max(0, Math.min(wrappedLines.length - 1, effectiveCenterStartRow + rowOffset));
    }

    if (bottomRows.length === 0) {
      return Math.max(0, Math.min(wrappedLines.length - 1, effectiveCenterStartRow + viewport.centerRowCount - 1));
    }

    const rowOffset = Math.max(0, Math.min(bottomRows.length - 1, Math.floor((relativeY - centerBottomPx) / metrics.rowHeightPx)));
    return Math.max(0, Math.min(wrappedLines.length - 1, bottomStartRow + rowOffset));
  }, [bottomRows.length, centerRows.length, effectiveCenterStartRow, layout.centerHeightPx, layout.topHeightPx, metrics.rowHeightPx, topInsetPx, topRows.length, topRowsInsetPx, viewport.centerRowCount, wrappedLines]);

  const getCharIndexForPointer = useCallback((clientX: number, clientY: number) => {
    const editorRoot = editorRootRef.current;
    if (!editorRoot || wrappedLines.length === 0) return 0;

    const targetRowIndex = getVisibleRowIndexForPointer(clientY);
    const targetRow = wrappedLines[targetRowIndex];
    if (!targetRow) return 0;

    const rootBounds = editorRoot.getBoundingClientRect();
    const relativeX = clientX - rootBounds.left - horizontalPaddingPx;
    const targetCell = Math.max(0, Math.round(relativeX / charCellWidthPx));
    boundaryCaretRowPreferenceRef.current = targetRowIndex;
    return getCharIndexForVisualCell(targetRow, targetCell);
  }, [charCellWidthPx, getCharIndexForVisualCell, getVisibleRowIndexForPointer, horizontalPaddingPx, wrappedLines]);

  const getCenterZoneBounds = useCallback(() => {
    const editorRoot = editorRootRef.current;
    if (!editorRoot) return null;

    const bounds = editorRoot.getBoundingClientRect();
    const top = bounds.top + topInsetPx + layout.topHeightPx;
    const bottom = top + layout.centerHeightPx;
    return {
      left: bounds.left,
      right: bounds.right,
      top,
      bottom,
    };
  }, [layout.centerHeightPx, layout.topHeightPx, topInsetPx]);

  const getOutsideCenterScrollForPointer = useCallback((clientY: number) => {
    const bounds = getCenterZoneBounds();
    if (!bounds) return { direction: 0 as -1 | 0 | 1, distancePx: 0 };

    if (clientY < bounds.top) {
      return { direction: -1 as const, distancePx: bounds.top - clientY };
    }

    if (clientY > bounds.bottom) {
      return { direction: 1 as const, distancePx: clientY - bounds.bottom };
    }

    return { direction: 0 as -1 | 0 | 1, distancePx: 0 };
  }, [getCenterZoneBounds]);

  useEffect(() => {
    if (!isPointerSelecting) return;

    document.body.style.userSelect = 'none';

    const updateSelectionForPointer = (clientX: number, clientY: number) => {
      const selectionDragState = selectionDragStateRef.current;
      if (!selectionDragState) return;

      const targetPos = getCharIndexForPointer(clientX, clientY);
      const nextSelectionStart = Math.min(selectionDragState.anchorPos, targetPos);
      const nextSelectionEnd = Math.max(selectionDragState.anchorPos, targetPos);
      onSelectionChange?.(nextSelectionStart, nextSelectionEnd);
    };

    let animationFrameId = 0;
    let lastTimestamp: number | null = null;

    const step = (timestamp: number) => {
      const selectionDragState = selectionDragStateRef.current;
      if (!selectionDragState) return;

      const previousTimestamp = lastTimestamp ?? timestamp;
      lastTimestamp = timestamp;
      const elapsedSeconds = (timestamp - previousTimestamp) / 1000;

      if (selectionDragState.scrollDirection !== 0) {
        const rowsPerSecond = getAutoScrollRowsPerSecond(selectionDragState.scrollDistancePx);
        selectionDragState.fractionalRows += rowsPerSecond * elapsedSeconds;

        let wholeRows = Math.floor(selectionDragState.fractionalRows);
        if (wholeRows > 0) {
          selectionDragState.fractionalRows -= wholeRows;
          let nextViewportStartRow = latestEffectiveViewportStartRowRef.current;
          while (wholeRows > 0) {
            const candidateViewportStartRow = Math.max(0, Math.min(maxStartRef.current, nextViewportStartRow + selectionDragState.scrollDirection));
            if (candidateViewportStartRow === nextViewportStartRow) break;
            nextViewportStartRow = candidateViewportStartRow;
            wholeRows -= 1;
          }

          if (nextViewportStartRow !== latestEffectiveViewportStartRowRef.current) {
            latestEffectiveViewportStartRowRef.current = nextViewportStartRow;
            setViewportStartRow(nextViewportStartRow);
            updateSelectionForPointer(selectionDragState.clientX, selectionDragState.clientY);
          }
        }
      }

      animationFrameId = window.requestAnimationFrame(step);
    };

    animationFrameId = window.requestAnimationFrame(step);

    const finishPointerSelection = (event?: PointerEvent) => {
      const selectionDragState = selectionDragStateRef.current;
      if (event && selectionDragState && event.pointerId !== selectionDragState.pointerId) return;

      selectionDragStateRef.current = null;
      setIsPointerSelecting(false);
      centerInputRef.current?.focus();
    };

    const handlePointerMove = (event: PointerEvent) => {
      const selectionDragState = selectionDragStateRef.current;
      if (!selectionDragState || event.pointerId !== selectionDragState.pointerId) return;
      if ((event.buttons & 1) === 0) return;

      selectionDragState.clientX = event.clientX;
      selectionDragState.clientY = event.clientY;

      updateSelectionForPointer(event.clientX, event.clientY);

      const { direction, distancePx } = getOutsideCenterScrollForPointer(event.clientY);
      selectionDragState.scrollDirection = direction;
      selectionDragState.scrollDistancePx = distancePx;
      if (direction === 0) {
        selectionDragState.fractionalRows = 0;
      }
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', finishPointerSelection);
    window.addEventListener('pointercancel', finishPointerSelection);

    return () => {
      window.cancelAnimationFrame(animationFrameId);
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', finishPointerSelection);
      window.removeEventListener('pointercancel', finishPointerSelection);
      document.body.style.userSelect = '';
    };
  }, [getAutoScrollRowsPerSecond, getCharIndexForPointer, getOutsideCenterScrollForPointer, isPointerSelecting, onSelectionChange, setViewportStartRow]);

  const highlightSpans = useMemo(() => {
    const highlights: IndentHighlight[] = [];
    const appendZoneHighlights = (
      rows: WrappedLine[],
      zoneTopPx: number,
      zoneStartRow: number,
      insetTopPx = 0
    ) => {
      rows.forEach((row, rowIndex) => {
        const rowText = text.slice(row.startCharIndex, row.endCharIndex);
        const rowTopBoundaryPx = snapToDevicePixels(zoneTopPx + insetTopPx + (rowIndex * metrics.rowHeightPx));
        const rowBottomBoundaryPx = snapToDevicePixels(rowTopBoundaryPx + metrics.rowHeightPx);
        const interiorTopPx = Math.min(
          rowBottomBoundaryPx,
          rowTopBoundaryPx + GRID_STROKE_WIDTH_PX
        );
        const occupiedCells = new Map<number, CellHighlightKind>();
        const rowCellCount = countVisualCells(rowText);
        const visibleRowIndex = zoneStartRow + rowIndex;
        const normalizedSelectionStart = Math.min(selectionStart, selectionEnd);
        const normalizedSelectionEnd = Math.max(selectionStart, selectionEnd);
        const rowSelectionStart = Math.max(row.startCharIndex, normalizedSelectionStart);
        const rowSelectionEnd = Math.min(row.endCharIndex, normalizedSelectionEnd);

        if (rowSelectionEnd > rowSelectionStart) {
          const selectionStartCell = countVisualCells(text.slice(row.startCharIndex, rowSelectionStart));
          const selectionEndCell = countVisualCells(text.slice(row.startCharIndex, rowSelectionEnd));
          for (let cellIndex = selectionStartCell; cellIndex < selectionEndCell; cellIndex += 1) {
            occupiedCells.set(cellIndex, 'selection');
          }
        }

        if (selectionStart === selectionEnd && visibleRowIndex === caretRow) {
          // Caret cell is now positioned via native rect in the caretOverlayRef useLayoutEffect.
          // Keep the occupiedCells entry only so leading/trailing whitespace highlights don't
          // overlap the caret column in the center zone; but don't emit a 'caret' highlight.
        }

        if (row.isLineStart) {
          const leadingCellCount = countLeadingWhitespaceCells(rowText);
          for (let cellIndex = 0; cellIndex < leadingCellCount; cellIndex += 1) {
            if (!occupiedCells.has(cellIndex)) {
              occupiedCells.set(cellIndex, 'leading');
            }
          }
        }

        if (row.isLineEnd) {
          const trailingCellCount = countTrailingWhitespaceCells(rowText);
          const trailingStartCell = Math.max(0, rowCellCount - trailingCellCount);
          for (let cellIndex = trailingStartCell; cellIndex < rowCellCount; cellIndex += 1) {
            if (!occupiedCells.has(cellIndex)) {
              occupiedCells.set(cellIndex, 'trailing');
            }
          }
        }

        const orderedCells = [...occupiedCells.entries()].sort((left, right) => left[0] - right[0]);
        orderedCells.forEach(([cellIndex, kind]) => {
          const cellLeftBoundaryPx = snapToDevicePixels(horizontalPaddingPx + (cellIndex * charCellWidthPx));
          const cellRightBoundaryPx = snapToDevicePixels(horizontalPaddingPx + ((cellIndex + 1) * charCellWidthPx));
          const interiorLeftPx = Math.min(cellRightBoundaryPx, cellLeftBoundaryPx + GRID_STROKE_WIDTH_PX);
          const interiorRightPx = Math.max(interiorLeftPx, cellRightBoundaryPx - GRID_STROKE_WIDTH_PX);
          const interiorBottomPx = Math.max(interiorTopPx, rowBottomBoundaryPx - GRID_STROKE_WIDTH_PX);
          highlights.push({
            kind,
            topPx: interiorTopPx,
            leftPx: interiorLeftPx,
            widthPx: Math.max(0, interiorRightPx - interiorLeftPx),
            heightPx: Math.max(0, interiorBottomPx - interiorTopPx),
          });
        });
      });
    };

    appendZoneHighlights(topRows, 0, centerStartRow - topRows.length, topRowsInsetPx);
    appendZoneHighlights(centerRows, layout.topHeightPx, centerStartRow);
    appendZoneHighlights(bottomRows, layout.topHeightPx + layout.centerHeightPx, centerStartRow + centerRows.length);

    return highlights;
  }, [
    caretPos,
    caretRow,
    selectionStart,
    selectionEnd,
    centerRows,
    centerStartRow,
    charCellWidthPx,
    horizontalPaddingPx,
    layout.centerHeightPx,
    layout.topHeightPx,
    metrics.rowHeightPx,
    text,
    topRows,
    topRowsInsetPx,
    bottomRows,
  ]);

  return (
    <div
      ref={editorRootRef}
      className="fixed-focus-editor"
      style={{
        position: 'relative',
        fontFamily,
        fontSize: `${fontSizePx}px`,
        overflow: 'hidden',
        '--grid-column-width': `${charCellWidthPx}px`,
      } as React.CSSProperties}
    >
      <div
        className="fixed-focus-editor-content"
        style={{
          position: 'absolute',
          top: `${topInsetPx}px`,
          left: 0,
          right: 0,
          height: `${drawableHeightPx}px`,
        }}
      >
        <div
          className="fixed-focus-box-background-overlay"
          aria-hidden
          style={{
            '--grid-horizontal-padding': `${horizontalPaddingPx}px`,
            '--grid-quantized-width': `${quantizedGridWidthPx}px`,
            '--grid-background-width': `${quantizedBackgroundWidthPx}px`,
            '--grid-top-height': `${layout.topHeightPx}px`,
            '--grid-center-top': `${layout.topHeightPx}px`,
            '--grid-center-height': `${layout.centerHeightPx}px`,
            '--grid-bottom-top': `${layout.topHeightPx + layout.centerHeightPx}px`,
            '--grid-bottom-height': `${layout.bottomHeightPx}px`,
            '--grid-center-background': highlightColors?.background,
            '--grid-top-background': highlightColors?.topBackground,
            '--grid-bottom-background': highlightColors?.bottomBackground,
          } as React.CSSProperties}
        >
          {layout.topHeightPx > 0 && <div className="box-background box-background--top" />}
          {layout.centerHeightPx > 0 && <div className="box-background box-background--center" />}
          {layout.bottomHeightPx > 0 && <div className="box-background box-background--bottom" />}
        </div>

        <div
          className="fixed-focus-grid-overlay"
          aria-hidden
          style={{
            '--grid-row-height': `${metrics.rowHeightPx}px`,
            '--grid-column-width': `${charCellWidthPx}px`,
            '--grid-horizontal-padding': `${horizontalPaddingPx}px`,
            '--grid-quantized-width': `${quantizedGridWidthPx}px`,
            '--grid-quantized-height': `${quantizedGridHeightPx}px`,
            '--grid-line-color': highlightColors?.grid,
          } as React.CSSProperties}
        />

        <div
          ref={scrollIndicatorRef}
          className={`fixed-focus-scroll-indicator${isScrollIndicatorDragging ? ' is-dragging' : ''}`}
          aria-label="Scroll indicator"
          role="scrollbar"
          aria-orientation="vertical"
          aria-valuemin={0}
          aria-valuemax={Math.max(0, maxStart)}
          aria-valuenow={effectiveCenterStartRow}
          onPointerDown={handleScrollIndicatorPointerDown}
          style={{
            '--grid-row-height': `${metrics.rowHeightPx}px`,
            '--grid-column-width': `${charCellWidthPx}px`,
            '--grid-horizontal-padding': `${horizontalPaddingPx}px`,
            '--grid-quantized-width': `${quantizedGridWidthPx}px`,
            '--grid-line-color': highlightColors?.grid,
            '--scroll-indicator-active-bg': highlightColors?.caret,
            '--scroll-indicator-inactive-bg': highlightColors?.background,
            '--scroll-indicator-height': `${indicatorHeightPx}px`,
            '--scroll-top-height': `${topIndicatorRowCount * metrics.rowHeightPx}px`,
            '--scroll-middle-top': `${topIndicatorRowCount * metrics.rowHeightPx}px`,
            '--scroll-middle-height': `${middleIndicatorRowCount * metrics.rowHeightPx}px`,
            '--scroll-bottom-top': `${(topIndicatorRowCount + middleIndicatorRowCount) * metrics.rowHeightPx}px`,
            '--scroll-bottom-height': `${bottomIndicatorRowCount * metrics.rowHeightPx}px`,
          } as React.CSSProperties}
        >
          {topIndicatorRowCount > 0 && <div className="scroll-indicator-section scroll-indicator-section--top" />}
          {middleIndicatorRowCount > 0 && <div className="scroll-indicator-section scroll-indicator-section--middle" />}
          {bottomIndicatorRowCount > 0 && <div className="scroll-indicator-section scroll-indicator-section--bottom" />}
          <div className="scroll-indicator-grid" />
        </div>

        <div
          className="fixed-focus-cell-overlay"
          aria-hidden
          style={{
            '--grid-row-height': `${metrics.rowHeightPx}px`,
            '--grid-column-width': `${charCellWidthPx}px`,
            '--highlight-caret-bg': highlightColors?.caret,
            '--highlight-selection-bg': highlightColors?.selection,
            '--highlight-leading-bg': highlightColors?.leading,
            '--highlight-trailing-bg': highlightColors?.trailing,
          } as React.CSSProperties}
        >
          {highlightSpans.map((highlight, index) => (
            <div
              key={`${highlight.topPx}-${highlight.leftPx}-${highlight.widthPx}-${index}`}
              className={`cell-highlight cell-highlight--${highlight.kind}`}
              style={{
                top: `${highlight.topPx}px`,
                left: `${highlight.leftPx}px`,
                width: `${highlight.widthPx}px`,
                height: `${highlight.heightPx}px`,
              }}
            />
          ))}
          {/* Native-caret overlay: position is set imperatively in useLayoutEffect */}
          <div
            ref={caretOverlayRef}
            className={`cell-highlight cell-highlight--caret${isCaretAnimationPaused ? ' cell-highlight--caret-paused' : ''}`}
            style={{ display: 'none', position: 'absolute' }}
          />
        </div>

        {/* Top Zone (display-only) */}
        {layout.topHeightPx > 0 && (
          <div
            className="zone zone-top"
            style={{
              height: `${layout.topHeightPx}px`,
              overflow: 'hidden',
            }}
            onPointerDown={handlePassiveZonePointerDown(
              'top',
              topRows,
              Math.max(0, effectiveCenterStartRow - topRows.length),
              topRowsInsetPx
            )}
          >
            <MirroredTextLayer
              text={text}
              metrics={metrics}
              totalWrappedRowCount={wrappedLines.length}
              visibleHeightPx={layout.topHeightPx}
              startRow={Math.max(0, effectiveCenterStartRow - topRows.length)}
              insetTopPx={topRowsInsetPx}
              horizontalPaddingPx={horizontalPaddingPx}
              rightPaddingPx={textareaRightPaddingPx}
              textareaClassName={textareaClassName}
              textareaStyle={textareaStyle}
            />
          </div>
        )}

        {/* Center Zone (editable contenteditable, no scroll) */}
        <div
          className="zone zone-center"
          style={{
            height: `${layout.centerHeightPx}px`,
            position: 'relative',
            overflow: 'hidden',
          }}
        >
          <div
            ref={centerInputRef}
            contentEditable="plaintext-only"
            suppressContentEditableWarning
            className={textareaClassName ? `zone-textarea ${textareaClassName}` : 'zone-textarea'}
            onInput={handleInput}
            onSelect={handleSelect}
            onPointerDown={handleCenterPointerDown}
            onKeyDown={handleKeyDown}
            onKeyUp={onKeyUp}
            onCopy={onCopy}
            onPaste={onPaste}
            onCompositionStart={onCompositionStart}
            onCompositionEnd={onCompositionEnd}
            data-placeholder={placeholder}
            style={{
              position: 'absolute',
              top: `${textareaTopPx}px`,
              left: 0,
              width: '100%',
              height: `${textareaHeightPx}px`,
              fontSize: `${fontSizePx}px`,
              lineHeight: `${metrics.rowHeightPx}px`,
              padding: `0 ${textareaRightPaddingPx}px 0 ${horizontalPaddingPx}px`,
              margin: 0,
              border: 'none',
              resize: 'none',
              outline: 'none',
              fontFamily: 'inherit',
              fontKerning: 'none',
              fontVariantLigatures: 'none',
              fontFeatureSettings: '"liga" 0, "calt" 0',
              letterSpacing: '0',
              boxSizing: 'border-box',
              overflow: 'hidden',
              whiteSpace: 'pre-wrap',
              wordWrap: 'break-word',
              tabSize: 3,
              caretColor: 'transparent',
              ...textareaStyle,
            }}
          />
        </div>

        {/* Bottom Zone (display-only) */}
        {layout.bottomHeightPx > 0 && (
          <div
            className="zone zone-bottom"
            style={{
              height: `${layout.bottomHeightPx}px`,
              overflow: 'hidden',
            }}
            onPointerDown={handlePassiveZonePointerDown(
              'bottom',
              bottomRows,
              effectiveCenterStartRow + viewport.centerRowCount,
              0
            )}
          >
            <MirroredTextLayer
              text={text}
              metrics={metrics}
              totalWrappedRowCount={wrappedLines.length}
              visibleHeightPx={layout.bottomHeightPx}
              startRow={effectiveCenterStartRow + viewport.centerRowCount}
              insetTopPx={0}
              horizontalPaddingPx={horizontalPaddingPx}
              rightPaddingPx={textareaRightPaddingPx}
              textareaClassName={textareaClassName}
              textareaStyle={textareaStyle}
            />
          </div>
        )}
      </div>

      <div
        className={`zone-divider zone-divider-top${activeResizeHandle === 'top' ? ' is-active' : ''}`}
        style={{ top: `${topDividerTopPx}px` }}
        onPointerDown={startResize('top')}
      />

      <div
        className={`zone-divider zone-divider-bottom${activeResizeHandle === 'bottom' ? ' is-active' : ''}`}
        style={{ top: `${bottomDividerTopPx}px` }}
        onPointerDown={startResize('bottom')}
      />
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────

interface MirroredTextLayerProps {
  text: string;
  metrics: ComputedMetrics;
  totalWrappedRowCount: number;
  visibleHeightPx: number;
  startRow: number;
  insetTopPx?: number;
  horizontalPaddingPx?: number;
  rightPaddingPx?: number;
  textareaClassName?: string;
  textareaStyle?: React.CSSProperties;
}

const MirroredTextLayer: React.FC<MirroredTextLayerProps> = ({
  text,
  metrics,
  totalWrappedRowCount,
  visibleHeightPx,
  startRow,
  insetTopPx = 0,
  rightPaddingPx = 20,
  horizontalPaddingPx = 20,
  textareaClassName,
  textareaStyle,
}) => (
  <div
    style={{
      height: '100%',
      position: 'relative',
      overflow: 'hidden',
      boxSizing: 'border-box',
    }}
  >
    <textarea
      aria-hidden
      readOnly
      tabIndex={-1}
      className={textareaClassName ? `zone-textarea ${textareaClassName}` : 'zone-textarea'}
      value={text}
      style={{
        position: 'absolute',
        top: `${insetTopPx - (startRow * metrics.rowHeightPx)}px`,
        left: 0,
        width: '100%',
        height: `${Math.max(visibleHeightPx, totalWrappedRowCount * metrics.rowHeightPx)}px`,
        fontSize: 'inherit',
        lineHeight: `${metrics.rowHeightPx}px`,
        padding: `0 ${rightPaddingPx}px 0 ${horizontalPaddingPx}px`,
        margin: 0,
        border: 'none',
        resize: 'none',
        outline: 'none',
        fontFamily: 'inherit',
        fontKerning: 'none',
        fontVariantLigatures: 'none',
        fontFeatureSettings: '"liga" 0, "calt" 0',
        letterSpacing: '0',
        boxSizing: 'border-box',
        overflow: 'hidden',
        whiteSpace: 'pre-wrap',
        wordWrap: 'break-word',
        tabSize: 3,
        pointerEvents: 'none',
        userSelect: 'none',
        ...textareaStyle,
      }}
    />
  </div>
);

export default FixedFocusEditor;

function computeTopInsetPx(spacingPreset: string): number {
  return 15;
}

function measureMonospaceCellWidthPx(fontSizePx: number, fontFamily: string): number {
  const cacheKey = `${fontSizePx}px|${fontFamily}`;
  const cached = charWidthCache.get(cacheKey);
  if (cached !== undefined) return cached;

  if (typeof document === 'undefined') {
    const fallback = Math.max(1, fontSizePx * 0.6);
    charWidthCache.set(cacheKey, fallback);
    return fallback;
  }

  const measurementElement = document.createElement('span');
  const sampleText = '0'.repeat(4096);
  measurementElement.textContent = sampleText;
  measurementElement.style.position = 'absolute';
  measurementElement.style.visibility = 'hidden';
  measurementElement.style.pointerEvents = 'none';
  measurementElement.style.whiteSpace = 'pre';
  measurementElement.style.fontFamily = fontFamily;
  measurementElement.style.fontSize = `${fontSizePx}px`;
  measurementElement.style.fontKerning = 'none';
  measurementElement.style.fontVariantLigatures = 'none';
  measurementElement.style.fontFeatureSettings = '"liga" 0, "calt" 0';
  measurementElement.style.letterSpacing = '0';
  measurementElement.style.padding = '0';
  measurementElement.style.margin = '0';
  measurementElement.style.border = '0';
  measurementElement.style.top = '-9999px';
  measurementElement.style.left = '0';
  document.body.appendChild(measurementElement);
  const width = measurementElement.getBoundingClientRect().width / sampleText.length;
  measurementElement.remove();

  const measured = Math.max(1, width);
  charWidthCache.set(cacheKey, measured);
  return measured;
}

function countLeadingWhitespaceCells(text: string): number {
  let indentCellCount = 0;
  for (const char of text) {
    if (char === ' ') {
      indentCellCount += 1;
      continue;
    }
    if (char === '\t') {
      indentCellCount += 3;
      continue;
    }
    break;
  }
  return indentCellCount;
}

function countTrailingWhitespaceCells(text: string): number {
  let trailingCellCount = 0;
  for (let index = text.length - 1; index >= 0; index -= 1) {
    const char = text[index];
    if (char === ' ') {
      trailingCellCount += 1;
      continue;
    }
    if (char === '\t') {
      trailingCellCount += 3;
      continue;
    }
    break;
  }
  return trailingCellCount;
}

function countVisualCells(text: string): number {
  let cellCount = 0;
  for (const char of text) {
    if (char === '\t') {
      cellCount += 3;
    } else {
      cellCount += 1;
    }
  }
  return cellCount;
}

function getCharIndexForVisualCellInRow(row: WrappedLine, text: string, targetCell: number): number {
  const rowText = text.slice(row.startCharIndex, row.endCharIndex);
  const clampedTargetCell = Math.max(0, targetCell);
  let traversedCellCount = 0;

  for (let charIndex = 0; charIndex < rowText.length; charIndex += 1) {
    if (traversedCellCount >= clampedTargetCell) {
      return row.startCharIndex + charIndex;
    }

    const char = rowText[charIndex];
    traversedCellCount += char === '\t' ? 3 : 1;
  }

  return row.endCharIndex;
}

function getVisualColumnForCaretPosition(charIndex: number, wrappedLines: WrappedLine[], text: string): number {
  if (wrappedLines.length === 0) return 0;

  const row = wrappedLines[findRowForCharIndex(charIndex, wrappedLines)];
  if (!row) return 0;

  const clampedCharIndex = Math.max(row.startCharIndex, Math.min(charIndex, row.endCharIndex));
  return countVisualCells(text.slice(row.startCharIndex, clampedCharIndex));
}

function resolveRowForCaretIndex(
  charIndex: number,
  wrappedLines: WrappedLine[],
  preferredBoundaryRow: number | null
): number {
  const baseRow = findRowForCharIndex(charIndex, wrappedLines);
  if (wrappedLines.length === 0) return 0;

  const row = wrappedLines[baseRow];
  const nextRow = wrappedLines[baseRow + 1];
  const isSharedBoundary = Boolean(
    row &&
    nextRow &&
    row.endCharIndex === charIndex &&
    nextRow.startCharIndex === charIndex
  );

  if (!isSharedBoundary) {
    return baseRow;
  }

  // No explicit preference: use the downstream row (start of the next visual
  // line), which is what the browser always renders for a textarea boundary
  // caret regardless of how the cursor arrived there.
  if (preferredBoundaryRow == null) {
    return Math.min(baseRow + 1, wrappedLines.length - 1);
  }

  if (preferredBoundaryRow === baseRow || preferredBoundaryRow === baseRow + 1) {
    return preferredBoundaryRow;
  }

  return baseRow;
}

function snapToDevicePixels(valuePx: number): number {
  if (typeof window === 'undefined') return valuePx;
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  return Math.round(valuePx * dpr) / dpr;
}

/**
 * Returns the grid cell { gridRow, gridColumn } that the caret currently
 * occupies, where gridRow is the absolute wrapped-row index and gridColumn is
 * the 0-based visual cell index within that row (tabs count as 3 cells).
 *
 * Pass preferredBoundaryRow to resolve shared wrap-boundary indices the same
 * way the rest of the editor does (via resolveRowForCaretIndex).
 */
export function getCaretGridCell(
  caretPos: number,
  wrappedLines: WrappedLine[],
  text: string,
  preferredBoundaryRow?: number | null
): { gridRow: number; gridColumn: number } {
  if (wrappedLines.length === 0) return { gridRow: 0, gridColumn: 0 };
  const gridRow = preferredBoundaryRow !== undefined
    ? resolveRowForCaretIndex(caretPos, wrappedLines, preferredBoundaryRow ?? null)
    : findRowForCharIndex(caretPos, wrappedLines);
  const row = wrappedLines[gridRow];
  const gridColumn = row
    ? countVisualCells(text.slice(row.startCharIndex, Math.min(caretPos, row.endCharIndex)))
    : 0;
  return { gridRow, gridColumn };
}

