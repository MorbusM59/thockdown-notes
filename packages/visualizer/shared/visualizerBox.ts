/**
 * The visualizer scene's BOX: square, a multiple of the font size read as
 * the editor's line height is (Options > Visualizer's box size on the
 * desktop; fixed at the default on the phone, whose one setting is the size),
 * in whole pixels so the grid tiles pixel-exact.
 */
export const DEFAULT_VISUALIZER_BOX_SIZE = 1.2

export function visualizerBoxPx(fontSizePx: number, boxSize: number): number {
  return Math.max(1, Math.round(fontSizePx * boxSize))
}
