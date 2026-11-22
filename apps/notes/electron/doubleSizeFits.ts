/**
 * Whether double size fits a full-screen display: the window's minimum at
 * double size (both dimensions doubled, for the current sidebar and slot
 * count) fits inside the display's bounds. Both in the display's own logical
 * pixels, which is what Electron reports either in. Only full screen is
 * judged (main.ts's doubleSizePossible): a window has room off screen.
 */
export function doubleSizeFits(
  doubleMinimum: { width: number; height: number },
  space: { width: number; height: number },
): boolean {
  return doubleMinimum.width <= space.width && doubleMinimum.height <= space.height;
}
