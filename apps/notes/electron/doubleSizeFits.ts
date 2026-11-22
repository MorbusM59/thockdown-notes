/**
 * Whether double size fits a display the window is bound to (maximized: its
 * work area; full screen: its bounds): the window's minimum at
 * double size (both dimensions doubled, for the current sidebar and slot
 * count) fits inside that space. Both in the display's own logical
 * pixels, which is what Electron reports either in. Only a bound window is
 * judged (main.ts's doubleSizePossible): a free window has room off screen.
 */
export function doubleSizeFits(
  doubleMinimum: { width: number; height: number },
  space: { width: number; height: number },
): boolean {
  return doubleMinimum.width <= space.width && doubleMinimum.height <= space.height;
}
