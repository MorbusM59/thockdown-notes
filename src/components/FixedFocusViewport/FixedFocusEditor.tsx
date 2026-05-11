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
import { Timeline } from '../Timeline';

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
    // Special-case direct BR selection because some browsers report the caret
    // inside the <br> node rather than at its parent container offset.
    if ((node as Element).tagName === 'BR') {
      if (isManagedSentinelBr(node)) return charCount;
      return offsetInNode === 0 ? charCount : charCount + 1;
    }

    // Element node: offsetInNode is a child index.  Stop counting when we reach
    // children[offsetInNode]; if it's past the last child, consume everything.
    const stopAt: Node | null = offsetInNode < node.childNodes.length
      ? node.childNodes[offsetInNode]
      : null;
    while (current !== null) {
      if (current === stopAt) return charCount;
      if (current.nodeType === Node.TEXT_NODE) charCount += (current as Text).length;
      else if ((current as Element).tagName === 'BR') {
        if (!isManagedSentinelBr(current)) charCount += 1;
      }
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
      if (!isManagedSentinelBr(current)) charCount += 1;
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
  // If the element isn't connected to the document yet, the TreeWalker nodes won't be
  // part of the document either, and addRange() will emit a console warning.  Bail early.
  if (!el.isConnected) return;
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
      if (!isManagedSentinelBr(node)) {
        charCount += 1;
      }
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

function isManagedSentinelBr(node: Node): boolean {
  return node.nodeType === Node.ELEMENT_NODE
    && (node as Element).tagName === 'BR'
    && ((node as HTMLElement).dataset['managedLineBreakSentinel'] === '1');
}

function ceSetText(el: HTMLElement, text: string): void {
  el.textContent = '';
  if (text.length === 0) {
    const sentinel = document.createElement('br');
    sentinel.dataset['managedLineBreakSentinel'] = '1';
    el.appendChild(sentinel);
    return;
  }

  const lines = text.split('\n');
  lines.forEach((line, i) => {
    if (line.length > 0) {
      el.appendChild(document.createTextNode(line));
    }
    if (i < lines.length - 1) {
      const br = document.createElement('br');
      br.dataset['managedLineBreak'] = '1';
      el.appendChild(br);
    }
  });

  if (text.endsWith('\n')) {
    const sentinel = document.createElement('br');
    sentinel.dataset['managedLineBreakSentinel'] = '1';
    el.appendChild(sentinel);
  }
}

/**
 * Reads the text content of a contenteditable element, treating <br> as \n.
 * Ignores the managed sentinel <br> appended for an empty trailing line.
 */
export function ceGetText(el: HTMLElement): string {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_ALL, null);
  let result = '';
  let node: Node | null = walker.nextNode();
  while (node) {
    if (node.nodeType === Node.TEXT_NODE) {
      result += (node as Text).data;
    } else if ((node as Element).tagName === 'BR') {
      if (isManagedSentinelBr(node)) {
        node = walker.nextNode();
        continue;
      }
      result += '\n';
    }
    node = walker.nextNode();
  }
  return result;
}

function normalizeEditableDom(el: HTMLElement, text: string, selection: { start: number; end: number } | null): void {
  let hasEmptyTextNodes = false;
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_ALL, null);
  let node: Node | null = walker.nextNode();
  while (node) {
    if (node.nodeType === Node.TEXT_NODE && (node as Text).data.length === 0) {
      hasEmptyTextNodes = true;
      break;
    }
    node = walker.nextNode();
  }

  if (!hasEmptyTextNodes) return;

  ceSetText(el, text);
  if (selection) {
    ceSetSelection(el, selection.start, selection.end);
  }

}

/**
 * Get a client rect for the current caret (collapsed selection) inside `el`.
 * Returns a DOMRect in viewport coordinates or null.
 * Uses Range.getClientRects() when available, falls back to inserting a
 * temporary zero-width marker and measuring it. Avoids mutating selection by
 * restoring selection offsets via `ceGetSelection`/`ceSetSelection` when used.
 */
