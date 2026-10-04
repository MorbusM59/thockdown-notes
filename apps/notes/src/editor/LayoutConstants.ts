export const LINE_HEIGHT_PX = 24;
export const CELL_WIDTH_PX = 10;
/**
 * The pixel delta a single mouse-wheel notch is ASSUMED to carry, until a
 * real device says otherwise.
 *
 * 100 is the Windows default (three lines at the browser's 33.3px/line), and
 * it was for a long time the only value the edit-view wheel handler would
 * accept -- which quietly halved the scroll rate for anyone whose pointer
 * settings send 50 (one or two lines per notch): the first notch of every
 * pair accumulated to 50, fell under the unit, and moved nothing at all.
 * Reported as "scrolling up only moves a line on every other notch"; it
 * applied to both directions. The handler now measures the notch instead of
 * assuming it, and this is only the starting guess. See
 * `resolveWheelNotchPx` in editor/wheelNotch.ts.
 */
export const PIXELS_PER_WHEEL_UNIT = 100;
