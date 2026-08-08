import { useEffect } from 'react'
import { WINDOW_DRAG_EXCLUDED_SELECTOR, WINDOW_DRAG_THRESHOLD_PX, WINDOW_TITLEBAR_SELECTOR } from '../shared/windowDrag'

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
 *
 * Double-click to maximize/restore, and dragging a *maximized* window from
 * the title-bar-like chrome (WINDOW_TITLEBAR_SELECTOR), are both scoped to
 * that selector so ordinary drag-to-move elsewhere in the app can't
 * accidentally pop the window out of its maximized state.
 *
 * The maximized-drag case can't actually move the window live, though:
 * Windows won't apply a setBounds()/unmaximize() while the mouse button is
 * still physically held down (Chromium holds native input capture on the
 * window for the whole gesture, and Windows silently drops window-placement
 * changes against a window that currently owns capture) -- confirmed by
 * `once('unmaximize', ...)` never firing mid-drag even for a bare
 * unmaximize() with no repositioning attached. So instead of chasing that,
 * a drag that starts on a maximized window's title-bar chrome tracks the
 * cursor without moving anything, then on the actual mouseup -- by then a
 * genuine release, the same circumstance double-click-to-restore already
 * relies on -- restores the window and places it as if the drag had been
 * followed live the whole time, anchored the same way a real title-bar
 * drag would be: the point under the cursor at mousedown stays under the
 * cursor at mouseup. See electron/main.ts's restoreMaximized handler.
 */
export function useWindowDragRegion() {
  useEffect(() => {
    const controls = window.windowControls
    if (!controls?.startWindowDrag || !controls.moveWindowDrag || !controls.endWindowDrag) return

    let isMaximized = false
    const unsubscribeMaximize = controls.onMaximizeStateChange?.((value) => {
      isMaximized = value
    })

    let candidateOrigin: { x: number; y: number } | null = null
    let isDragging = false
    let restoreOrigin: { x: number; y: number } | null = null
    let lastCursorPos: { x: number; y: number } | null = null

    function handleMouseDown(event: MouseEvent) {
      if (event.button !== 0) return
      const target = event.target
      if (!(target instanceof Element) || target.closest(WINDOW_DRAG_EXCLUDED_SELECTOR)) return
      candidateOrigin = { x: event.screenX, y: event.screenY }
      isDragging = false
      restoreOrigin = null
      lastCursorPos = null
      if (isMaximized && target.closest(WINDOW_TITLEBAR_SELECTOR)) {
        restoreOrigin = { x: event.screenX, y: event.screenY }
      }
    }

    function handleMouseMove(event: MouseEvent) {
      if (!candidateOrigin) return

      if (restoreOrigin) {
        lastCursorPos = { x: event.screenX, y: event.screenY }
        return
      }

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
      if (restoreOrigin) {
        const release = lastCursorPos ?? restoreOrigin
        controls!.restoreMaximizedWindow?.(restoreOrigin.x, restoreOrigin.y, release.x, release.y)
      }
      candidateOrigin = null
      isDragging = false
      restoreOrigin = null
      lastCursorPos = null
    }

    function handleDoubleClick(event: MouseEvent) {
      if (event.button !== 0) return
      const target = event.target
      if (!(target instanceof Element) || target.closest(WINDOW_DRAG_EXCLUDED_SELECTOR)) return
      if (!target.closest(WINDOW_TITLEBAR_SELECTOR)) return
      controls!.toggleMaximize?.()
    }

    window.addEventListener('mousedown', handleMouseDown, { capture: true })
    window.addEventListener('mousemove', handleMouseMove, { capture: true })
    window.addEventListener('mouseup', endGesture, { capture: true })
    window.addEventListener('dblclick', handleDoubleClick, { capture: true })
    window.addEventListener('blur', endGesture)

    return () => {
      window.removeEventListener('mousedown', handleMouseDown, { capture: true })
      window.removeEventListener('mousemove', handleMouseMove, { capture: true })
      window.removeEventListener('mouseup', endGesture, { capture: true })
      window.removeEventListener('dblclick', handleDoubleClick, { capture: true })
      window.removeEventListener('blur', endGesture)
      unsubscribeMaximize?.()
    }
  }, [])
}
