import type { WindowControlsApi } from '../shared/windowControls'
import { readPageZoomFactor } from './pageZoom'

/**
 * A change of page zoom (double size mode) shown as one clean cut.
 *
 * The zoom is applied by the main process, and what it changes reaches the
 * screen in several frames that no ordering here can merge: the compositor
 * scales the old page first, the page then learns its new CSS size (a
 * `resize`), lays out again and commits the sizes keyed to the mode, and
 * observers that measure the new layout (the visualizer's) follow inside
 * that frame. Every frame in between shows one state's layout at the
 * other's scale.
 *
 * So the switch is made under the window's last frame: the main process
 * captures it, it is put over everything as an image sized to the viewport
 * (so the zoom leaves it covering the window exactly), and only once it has
 * been painted is the zoom asked for. The image is removed inside the
 * `resize` that reports the new zoom, after App's own handler for that
 * event has committed the new sizes synchronously, so the frame that
 * replaces it is the first one laid out entirely in the new mode.
 *
 * Switches are serialized: one asked for while another is under way runs
 * after it, under its own captured frame.
 */
let queue: Promise<void> = Promise.resolve()

export function switchUnderFrozenFrame(controls: WindowControlsApi, targetZoom: number, apply: () => void): Promise<void> {
  queue = queue.then(() => freezeAndSwitch(controls, targetZoom, apply))
  return queue
}

async function freezeAndSwitch(controls: WindowControlsApi, targetZoom: number, apply: () => void): Promise<void> {
  // A switch that leaves the zoom as it is fires no resize to lift the cover
  // on, and has no in-between frames to hide.
  if (readPageZoomFactor() === targetZoom) {
    apply()
    return
  }
  const bytes = await controls.capturePage()
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'image/jpeg' }))
  const cover = new Image()
  cover.src = url
  try {
    await cover.decode()
  } catch {
    // An image that cannot be shown covers nothing; switch without it.
    URL.revokeObjectURL(url)
    apply()
    return
  }
  cover.setAttribute('aria-hidden', 'true')
  cover.style.cssText = 'position:fixed;left:0;top:0;width:100vw;height:100vh;z-index:2147483647;pointer-events:none;'
  document.body.appendChild(cover)
  // Two frames: the first paints the cover, the second starts after that
  // paint, so nothing the switch changes can reach a frame without it.
  await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
  const landed = new Promise<void>((resolve) => {
    const onResize = () => {
      if (readPageZoomFactor() !== targetZoom) return
      window.removeEventListener('resize', onResize)
      resolve()
    }
    window.addEventListener('resize', onResize)
  })
  apply()
  await landed
  cover.remove()
  URL.revokeObjectURL(url)
}
