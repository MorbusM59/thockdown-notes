/**
 * Whether double size fits: the window's minimum at double size (both
 * dimensions doubled, for the current sidebar and slot count) fits inside the
 * space the window can have on its display (the whole display in full
 * screen, the work area otherwise). Both in the display's own logical pixels,
 * which is what Electron reports either in.
 *
 * The one rule deciding whether double size is AVAILABLE; main.ts's
 * reconcileDoubleSize applies it whenever any of its inputs changes.
 */
export function doubleSizeFits(
  doubleMinimum: { width: number; height: number },
  space: { width: number; height: number },
): boolean {
  return doubleMinimum.width <= space.width && doubleMinimum.height <= space.height;
}
