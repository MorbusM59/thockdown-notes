/**
 * The window-controls panel's width, derived once for both processes.
 *
 * This figure is load-bearing three times over: it is an exact px track in
 * the app grid, a term in the window's minimum width, and (collapsed) the
 * native width of the mini-mode window. Too small and the panel's contents
 * spill past its own right edge; too large and there is dead space beside
 * the formatting toolbar at minimum width.
 *
 * It lived as arithmetic in `App.tsx` plus a hand-copied literal in
 * `electron/main.ts`, and drifted in both: the main-process copy sat 21px
 * stale for a release (its own comment records an earlier 21px drift of the
 * sidebar figure), and the renderer's copy never counted the panel's own
 * border, which went unnoticed because a larger error sat on top of it.
 * Deriving it here, from the same constants the stylesheet uses, is what
 * stops the next bucket or border change from repeating that -- the main
 * process imports this rather than mirroring a number.
 *
 * Every term mirrors a stylesheet value; each is named against the token or
 * rule it tracks so a change to either can be followed here.
 */
import { AUDIO_GRID_COLUMNS } from './audioPlayer';

/** tokens.css --spacing-regular */
export const DEFAULT_SPACING_REGULAR_PX = 4;
/** tokens.css --btn-square-large-size */
export const BTN_SQUARE_LARGE_SIZE_PX = 40;
/**
 * controls.css `.window-controls-grid` is border-box with a 1px left border;
 * collapsed it carries one on all four sides, so the width term doubles.
 */
export const WINDOW_CONTROLS_PANEL_BORDER_PX = 1;

export interface WindowControlsMetrics {
  /** The audio player's footprint: its left padding plus its button grid. */
  audioWidthPx: number;
  /** One large window button plus the small gap that follows it. */
  windowButtonWidthPx: number;
  /** tokens.css --spacing-small. */
  smallGapPx: number;
}

export function computeWindowControlsMetrics(spacingRegularPx: number): WindowControlsMetrics {
  const smallGapPx = spacingRegularPx / 2; // mirrors --spacing-small
  const audioBtnSizePx = (BTN_SQUARE_LARGE_SIZE_PX - smallGapPx) / 2; // mirrors --audio-btn-size
  // .audio-controls pads its left edge only; the grid itself is one button per
  // column with a small gap between them.
  const audioWidthPx =
    spacingRegularPx + AUDIO_GRID_COLUMNS * audioBtnSizePx + (AUDIO_GRID_COLUMNS - 1) * smallGapPx;
  return { audioWidthPx, windowButtonWidthPx: BTN_SQUARE_LARGE_SIZE_PX + smallGapPx, smallGapPx };
}

/**
 * Full-width panel: the audio player, one spacing-regular, then the minimize
 * split, the maximize split and the close button, plus the panel's right
 * padding and its left border.
 *
 * Ceil'd because a fractional spacing setting makes these sub-pixel and the
 * column must never end up narrower than its content.
 */
export function computeWindowControlsWidthPx(spacingRegularPx: number): number {
  const { audioWidthPx, windowButtonWidthPx, smallGapPx } = computeWindowControlsMetrics(spacingRegularPx);
  const buttonsWidthPx = 3 * windowButtonWidthPx - smallGapPx + spacingRegularPx;
  return Math.ceil(
    audioWidthPx + spacingRegularPx + buttonsWidthPx + WINDOW_CONTROLS_PANEL_BORDER_PX,
  );
}

/**
 * Mini mode hides the maximize split and the close button (controls.css), so
 * only the minimize split is left beside the audio player, and the panel is
 * bordered on all sides rather than just the left.
 *
 * Used only as a fallback: the collapse handler measures a real collapsed
 * clone of the panel and prefers that, because a measurement cannot drift
 * out of step with the stylesheet the way this arithmetic can.
 */
export function computeWindowControlsCollapsedWidthPx(spacingRegularPx: number): number {
  const { audioWidthPx, windowButtonWidthPx, smallGapPx } = computeWindowControlsMetrics(spacingRegularPx);
  const buttonsWidthPx = windowButtonWidthPx - smallGapPx + spacingRegularPx;
  return Math.ceil(
    audioWidthPx + spacingRegularPx + buttonsWidthPx + 2 * WINDOW_CONTROLS_PANEL_BORDER_PX,
  );
}