function getCaretClientRectSafe(el: HTMLElement): DOMRect | null {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return null;
  const range = sel.getRangeAt(0);
  if (!el.contains(range.commonAncestorContainer)) return null;

  // Prefer client rects if available
  const rects = range.getClientRects();
  if (rects && rects.length > 0) {
    // Collapsed ranges often return a zero-width rect in rects[0]
    return rects[0];
  }

  // Try boundingClientRect as a secondary option
  const br = range.getBoundingClientRect();
  if (br && (br.width > 0 || br.height > 0)) return br;

  // Last resort: insert a temporary marker, measure, then remove and restore selection
  try {
    const savedSel = ceGetSelection(el);
    const marker = document.createElement('span');
    marker.style.display = 'inline-block';
    marker.style.width = '0px';
    marker.style.height = '0px';
    marker.style.overflow = 'hidden';
    // Insert marker at the range
    range.insertNode(marker);
    const mrect = marker.getBoundingClientRect();
    marker.parentNode?.removeChild(marker);
    if (savedSel) ceSetSelection(el, savedSel.start, savedSel.end);
    return mrect.width === 0 && mrect.height === 0 ? null : mrect;
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────

const charWidthCache = new Map<string, number>();
const VIEWPORT_JUMP_ANIMATION_DURATION_MS = 400;
const VIEWPORT_JUMP_MAX_STEP_MS = 100;
const VIEWPORT_JUMP_CURVE_EXPONENT = 1;
const VIEWPORT_JUMP_CURVE_EXPONENT_DISTANCE_FACTOR = 0.002;
const VIEWPORT_JUMP_CURVE_EXPONENT_MAX = 1.5;
const VIEWPORT_JUMP_STEP_DURATION_OFFSET_MS = 0.05;
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

// Highlight overlay removed — rely on native selection and visual grid.

interface HighlightColors {
  caret: string;
  selection: string;
  leading: string;
  trailing: string;
  grid: string;
  background: string;
  topBackground: string;
  bottomBackground: string;
  scrollbarBackground: string;
  scrollbarHandle: string;
  timelineBackground: string;
  timelineActive: string;
  timelineManual: string;
  timelineAutomatic: string;
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
  leftPaddingPx?: number;
  rightPaddingPx?: number;
  topPaddingPx?: number;
  bottomPaddingPx?: number;
  topRowCount?: number;
  bottomRowCount?: number;
  minCenterRowCount?: number;
  containerWidthPx?: number;
  containerHeightPx?: number;
  viewportStartRow?: number;
  onViewportStartRowChange?: (nextViewportStartRow: number) => void;
  onViewportTopSourceLineChange?: (lineIndex: number) => void;
  onTopRowCountChange?: (nextTopRowCount: number) => void;
  onBottomRowCountChange?: (nextBottomRowCount: number) => void;
  onTextChange: (newText: string, newSelectionStart: number, newSelectionEnd: number) => void;
  onCaretChange?: (newCaretPos: number) => void;
  onSelectionChange?: (selectionStart: number, selectionEnd: number) => void;
  textareaRef?: React.MutableRefObject<HTMLDivElement | null>;
  textareaClassName?: string;
  textareaStyle?: React.CSSProperties;
  showLineBreaks?: boolean;
  /** Optional ref for exposing editor programmatic API (applyProgrammaticEdit) */
  editorApiRef?: React.MutableRefObject<any>;
  placeholder?: string;
  onKeyDown?: (e: React.KeyboardEvent<HTMLDivElement>) => void;
  onKeyUp?: (e: React.KeyboardEvent<HTMLDivElement>) => void;
  onCopy?: (e: React.ClipboardEvent<HTMLDivElement>) => void;
  onPaste?: (e: React.ClipboardEvent<HTMLDivElement>) => void;
  onCompositionStart?: React.CompositionEventHandler<HTMLDivElement>;
  onCompositionEnd?: React.CompositionEventHandler<HTMLDivElement>;
  /** Called whenever the total wrapped row count changes (e.g. text reflows). */
  onTotalWrappedRowCountChange?: (count: number) => void;
  timelineProps?: any;
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
  leftPaddingPx = 10,
  rightPaddingPx = 5,
  topPaddingPx = 10,
  bottomPaddingPx = 10,
  topRowCount,
  bottomRowCount,
  minCenterRowCount = 1,
  containerWidthPx = 500,
  containerHeightPx = 400,
  viewportStartRow,
  onViewportStartRowChange,
  onViewportTopSourceLineChange,
  onTopRowCountChange,
  onBottomRowCountChange,
  onTextChange,
  onCaretChange,
  onSelectionChange,
  textareaRef,
  editorApiRef,
  textareaClassName,
  textareaStyle,
  showLineBreaks = false,
  placeholder,
  onKeyDown,
  onKeyUp,
  onCopy,
  onPaste,
  onCompositionStart,
  onCompositionEnd,
  onTotalWrappedRowCountChange,
  timelineProps,
}) => {
  const [uncontrolledViewportStartRow, setUncontrolledViewportStartRow] = useState(0);
  const [uncontrolledTopRowCount, setUncontrolledTopRowCount] = useState(topRowCount ?? 3);
  const [uncontrolledBottomRowCount, setUncontrolledBottomRowCount] = useState(bottomRowCount ?? 3);
  const [activeResizeHandle, setActiveResizeHandle] = useState<'top' | 'bottom' | null>(null);
  const [isScrollIndicatorDragging, setIsScrollIndicatorDragging] = useState(false);
  const [isPointerSelecting, setIsPointerSelecting] = useState(false);
  const [isViewportAnimating, setIsViewportAnimating] = useState(false);
  const [resizeAnchorViewportStartRow, setResizeAnchorViewportStartRow] = useState<number | null>(null);
  const [isFocused, setIsFocused] = useState(false);
  const editorRootRef = useRef<HTMLDivElement>(null);
  // canvas POC removed; using DOM overlay caret instead
  const caretOverlayRef = useRef<HTMLDivElement | null>(null);
  const scrollIndicatorRef = useRef<HTMLDivElement>(null);
  const centerInputRef = useRef<HTMLDivElement>(null);
  
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
    lastTimestamp: number | null;
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
  
  const centerStartRow = viewportStartRow ?? uncontrolledViewportStartRow;
  const resolvedTopRowCount = topRowCount ?? uncontrolledTopRowCount;
  const resolvedBottomRowCount = bottomRowCount ?? uncontrolledBottomRowCount;
  const contentWidthPx = Math.max(1, containerWidthPx - (leftPaddingPx + rightPaddingPx));
  const topInsetPx = Math.max(0, topPaddingPx);

  const [fontsLoadedInc, setFontsLoadedInc] = useState(0);
  useEffect(() => {
    if (typeof document !== 'undefined' && 'fonts' in document) {
      document.fonts.ready.then(() => {
        charWidthCache.clear();
        setFontsLoadedInc(c => c + 1);
      });
    }
  }, [fontFamily]);

  const charCellWidthPx = useMemo(
    () => measureMonospaceCellWidthPx(fontSizePx, fontFamily),
    [fontFamily, fontSizePx, fontsLoadedInc]
  );

  const effectiveBottomPaddingPx = timelineProps 
    ? 5 + (charCellWidthPx * 2) 
    : Math.max(0, bottomPaddingPx);

  const drawableHeightPx = Math.max(1, containerHeightPx - topInsetPx - effectiveBottomPaddingPx);

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

  useEffect(() => {
    if (!editorApiRef) return;
    editorApiRef.current = {
      applyProgrammaticEdit: (edit: { start: number; deleteLen: number; insertText: string }) => {
        const el = centerInputRef.current;
        if (!el) return null;
        try { el.focus(); } catch {}

        const start = Math.max(0, Math.floor(edit.start ?? 0));
        const deleteLen = Math.max(0, Math.floor(edit.deleteLen ?? 0));
        const end = start + deleteLen;

        try {
          // Set selection to target range
          ceSetSelection(el, start, end);
          // Use execCommand to insert text so browser undo integrates
          const success = document.execCommand('insertText', false, edit.insertText ?? '');
          if (!success) {
            // Fallback to DOM Range replacement
            const sel = window.getSelection();
            if (sel && sel.rangeCount > 0) {
              const range = sel.getRangeAt(0);
              range.deleteContents();
              range.insertNode(document.createTextNode(edit.insertText ?? ''));
              range.collapse(false);
              sel.removeAllRanges();
              sel.addRange(range);
            }
          }
        } catch (err) {
          // Fallback: apply text by rebuilding DOM (rare)
          const currentText = ceGetText(el);
          const newText = currentText.substring(0, start) + (edit.insertText ?? '') + currentText.substring(end);
          ceSetText(el, newText);
          ceSetSelection(el, start + (edit.insertText ?? '').length, start + (edit.insertText ?? '').length);
        }

        const newText = ceGetText(el);
        const sel = ceGetSelection(el) ?? { start: 0, end: 0 };
        onTextChange(newText, sel.start, sel.end);
        return { newText, selectionStart: sel.start, selectionEnd: sel.end };
      },
    };

    return () => { if (editorApiRef) editorApiRef.current = null; };
  }, [editorApiRef, onTextChange]);

  // Sync external text-prop changes into the contenteditable DOM.
  // When the user types, ceGetText(el) === text and this is a no-op.
  // When undo/redo/programmatic changes arrive, we rebuild the DOM.
  useLayoutEffect(() => {
    const el = centerInputRef.current;
    if (!el) return;
    if (ceGetText(el) !== text) {
      const savedSel = ceGetSelection(el);
      ceSetText(el, text);
      if (savedSel && isFocused) {
        ceSetSelection(el, savedSel.start, savedSel.end);
      }
    }
  }, [text]);

  // No custom caret animation required when using native caret.

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
  const reservedVisualOnlyColumns = 1;
  const textColumnCount = Math.max(1, gridColumnCount - reservedVisualOnlyColumns);
  const wrapWidthPx = Math.max(1, textColumnCount * charCellWidthPx);
  const textareaRightPaddingPx = Math.max(
    rightPaddingPx,
    containerWidthPx - leftPaddingPx - wrapWidthPx
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
  const maxViewportStartRow = maxStart; // Do not allow scrolling past the center zone bound
  const clampedCenterStartRow = Math.max(0, Math.min(centerStartRow, maxViewportStartRow));
  const effectiveCenterStartRow = activeResizeHandle && resizeAnchorViewportStartRow != null
    ? Math.max(0, Math.min(resizeAnchorViewportStartRow, maxViewportStartRow))
    : clampedCenterStartRow;

  useEffect(() => {
    if (onViewportTopSourceLineChange && wrappedLines.length > 0) {
      const topRow = wrappedLines[effectiveCenterStartRow];
      if (topRow) {
        onViewportTopSourceLineChange(topRow.logicalLineIndex);
      }
    }
  }, [effectiveCenterStartRow, wrappedLines, onViewportTopSourceLineChange]);

  model.setViewportStartRow(effectiveCenterStartRow);

  const metrics = model.getMetrics();
  const layout = model.getLayout();
  const viewport = model.getViewport();
  const topRows = model.getTopZoneRows();
  const centerRows = model.getCenterZoneRows();
  const bottomRows = model.getBottomZoneRows();
  const lineBreakMarkers = useMemo(() => {
    if (!showLineBreaks) return [] as Array<{ topPx: number; leftPx: number }>;
    const markers: Array<{ topPx: number; leftPx: number }> = [];
    const visibleStart = effectiveCenterStartRow;
    for (let charIndex = 0; charIndex < text.length; charIndex += 1) {
      if (text[charIndex] !== '\n') continue;
      const rowIndex = findRowForCharIndex(charIndex, wrappedLines);
      const row = wrappedLines[rowIndex];
      if (!row) continue;
      const rowText = text.slice(row.startCharIndex, Math.min(charIndex, row.endCharIndex));
      const leftPx = leftPaddingPx + (countVisualCells(rowText) * charCellWidthPx);
      markers.push({
        topPx: (rowIndex - visibleStart) * metrics.rowHeightPx,
        leftPx,
      });
    }
    return markers;
  }, [showLineBreaks, wrappedLines, text, effectiveCenterStartRow, leftPaddingPx, charCellWidthPx, metrics.rowHeightPx]);
  const gridRowCount = Math.max(0, Math.floor(drawableHeightPx / metrics.rowHeightPx));
  const quantizedGridWidthPx = gridColumnCount * charCellWidthPx;
  const timelineWidthPx = totalColumnCount * charCellWidthPx;
  const quantizedBackgroundWidthPx = Math.floor(Math.max(0, quantizedGridWidthPx - charCellWidthPx));
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
    
    const minSpeed = 0.5;
    const maxSpeed = 60;
    const maxDistance = 200;
    
    if (distancePx >= maxDistance) return maxSpeed;
    
    // Calculate normalized progress (0 to 1) and apply an exponential curve for a smooth ramp-up
    const t = distancePx / maxDistance;
    return minSpeed + (maxSpeed - minSpeed) * Math.pow(t, 1.8);
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

  // Report total wrapped row count to parent when it changes (used by MarkdownEditor
  // to sync view-mode scroll position when toggling preview).
  useEffect(() => {
    onTotalWrappedRowCountChange?.(wrappedLines.length);
  }, [wrappedLines.length, onTotalWrappedRowCountChange]);

  // Sync selection state into the contenteditable DOM (e.g. after programmatic
  // caret moves from Up/Down/Home/End keys and after undo/redo).
  useEffect(() => {
    const el = centerInputRef.current;
    if (!el || !isFocused) return;
    const live = ceGetSelection(el);
    if (!live || live.start !== selectionStart || live.end !== selectionEnd) {
      ceSetSelection(el, selectionStart, selectionEnd);
    }
    // Suppress any internal scroll the browser may apply
    if (el.scrollTop) el.scrollTop = 0;
    if (el.scrollLeft) el.scrollLeft = 0;
  }, [isFocused, selectionEnd, selectionStart]);

  // Canvas POC removed — using DOM overlay caret only.

  // Rectangle overlay caret with heartbeat animation.
  useEffect(() => {
    const overlay = caretOverlayRef.current;
    const root = editorRootRef.current;
    if (!overlay || !root) return;

    const insetPx = 1; // interior inset to avoid bleeding into grid lines

    function positionOverlay() {
      const el = centerInputRef.current;
      if (!el) return;

      // If selection is not collapsed, hide the custom caret overlay so the
      // native selection visuals remain primary.
      if (selectionStart !== selectionEnd) {
        overlay.style.display = 'none';
        return;
      }

      // Always show the overlay caret. Prefer exact caret rect when available;
      // otherwise use a fallback position at the center zone start.
      const rootRect = root.getBoundingClientRect();
      let rect = getCaretClientRectSafe(el);

      // Compute overlay anchor cell to ensure horizontal and vertical metrics are in sync.
      // We read the live selection from DOM to avoid React render lag causing broken pairs
      // (e.g. DOM rect returns left from next line, but React state holds gridRow from prev line).
      const liveSel = ceGetSelection(el);
      const livePos = liveSel ? liveSel.start : selectionStart;
      const overlayCaretCell = getCaretGridCell(livePos, wrappedLines, text, boundaryCaretRowPreferenceRef.current);

      // Horizontal metrics
      // If rect is unavailable (empty line, zero-width caret), fall back to
      // computing left/top from the logical grid cell so the caret appears on
      // the correct empty line rather than at the center zone origin.
      // Compute left/width/height using grid metrics and snap to device pixels
      // so the overlay matches the box interior exactly (subtract 2px for the
      // top+bottom grid borders).
      const leftRaw = rect ? (rect.left - rootRect.left) : (leftPaddingPx + (overlayCaretCell.gridColumn * charCellWidthPx));
      const left = snapToDevicePixels(Math.round(leftRaw) + insetPx);
      const width = snapToDevicePixels(Math.max(2, Math.round(charCellWidthPx) - (insetPx * 2)));
      const desiredHeight = Math.max(2, metrics.rowHeightPx - 2); // remove 1px top+1px bottom borders
      const height = snapToDevicePixels(desiredHeight);

      // Vertical: always align to the top of the grid box for the caret so it
      // sits flush with the box top. Compute row index relative to viewport
      // and position at the grid top + insetPx; snap to device pixels.
      const rowIndexInViewport = Math.max(0, Math.min(viewport.centerRowCount - 1, overlayCaretCell.gridRow - latestEffectiveViewportStartRowRef.current));
      const topRaw = topInsetPx + layout.topHeightPx + (rowIndexInViewport * metrics.rowHeightPx) + insetPx;
      // Add a one-physical-pixel offset to ensure the caret sits below the
      // grid line even when device-pixel rounding would otherwise place it
      // on the line. Convert one physical pixel into CSS pixels (1 / dpr).
      const dpr = typeof window === 'undefined' ? 1 : Math.max(1, window.devicePixelRatio || 1);
      const top = snapToDevicePixels(topRaw + (1 / dpr));

      overlay.style.display = 'block';
      overlay.style.left = `${left}px`;
      overlay.style.top = `${top}px`;
      overlay.style.width = `${width}px`;
      overlay.style.height = `${height}px`;
      const cs = window.getComputedStyle(root);
      const varColor = cs.getPropertyValue('--highlight-caret-bg') || '';
      overlay.style.background = varColor.trim() || 'rgba(0,0,0,0.35)';
    }

    let raf: number | null = null;
    function schedule() {
      if (raf != null) return;
      raf = window.requestAnimationFrame(() => {
        raf = null;
        positionOverlay();
      });
    }

    const onSelectionChange = () => schedule();
    const onResize = () => schedule();
    const onScroll = () => schedule();

    const onKeyDownDoc = (ev: KeyboardEvent) => {
      const k = ev.key;
      if (
        k === 'ArrowUp' || k === 'ArrowDown' || k === 'ArrowLeft' || k === 'ArrowRight'
        || k === 'Home' || k === 'End' || k === 'PageUp' || k === 'PageDown'
      ) {
        schedule();
      }
    };

    document.addEventListener('selectionchange', onSelectionChange);
    window.addEventListener('resize', onResize);
    root.addEventListener('scroll', onScroll, { passive: true });
    document.addEventListener('keydown', onKeyDownDoc);
    document.addEventListener('keyup', schedule);

    schedule();

    return () => {
      document.removeEventListener('selectionchange', onSelectionChange);
      window.removeEventListener('resize', onResize);
      root.removeEventListener('scroll', onScroll);
      document.removeEventListener('keydown', onKeyDownDoc);
      document.removeEventListener('keyup', schedule);
      if (raf != null) window.cancelAnimationFrame(raf);
    };
  }, [
    editorRootRef,
    caretOverlayRef,
    centerInputRef,
    charCellWidthPx,
    metrics,
    isFocused,
    caretPos,
    caretGridCell && caretGridCell.gridRow,
    effectiveCenterStartRow,
    layout.topHeightPx,
    topInsetPx,
    viewport.centerRowCount,
    leftPaddingPx,
    wrappedLines.length,
    isPointerSelecting,
    selectionStart,
    selectionEnd,
  ]);

  // Native caret: no imperative overlay positioning — rely on browser caret.

  const normalizeTrailingNewlineSelection = (
    el: HTMLElement,
    text: string,
    sel: { start: number; end: number } | null
  ): { start: number; end: number } | null => {
    if (!sel || sel.start !== sel.end) return sel;
    if (!text.endsWith('\n')) return sel;
    if (sel.start !== text.length - 1) return sel;

    const browserSel = window.getSelection();
    if (!browserSel || browserSel.rangeCount === 0) return sel;
    const range = browserSel.getRangeAt(0);
    if (!el.contains(range.startContainer)) return sel;

    const isAtFinalBr = range.startContainer.nodeType === Node.ELEMENT_NODE
      && (range.startContainer as Element).tagName === 'BR'
      && range.startOffset === 0;
    const isInTrailingEmptyText = range.startContainer.nodeType === Node.TEXT_NODE
      && (range.startContainer as Text).length === 0
      && range.startContainer.previousSibling instanceof Element
      && range.startContainer.previousSibling.tagName === 'BR';
    const isAtEndOfTextNodeBeforeBr = range.startContainer.nodeType === Node.TEXT_NODE
      && (range.startContainer as Text).length === range.startOffset
      && range.startContainer.nextSibling instanceof Element
      && range.startContainer.nextSibling.tagName === 'BR';

    if (isAtFinalBr || isInTrailingEmptyText || isAtEndOfTextNodeBeforeBr) {
      return { start: text.length, end: text.length };
    }

    return sel;
  };

  const handleInput = (e: React.FormEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    const newText = ceGetText(el);
    let sel = ceGetSelection(el);
    sel = normalizeTrailingNewlineSelection(el, newText, sel);
    const newSelectionStart = sel?.start ?? 0;
    const newSelectionEnd = sel?.end ?? newSelectionStart;

    normalizeEditableDom(el, newText, sel);
    onTextChange(newText, newSelectionStart, newSelectionEnd);
  };

  const handleBeforeInput = (e: React.FormEvent<HTMLDivElement>) => {
    const inputEvent = e.nativeEvent as InputEvent;
    const inputType = inputEvent.inputType;
    const data = inputEvent.data;
    if (inputEvent.isComposing) return;

    const isNewlineInsert = inputType === 'insertParagraph'
      || inputType === 'insertLineBreak'
      || (inputType === 'insertText' && data === '\n');

    if (isNewlineInsert || (inputType === 'insertText' && typeof data === 'string' && data.length > 0)) {
      const el = e.currentTarget;
      const sel = ceGetSelection(el) ?? { start: selectionStart, end: selectionEnd };
      const start = Math.min(sel.start, sel.end);
      const end = Math.max(sel.start, sel.end);
      const insertText = isNewlineInsert ? '\n' : (data ?? '');
      const newText = text.substring(0, start) + insertText + text.substring(end);
      const nextCaretPos = start + insertText.length;

      e.preventDefault();
      pendingAutomaticCaretPosRef.current = nextCaretPos;
      boundaryCaretRowPreferenceRef.current = null;
      onTextChange(newText, nextCaretPos, nextCaretPos);
    }
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

  const getWordSelectionRange = useCallback((pos: number) => {
    const textLength = text.length;
    if (textLength === 0) return { start: 0, end: 0 };

    const isWordChar = (chr: string) => !/\s/.test(chr);
    let index = Math.max(0, Math.min(pos, textLength - 1));
    const targetChar = text[index];

    if (isWordChar(targetChar)) {
      let start = index;
      while (start > 0 && isWordChar(text[start - 1])) start--;
      let end = index + 1;
      while (end < textLength && isWordChar(text[end])) end++;
      return { start, end };
    }

    if (/\s/.test(targetChar)) {
      let start = index;
      while (start > 0 && /\s/.test(text[start - 1])) start--;
      let end = index + 1;
      while (end < textLength && /\s/.test(text[end])) end++;
      return { start, end };
    }

    let start = index;
    while (start > 0 && !/\s/.test(text[start - 1])) start--;
    let end = index + 1;
    while (end < textLength && !/\s/.test(text[end])) end++;
    return { start, end };
  }, [text]);

  const isSpaceCharacter = (chr: string | null) => chr === ' ' || chr === '\t';
  const isLineBreakCharacter = (chr: string | null) => chr === '\n' || chr === '\r';
  const isSentenceTerminator = (chr: string | null) => chr === '.' || chr === ':' || chr === '?' || chr === '!';
  const isTerminatorOrLineBreak = (chr: string | null) => isSentenceTerminator(chr) || isLineBreakCharacter(chr);

  const trimSelectionSpaces = useCallback((start: number, end: number) => {
    let trimmedStart = Math.max(0, Math.min(start, end));
    let trimmedEnd = Math.max(0, Math.min(text.length, Math.max(start, end)));
    while (trimmedStart < trimmedEnd && isSpaceCharacter(text[trimmedStart])) trimmedStart++;
    while (trimmedEnd > trimmedStart && isSpaceCharacter(text[trimmedEnd - 1])) trimmedEnd--;
    return { start: trimmedStart, end: trimmedEnd };
  }, [text]);

  const getRightClickExpandedSelection = useCallback((start: number, end: number) => {
    if (start >= end) return null;
    const textLength = text.length;
    const normalizedStart = Math.max(0, Math.min(start, textLength));
    const normalizedEnd = Math.max(0, Math.min(end, textLength));
    const trimmed = trimSelectionSpaces(normalizedStart, normalizedEnd);
    const trimmedStart = trimmed.start;
    const trimmedEnd = trimmed.end;
    const containsSpace = /[ \t]/.test(text.slice(trimmedStart, trimmedEnd));
    const containsSentencePunctuation = /[^\w\s,]/.test(text.slice(trimmedStart, trimmedEnd));

    const expandToSentence = (wordStart: number, wordEnd: number) => {
      let left = wordStart;
      let scan = wordStart - 1;
      while (scan >= 0 && !isTerminatorOrLineBreak(text[scan])) scan--;
      left = scan < 0 ? 0 : scan + 1;
      while (left < wordStart && isSpaceCharacter(text[left])) left++;

      let right = wordEnd;
      let scanRight = wordEnd;
      while (scanRight < textLength && !isTerminatorOrLineBreak(text[scanRight])) scanRight++;
      if (scanRight >= textLength) {
        right = textLength;
      } else if (isLineBreakCharacter(text[scanRight])) {
        right = scanRight;
      } else {
        right = scanRight + 1;
      }
      while (right > left && isSpaceCharacter(text[right - 1])) right--;
      while (right > left && isLineBreakCharacter(text[right - 1])) right--;
      return { start: left, end: right };
    };

    const expandToParagraph = (rangeStart: number, rangeEnd: number) => {
      let left = rangeStart;
      let scan = rangeStart - 1;
      while (scan >= 0 && !isLineBreakCharacter(text[scan])) scan--;
      left = scan < 0 ? 0 : scan + 1;
      while (left < rangeStart && isSpaceCharacter(text[left])) left++;

      let right = rangeEnd;
      let scanRight = rangeEnd;
      while (scanRight < textLength && !isLineBreakCharacter(text[scanRight])) scanRight++;
      right = scanRight >= textLength ? textLength : scanRight;
      while (right > left && isSpaceCharacter(text[right - 1])) right--;
      return { start: left, end: right };
    };

    if (containsSentencePunctuation) {
      return expandToParagraph(trimmedStart, trimmedEnd);
    }

    const sentenceRange = expandToSentence(trimmedStart, trimmedEnd);
    if (sentenceRange.start === trimmedStart && sentenceRange.end === trimmedEnd) {
      const paragraphRange = expandToParagraph(trimmedStart, trimmedEnd);
      if (paragraphRange.start !== trimmedStart || paragraphRange.end !== trimmedEnd) {
        return paragraphRange;
      }
    }

    if (!containsSpace) {
      let left = trimmedStart;
      while (left > 0 && !isSpaceCharacter(text[left - 1])) left--;
      let right = trimmedEnd;
      while (right < textLength && !isSpaceCharacter(text[right])) right++;
      if (left !== trimmedStart || right !== trimmedEnd) {
        return { start: left, end: right };
      }
      const sentenceRange = expandToSentence(left, right);
      if (sentenceRange.start !== left || sentenceRange.end !== right) {
        return sentenceRange;
      }
      return { start: left, end: right };
    }

    const leftBoundaryChar = trimmedStart > 0 ? text[trimmedStart - 1] : null;
    const rightBoundaryChar = trimmedEnd < textLength ? text[trimmedEnd] : null;
    const leftLimitedBySpace = trimmedStart === 0 || isSpaceCharacter(leftBoundaryChar);
    const rightLimitedBySpace = trimmedEnd === textLength || isSpaceCharacter(rightBoundaryChar);
    const leftLimitedByTerminator = trimmedStart === 0 || isTerminatorOrLineBreak(leftBoundaryChar);
    const rightLimitedByTerminator = trimmedEnd === textLength || isTerminatorOrLineBreak(rightBoundaryChar);

    if (leftLimitedBySpace || rightLimitedBySpace) {
      let left = trimmedStart;
      let scan = trimmedStart - 1;
      while (scan >= 0 && !isTerminatorOrLineBreak(text[scan])) scan--;
      left = scan < 0 ? 0 : scan + 1;
      while (left < trimmedStart && isSpaceCharacter(text[left])) left++;

      let right = trimmedEnd;
      let scanRight = trimmedEnd;
      while (scanRight < textLength && !isTerminatorOrLineBreak(text[scanRight])) scanRight++;
      if (scanRight >= textLength) {
        right = textLength;
      } else if (isLineBreakCharacter(text[scanRight])) {
        right = scanRight;
      } else {
        right = scanRight + 1;
      }
      while (right > left && isSpaceCharacter(text[right - 1])) right--;
      while (right > left && isLineBreakCharacter(text[right - 1])) right--;
      return { start: left, end: right };
    }

    if (leftLimitedByTerminator || rightLimitedByTerminator) {
      const startsAtLineBreak = trimmedStart === 0 || isLineBreakCharacter(leftBoundaryChar);
      const endsAtLineBreak = trimmedEnd === textLength || isLineBreakCharacter(rightBoundaryChar);
      if (startsAtLineBreak && endsAtLineBreak) {
        return { start: trimmedStart, end: trimmedEnd };
      }

      const sentenceRange = expandToSentence(trimmedStart, trimmedEnd);
      const paragraphRange = expandToParagraph(trimmedStart, trimmedEnd);
      const isSentenceSelection = sentenceRange.start === trimmedStart && sentenceRange.end === trimmedEnd;
      if (isSentenceSelection && (paragraphRange.start !== trimmedStart || paragraphRange.end !== trimmedEnd)) {
        return paragraphRange;
      }
      if (sentenceRange.start !== trimmedStart || sentenceRange.end !== trimmedEnd) {
        return sentenceRange;
      }
      return { start: trimmedStart, end: trimmedEnd };
    }

    return null;
  }, [text, trimSelectionSpaces]);

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

    const relativeX = event.clientX - zoneBounds.left - leftPaddingPx;
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
    if (event.button === 2) {
      return;
    }
    if (event.button !== 0) return;

    if (event.detail > 1) {
      const clickedPos = getCharIndexForPointer(event.clientX, event.clientY);
      const { start, end } = getWordSelectionRange(clickedPos);
      event.preventDefault();
      event.currentTarget.focus();
      ceSetSelection(event.currentTarget, start, end);
      onSelectionChange?.(start, end);
      return;
    }

    cancelViewportAnimation();
    event.preventDefault();

    const editorRoot = editorRootRef.current;
    const rootBounds = editorRoot?.getBoundingClientRect();
    const pointerCell = rootBounds
      ? Math.max(0, Math.round((event.clientX - rootBounds.left - leftPaddingPx) / charCellWidthPx))
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
      lastTimestamp: null,
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
        const caretRow = resolveRowForCaretIndex(caretPos, wrappedLines, boundaryCaretRowPreferenceRef.current);
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
        const caretRow = resolveRowForCaretIndex(caretPos, wrappedLines, boundaryCaretRowPreferenceRef.current);
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
        const caretRow = resolveRowForCaretIndex(caretPos, wrappedLines, boundaryCaretRowPreferenceRef.current);
        const targetRow = Math.max(0, caretRow - pageRowDelta);
        const targetViewportStartRow = Math.max(0, effectiveCenterStartRow - pageRowDelta);
        setViewportStartRow(targetViewportStartRow);
        moveCaretToWrappedRow(targetRow);
        return;
      }

      if (e.key === 'PageDown') {
        e.preventDefault();
        const pageRowDelta = Math.max(1, viewport.centerRowCount);
        const caretRow = resolveRowForCaretIndex(caretPos, wrappedLines, boundaryCaretRowPreferenceRef.current);
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

        // Always record the row we resolved to as the boundary preference so that
        // subsequent Up/Down/Home/End navigation works correctly on wrapped rows.
        // For Home: keeps caret at visual start of currentRowIndex (not end of N-1).
        // For End: keeps caret at visual end of currentRowIndex (not start of N+1).
        boundaryCaretRowPreferenceRef.current = currentRowIndex;

        if (e.key === 'Home') {
          rememberPreferredCaretVisualColumn(0);
        } else {
          const rowText = text.slice(currentRow.startCharIndex, currentRow.endCharIndex);
          rememberPreferredCaretVisualColumn(countVisualCells(rowText));
        }

        // Guard handleSelect from clearing the boundary preference: mark this
        // position as a programmatic move so the synchronous selectionchange
        // event that fires when ceSetSelection is called inside onCaretChange
        // does not wipe boundaryCaretRowPreferenceRef.
        pendingAutomaticCaretPosRef.current = nextCaretPos;

        if (selectionStart !== selectionEnd) {
          onSelectionChange?.(nextCaretPos, nextCaretPos);
        } else {
          onCaretChange?.(nextCaretPos);
        }

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
    // Try browser-provided caret-from-point APIs first for precise mapping
    try {
      // Standard: caretPositionFromPoint (returns { offsetNode, offset })
      const doc: any = document as any;
      if (typeof doc.caretPositionFromPoint === 'function') {
        const pos = doc.caretPositionFromPoint(clientX, clientY);
        if (pos && pos.offsetNode) {
          // Only accept positions inside our editable
          const el = centerInputRef.current;
          if (el && el.contains(pos.offsetNode)) {
            const charIndex = ceCharOffset(el, pos.offsetNode, pos.offset);
            return Math.max(0, Math.min(text.length, charIndex));
          }
        }
      } else if (typeof doc.caretRangeFromPoint === 'function') {
        // WebKit / older: caretRangeFromPoint
        const range: Range | null = doc.caretRangeFromPoint(clientX, clientY);
        if (range && range.startContainer) {
          const el = centerInputRef.current;
          if (el && el.contains(range.startContainer)) {
            const charIndex = ceCharOffset(el, range.startContainer, range.startOffset);
            return Math.max(0, Math.min(text.length, charIndex));
          }
        }
      }
    } catch {
      // ignore and fall back to grid math
    }

    // Fallback: approximate using visible row / cell grid math
    const targetRowIndex = getVisibleRowIndexForPointer(clientY);
    const targetRow = wrappedLines[targetRowIndex];
    if (!targetRow) return 0;

    const rootBounds = editorRoot.getBoundingClientRect();
    const relativeX = clientX - rootBounds.left - leftPaddingPx;
    const targetCell = Math.max(0, Math.round(relativeX / charCellWidthPx));
    boundaryCaretRowPreferenceRef.current = targetRowIndex;
    return getCharIndexForVisualCell(targetRow, targetCell);
  }, [charCellWidthPx, getCharIndexForVisualCell, getVisibleRowIndexForPointer, leftPaddingPx, wrappedLines]);

  const handleCenterContextMenu = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    const editor = event.currentTarget;
    const sel = ceGetSelection(editor);
    if (!sel || sel.start === sel.end) return;
    const selectionStart = Math.min(sel.start, sel.end);
    const selectionEnd = Math.max(sel.start, sel.end);

    const expanded = getRightClickExpandedSelection(selectionStart, selectionEnd);
    const skipped = !expanded || (expanded.start === selectionStart && expanded.end === selectionEnd);
    if (skipped) return;
  }, [getRightClickExpandedSelection]);

  const handleCenterPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 2) return;
    const editor = event.currentTarget;
    const sel = ceGetSelection(editor);
    if (sel && sel.start !== sel.end) {
      const selectionStart = Math.min(sel.start, sel.end);
      const selectionEnd = Math.max(sel.start, sel.end);
      const expanded = getRightClickExpandedSelection(selectionStart, selectionEnd);
      if (expanded && (expanded.start !== selectionStart || expanded.end !== selectionEnd)) {
        event.preventDefault();
        event.stopPropagation();
        editor.focus();
        ceSetSelection(editor, expanded.start, expanded.end);
        onSelectionChange?.(expanded.start, expanded.end);
      }
    }
  };

  const handleCenterDoubleClick = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    const editor = event.currentTarget;
    const clickedPos = getCharIndexForPointer(event.clientX, event.clientY);
    const { start, end } = getWordSelectionRange(clickedPos);
    ceSetSelection(editor, start, end);
    onSelectionChange?.(start, end);
  }, [getCharIndexForPointer, getWordSelectionRange, onSelectionChange]);

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

    const step = (timestamp: number) => {
      const selectionDragState = selectionDragStateRef.current;
      if (!selectionDragState) return;

      const previousTimestamp = selectionDragState.lastTimestamp ?? timestamp;
      selectionDragState.lastTimestamp = timestamp;
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

  // overlay highlighting removed — rely on native selection and grid visuals

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
        '--highlight-selection-bg': highlightColors?.selection,
        '--highlight-caret-bg': highlightColors?.caret,
        '--markdown-editor-highlight-background': highlightColors?.background,
        '--markdown-editor-highlight-top-background': highlightColors?.topBackground,
        '--markdown-editor-highlight-bottom-background': highlightColors?.bottomBackground,
        '--timeline-background': highlightColors?.timelineBackground,
        '--timeline-active-bg': highlightColors?.timelineActive,
        '--timeline-manual-bg': highlightColors?.timelineManual,
        '--timeline-automatic-bg': highlightColors?.timelineAutomatic,
        '--scroll-indicator-active-bg': highlightColors?.scrollbarHandle,
        '--scroll-indicator-inactive-bg': highlightColors?.scrollbarBackground,
      } as React.CSSProperties}
    >
      <div ref={caretOverlayRef} className="fixed-focus-caret-rect" aria-hidden />

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
            '--grid-horizontal-padding': `${leftPaddingPx}px`,
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
            '--grid-horizontal-padding': `${leftPaddingPx}px`,
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
            '--grid-horizontal-padding': `${leftPaddingPx}px`,
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

        {/* Overlay highlights removed; relying on grid + native selection */}

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
              leftPaddingPx={leftPaddingPx}
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
            onPointerUp={handleCenterPointerUp}
            onDoubleClick={handleCenterDoubleClick}
            onContextMenuCapture={handleCenterContextMenu}
            onBeforeInput={handleBeforeInput}
            onKeyDown={handleKeyDown}
            onKeyUp={onKeyUp}
            onCopy={onCopy}
            onPaste={onPaste}
            onCompositionStart={onCompositionStart}
            onCompositionEnd={onCompositionEnd}
            onFocus={() => {
              // Pre-set the native selection to match React state so that the
              // selectionchange event that fires immediately after focus carries the
              // correct position.  Without this, Chrome places the caret at offset 0
              // on a freshly-mounted contenteditable, which causes handleSelect to
              // overwrite the restored caret/selection with (0, 0).
              // Skip during pointer-driven focus (click/tap): pointerdown sets
              // selectionDragStateRef synchronously before focus fires, so we can
              // detect it here and leave the click's selection untouched.
              const el = centerInputRef.current;
              if (el && !selectionDragStateRef.current) {
                ceSetSelection(el, selectionStart, selectionEnd);
              }
              setIsFocused(true);
            }}
            onBlur={() => setIsFocused(false)}
            data-placeholder={placeholder}
            style={{
              position: 'absolute',
              top: `${textareaTopPx}px`,
              left: 0,
              width: '100%',
              height: `${textareaHeightPx}px`,
              fontSize: `${fontSizePx}px`,
              lineHeight: `${metrics.rowHeightPx}px`,
              padding: `0 ${textareaRightPaddingPx}px 0 ${leftPaddingPx}px`,
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
              whiteSpace: 'break-spaces',
              wordWrap: 'break-word',
              tabSize: 3,
              caretColor: 'transparent',
              ...textareaStyle,
            }}
          />
          {showLineBreaks && (
            <div className="line-break-marker-layer" aria-hidden>
              {lineBreakMarkers.map((marker, index) => (
                <div
                  key={index}
                  className="line-break-marker"
                  style={{
                    top: `${marker.topPx}px`,
                    left: `${marker.leftPx}px`,
                  }}
                />
              ))}
            </div>
          )}
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
              leftPaddingPx={leftPaddingPx}
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

        {timelineProps && (
          <div className="fixed-focus-timeline-slot" style={{
            position: 'absolute',
            bottom: '5px',
            left: `${leftPaddingPx}px`,
            width: `${timelineWidthPx}px`,
            height: `${charCellWidthPx}px`,
            display: 'flex',
          }}>
            <Timeline 
              {...timelineProps}
              charWidth={charCellWidthPx}
              gridWidth={timelineWidthPx}
            />
          </div>
        )}
      </div>
    );
  };

interface MirroredTextLayerProps {
  text: string;
  metrics: ComputedMetrics;
  totalWrappedRowCount: number;
  visibleHeightPx: number;
  startRow: number;
  insetTopPx?: number;
  leftPaddingPx?: number;
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
  leftPaddingPx = 20,
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
        padding: `0 ${rightPaddingPx}px 0 ${leftPaddingPx}px`,
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
        whiteSpace: 'break-spaces',
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

