import { useEffect } from 'react'
import { WINDOW_DRAG_EXCLUDED_SELECTOR, WINDOW_DRAG_THRESHOLD_PX } from '../shared/windowDrag'

/**
 * Global, mount-once replacement for `-webkit-app-region: drag`. Listens for
 * a primary-button mousedown anywhere that isn't inside
 * WINDOW_DRAG_EXCLUDED_SELECTOR, then -- only once the cursor has actually
 * moved WINDOW_DRAG_THRESHOLD_PX from that point while still held -- starts
 * moving the OS window via the `windowControls` IPC bridge (see
 * electron/main.ts's window-drag:* handlers). Listening at `window` in the
 * capture phase (not on any specific element) means it sees every mousedown
 * before app code can stopPropagation() it, so the exclusion selector is the
 * single source of truth for what's draggable -- not listener ordering.
 */
export function useWindowDragRegion() {
  useEffect(() => {
    const controls = window.windowControls
    if (!controls?.startWindowDrag || !controls.moveWindowDrag || !controls.endWindowDrag) return

    let candidateOrigin: { x: number; y: number } | null = null
    let isDragging = false

    function handleMouseDown(event: MouseEvent) {
      if (event.button !== 0) return
      const target = event.target
      if (!(target instanceof Element) || target.closest(WINDOW_DRAG_EXCLUDED_SELECTOR)) return
      candidateOrigin = { x: event.screenX, y: event.screenY }
      isDragging = false
    }

    function handleMouseMove(event: MouseEvent) {
      if (!candidateOrigin) return

      if (!isDragging) {
        const dx = event.screenX - candidateOrigin.x
        const dy = event.screenY - candidateOrigin.y
        if (Math.hypot(dx, dy) < WINDOW_DRAG_THRESHOLD_PX) return
        isDragging = true
        controls!.startWindowDrag!(candidateOrigin.x, candidateOrigin.y)
      }

      event.preventDefault()
      controls!.moveWindowDrag!(event.screenX, event.screenY)
    }

    function endGesture() {
      if (isDragging) controls!.endWindowDrag!()
      candidateOrigin = null
      isDragging = false
    }

    window.addEventListener('mousedown', handleMouseDown, { capture: true })
    window.addEventListener('mousemove', handleMouseMove, { capture: true })
    window.addEventListener('mouseup', endGesture, { capture: true })
    window.addEventListener('blur', endGesture)

    return () => {
      window.removeEventListener('mousedown', handleMouseDown, { capture: true })
      window.removeEventListener('mousemove', handleMouseMove, { capture: true })
      window.removeEventListener('mouseup', endGesture, { capture: true })
      window.removeEventListener('blur', endGesture)
    }
  }, [])
}
