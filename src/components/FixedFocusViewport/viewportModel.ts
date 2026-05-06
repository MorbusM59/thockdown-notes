/**
 * FixedFocusViewportModel: manages the three-zone fixed viewport.
 *
 * State:
 * - Document: full text
 * - Wrapped rows: calculated from document + container width + metrics
 * - Viewport: which rows are in each zone (top, center, bottom)
 *
 * Constraints:
 * - Caret always in center zone
 * - Center zone min 1 row, max determined by container height
 * - Top zone can be 0 rows
 * - Bottom zone can be 0 rows
 */

import {
  computeMetrics,
  ComputedMetrics,
  rowsInHeight,
} from './lineMetrics';
import {
  computeWrappedLines,
  WrappedLine,
  findRowForCharIndex,
  getRowCharRange,
  getTotalWrappedRows,
} from './textWrapping';

export interface ViewportState {
  topRowCount: number;      // rows visible in top zone
  centerStartRow: number;   // first row visible in center zone
  centerRowCount: number;   // rows visible in center zone (min 1)
  bottomRowCount: number;   // rows visible in bottom zone
}

export interface LayoutDimensions {
  totalHeightPx: number;
  topHeightPx: number;      // max height for top zone
  centerHeightPx: number;   // fixed height for center zone
  bottomHeightPx: number;   // max height for bottom zone
}

export class FixedFocusViewportModel {
  private text = '';
  private wrappedLines: WrappedLine[] = [];
  private metrics: ComputedMetrics;
  private fontFamily: string;
  private topRowCount: number;
  private bottomRowCount: number;
  private charCellWidthPx: number | undefined;

  // Viewport state
  private viewport: ViewportState = {
    topRowCount: 0,
    centerStartRow: 0,
    centerRowCount: 1,
    bottomRowCount: 3,
  };

  // Layout constraints
  private layout: LayoutDimensions = {
    totalHeightPx: 400,
    topHeightPx: 0,
    centerHeightPx: 200,
    bottomHeightPx: 0,
  };

  // Caret position (character index in text)
  private caretPos = 0;

  constructor(
    fontSizePx: number,
    spacingPreset: string,
    containerWidthPx = 500,
    totalHeightPx = 400,
    fontFamily = '"Syne Mono", Menlo, Monaco, monospace',
    topRowCount = 3,
    bottomRowCount = 3,
    charCellWidthPx?: number
  ) {
    this.metrics = computeMetrics(fontSizePx, spacingPreset as any);
    this.fontFamily = fontFamily;
    this.topRowCount = topRowCount;
    this.bottomRowCount = bottomRowCount;
    this.charCellWidthPx = charCellWidthPx;
    this.layout.totalHeightPx = totalHeightPx;
    this.recalculateLayout(containerWidthPx);
    this.updateWrapping(containerWidthPx);
  }

  /**
   * Set the full document text and recompute wrapping.
   */
  setText(newText: string, containerWidthPx: number): void {
    this.text = newText;
    this.updateWrapping(containerWidthPx);
    // Clamp caret if it moved out of range
    this.caretPos = Math.min(this.caretPos, this.text.length);
    this.ensureCaretInCenter();
  }

  /**
   * Get current text.
   */
  getText(): string {
    return this.text;
  }

  /**
   * Set metrics (font size + spacing) and recalculate wrapping.
   */
  setMetrics(fontSizePx: number, spacingPreset: string, containerWidthPx: number): void {
    this.metrics = computeMetrics(fontSizePx, spacingPreset as any);
    this.updateWrapping(containerWidthPx);
    this.recalculateLayout(containerWidthPx);
  }

  setFontFamily(fontFamily: string, containerWidthPx: number): void {
    this.fontFamily = fontFamily;
    this.updateWrapping(containerWidthPx);
  }

  /**
   * Set total container height and recalculate layout.
   */
  setContainerHeight(heightPx: number, containerWidthPx: number): void {
    this.layout.totalHeightPx = heightPx;
    this.recalculateLayout(containerWidthPx);
  }

  /**
   * Set caret position (character index).
   * Automatically ensures it's in center zone.
   */
  setCaretPos(charIndex: number): void {
    this.caretPos = Math.min(Math.max(0, charIndex), this.text.length);
    this.ensureCaretInCenter();
  }

  /**
   * Get caret position (character index).
   */
  getCaretPos(): number {
    return this.caretPos;
  }

  /**
   * Get current viewport state.
   */
  getViewport(): ViewportState {
    return { ...this.viewport };
  }

  /**
   * Get layout dimensions.
   */
  getLayout(): LayoutDimensions {
    return { ...this.layout };
  }

  /**
   * Get metrics.
   */
  getMetrics(): ComputedMetrics {
    return this.metrics;
  }

  /**
   * Get wrapped lines (for rendering).
   */
  getWrappedLines(): WrappedLine[] {
    return this.wrappedLines;
  }

  /**
   * Get the rows visible in top zone.
   */
  getTopZoneRows(): WrappedLine[] {
    const endRow = this.viewport.centerStartRow;
    const startRow = Math.max(0, endRow - this.viewport.topRowCount);
    return this.wrappedLines.slice(startRow, endRow);
  }

