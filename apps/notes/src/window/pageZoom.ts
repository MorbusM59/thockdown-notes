/**
 * The page's own zoom factor -- double size mode's 2x, applied by the main
 * process through webContents.setZoomFactor and read back here through the
 * preload's webFrame. Display scaling never touches it, which is exactly what
 * separates it from devicePixelRatio (a monitor with other scaling changes the
 * ratio, not the zoom). 1 where there are no window controls: browser mode has
 * no page zoom to follow.
 *
 * The one place anything asks "what zoom is the page actually at": the custom
 * cursor (converting its stored pointer position when the zoom changes), App's
 * applied size mode (switching the font sizes in the frame the zoom lands), and
 * the mini-mode window sizing (converting page pixels to window pixels).
 */
export function readPageZoomFactor(): number {
  const zoom = window.windowControls?.getPageZoomFactor?.()
  return typeof zoom === 'number' && Number.isFinite(zoom) && zoom > 0 ? zoom : 1
}