  /**
   * Get the rows visible in center zone.
   */
  getCenterZoneRows(): WrappedLine[] {
    const startRow = this.viewport.centerStartRow;
    const endRow = this.viewport.centerStartRow + this.viewport.centerRowCount;
    return this.wrappedLines.slice(startRow, endRow);
  }

  /**
   * Get the rows visible in bottom zone.
   */
  getBottomZoneRows(): WrappedLine[] {
    const centerEndRow = this.viewport.centerStartRow + this.viewport.centerRowCount;
    const startRow = Math.min(centerEndRow, this.wrappedLines.length);
    const endRow = Math.min(
      this.wrappedLines.length,
      startRow + this.viewport.bottomRowCount
    );
    return this.wrappedLines.slice(startRow, endRow);
  }

  /**
   * Directly set the first row of the center zone.
   * Does not adjust the caret. Use this to set viewport from external state.
   */
  setViewportStartRow(row: number): void {
    const maxStart = Math.max(0, this.wrappedLines.length - this.viewport.centerRowCount);
    this.viewport.centerStartRow = Math.max(0, Math.min(row, maxStart));
  }

  /**
   * Move viewport up by N rows (reveals earlier text).
   * Clamps caret to ensure it stays in center.
   */
  moveViewportUp(rowCount = 1): void {
    this.viewport.centerStartRow = Math.max(
      0,
      this.viewport.centerStartRow - rowCount
    );
    this.ensureCaretInCenter();
  }

  /**
   * Move viewport down by N rows (reveals later text).
   * Clamps caret to ensure it stays in center.
   */
  moveViewportDown(rowCount = 1): void {
    const maxStart =
      Math.max(0, this.wrappedLines.length - this.viewport.centerRowCount);
    this.viewport.centerStartRow = Math.min(
      maxStart,
      this.viewport.centerStartRow + rowCount
    );
    this.ensureCaretInCenter();
  }

  /**
   * Insert text at caret position.
   * Returns new caret position.
   */
  insertText(insertedText: string, containerWidthPx: number): number {
    const newText =
      this.text.substring(0, this.caretPos) +
      insertedText +
      this.text.substring(this.caretPos);
    const newCaretPos = this.caretPos + insertedText.length;

    this.setText(newText, containerWidthPx);
    this.setCaretPos(newCaretPos);

    return newCaretPos;
  }

  /**
   * Delete N characters before caret.
   * Returns new caret position.
   */
  deleteBackward(count: number, containerWidthPx: number): number {
    const deleteStart = Math.max(0, this.caretPos - count);
    const newText =
      this.text.substring(0, deleteStart) +
      this.text.substring(this.caretPos);
    const newCaretPos = deleteStart;

    this.setText(newText, containerWidthPx);
    this.setCaretPos(newCaretPos);

    return newCaretPos;
  }

  // ===== Private methods =====

  private updateWrapping(containerWidthPx: number): void {
    this.wrappedLines = computeWrappedLines(
      this.text,
      containerWidthPx,
      this.metrics,
      this.fontFamily,
      this.charCellWidthPx
    );
  }

  private recalculateLayout(containerWidthPx: number): void {
    const totalVisibleRows = Math.max(1, rowsInHeight(this.layout.totalHeightPx, this.metrics));
    const minCenterRowCount = 1;
    const availableSideRows = Math.max(0, totalVisibleRows - minCenterRowCount);

    let resolvedTopRowCount = Math.max(0, Math.floor(this.topRowCount));
    let resolvedBottomRowCount = Math.max(0, Math.floor(this.bottomRowCount));
    let overflow = Math.max(0, (resolvedTopRowCount + resolvedBottomRowCount) - availableSideRows);

    while (overflow > 0 && (resolvedTopRowCount > 0 || resolvedBottomRowCount > 0)) {
      if (resolvedTopRowCount >= resolvedBottomRowCount && resolvedTopRowCount > 0) {
        resolvedTopRowCount -= 1;
      } else if (resolvedBottomRowCount > 0) {
        resolvedBottomRowCount -= 1;
      }
      overflow -= 1;
    }

    const resolvedCenterRowCount = Math.max(
      minCenterRowCount,
      totalVisibleRows - resolvedTopRowCount - resolvedBottomRowCount
    );

    this.layout.topHeightPx = resolvedTopRowCount * this.metrics.rowHeightPx;
    this.layout.centerHeightPx = resolvedCenterRowCount * this.metrics.rowHeightPx;
    this.layout.bottomHeightPx = resolvedBottomRowCount * this.metrics.rowHeightPx;

    this.viewport.topRowCount = resolvedTopRowCount;
    this.viewport.centerRowCount = resolvedCenterRowCount;
    this.viewport.bottomRowCount = resolvedBottomRowCount;
  }

  /**
   * Ensure caret is within center zone.
   * If not, move viewport so caret becomes visible in center.
   */
  private ensureCaretInCenter(): void {
    const caretRow = findRowForCharIndex(this.caretPos, this.wrappedLines);
    const centerEndRow = this.viewport.centerStartRow + this.viewport.centerRowCount;

    if (caretRow < this.viewport.centerStartRow) {
      // Caret is above center, scroll up
      this.viewport.centerStartRow = caretRow;
    } else if (caretRow >= centerEndRow) {
      // Caret is below center, scroll down
      this.viewport.centerStartRow = Math.max(
        0,
        caretRow - this.viewport.centerRowCount + 1
      );
    }
  }
}
