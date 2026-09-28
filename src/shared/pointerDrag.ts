// WHEN A PRESS BECOMES A DRAG.
//
// Every in-app drag (a sidebar note row, a section tab, a tag pill, a chapter
// pill) is STARTED here, and nowhere else. The browser's own drag-and-drop
// (`draggable="true"`) decides by itself when a press has become a drag, using
// the operating system's drag distance -- about 4px on Windows, less on some
// platforms -- and that distance cannot be read or raised from a page. A
// reader whose hand moves a few pixels while clicking a tab therefore picked
// the tab up instead of opening it, and the click was lost: the browser never
// fires `click` after a drag.
//
// So the decision is taken here, against ONE distance shared with moving the
// window (`DRAG_THRESHOLD_PX`), and measured in SCREEN pixels, because it is a
// distance the hand travels: the same nudge must stay a click at every zoom
// and in double-size mode.
//
// ONLY THE START IS OURS. Once the press has travelled the threshold, the
// drag is carried by ordinary DOM drag events -- `dragstart` on the source,
// `dragover` and `drop` on whatever is under the pointer, `dragend` on the
// source -- dispatched by this module with a `DataTransfer` it owns. That is
// deliberate: every drop target in the app is written against those events
// and routes by DOM propagation (a section claims a foreign note in the
// capture phase, a tab bar reorders in the bubble phase, the chapter bar
// clones), and that routing is correct. The fault was only in who decides
// that a drag has begun, so that is the only thing replaced.
//
// Differences from the browser's drag that callers can rely on:
//
//   - `drop` is dispatched to the element under the pointer on release,
//     whether or not its `dragover` was accepted. Every handler in the app
//     already checks its own state before acting, and "accepting" a dragover
//     existed only to stop the browser showing a no-drop cursor, which this
//     drag never shows.
//   - The pointer keeps producing ordinary pointer events throughout (the
//     browser's drag suppresses them), so the custom cursor keeps tracking.
//   - Escape, or losing the pointer, cancels: `dragend` without `drop`.
//   - The click that follows a completed drag's release is swallowed, since
//     the press was a drag and not a click.
//
// Files dropped IN from the operating system are not drags this module
// starts and are untouched: they remain the browser's own drag events.

import type { PointerEvent as ReactPointerEvent } from 'react'

/**
 * How far a press must travel, in screen pixels, before it is a drag rather
 * than a click. Below it, the press is a click however it wobbled.
 */
export const DRAG_THRESHOLD_PX = 5

/**
 * The attribute marking an element a press may drag. It replaces
 * `draggable="true"` as the declaration other modules read -- focus
 * ownership, the window-drag exclusion list -- so "can this be dragged" has
 * one spelling.
 */
export const DRAG_SOURCE_ATTRIBUTE = 'data-drag-source'
export const DRAG_SOURCE_SELECTOR = `[${DRAG_SOURCE_ATTRIBUTE}]`

/** Class on `<body>` for the whole of a drag, so styles can react to it. */
export const DRAG_ACTIVE_BODY_CLASS = 'is-pointer-dragging'

/**
 * Has a press that started at `(startX, startY)` and is now at `(x, y)`
 * travelled far enough to be a drag? The one statement of the rule, shared by
 * this module and the window-move gesture.
 */
export function hasTravelledDragThreshold(startX: number, startY: number, x: number, y: number): boolean {
  return Math.hypot(x - startX, y - startY) >= DRAG_THRESHOLD_PX
}

let activeDragCancel: (() => void) | null = null

/**
 * Arms a drag from a pointer press on `event.currentTarget`. Call it from the
 * element's `onPointerDown`; the element must carry `DRAG_SOURCE_ATTRIBUTE`.
 *
 * Nothing happens until the pointer has travelled `DRAG_THRESHOLD_PX`; a
 * release before that is left entirely to the ordinary click. Past it, a
 * `dragstart` is dispatched on the source and its handler fills the
 * `DataTransfer` exactly as it would for the browser's drag; cancelling that
 * `dragstart` abandons the drag.
 *
 * Only the primary button of a primary pointer arms anything: a right press
 * belongs to the app's right-press gestures and never drags.
 */
export function armPointerDrag(event: ReactPointerEvent<HTMLElement>): void {
  if (event.button !== 0 || !event.isPrimary) return
  const source = event.currentTarget
  const pointerId = event.pointerId
  const startScreenX = event.screenX
  const startScreenY = event.screenY

  // A second press while a drag is live (another finger, a pen) ends the
  // first rather than running two.
  activeDragCancel?.()

  let dataTransfer: DataTransfer | null = null
  let ghost: HTMLElement | null = null
  let ghostOffsetX = 0
  let ghostOffsetY = 0
  let lastClientX = event.clientX
  let lastClientY = event.clientY

  const dispatch = (type: string, target: EventTarget): boolean => target.dispatchEvent(new DragEvent(type, {
    bubbles: true,
    cancelable: true,
    composed: true,
    clientX: lastClientX,
    clientY: lastClientY,
    dataTransfer,
  }))

  const elementUnderPointer = (): Element | null => document.elementFromPoint(lastClientX, lastClientY)

  const begin = () => {
    dataTransfer = new DataTransfer()
    // `dispatchEvent` returns false when a handler cancelled it: the source
    // declined to be dragged (a protected tag, say).
    if (!dispatch('dragstart', source)) {
      finish(false)
      return
    }
    const rect = source.getBoundingClientRect()
    ghostOffsetX = lastClientX - rect.left
    ghostOffsetY = lastClientY - rect.top
    // The picture that follows the pointer is a copy of the source, placed
    // beside it rather than under <body> so the stylesheet rules that reach
    // it through its ancestors (a sidebar row, a bar's pill) still apply.
    // `position: fixed` inside an ancestor with a transform is positioned
    // against that ancestor instead of the viewport, so where the copy lands
    // with no translation is measured once and subtracted.
    ghost = source.cloneNode(true) as HTMLElement
    ghost.removeAttribute('id')
    for (const name of ghost.getAttributeNames()) {
      if (name.startsWith('data-') || name === 'tabindex' || name === 'role') ghost.removeAttribute(name)
    }
    ghost.setAttribute('aria-hidden', 'true')
    Object.assign(ghost.style, {
      position: 'fixed',
      left: '0px',
      top: '0px',
      width: `${rect.width}px`,
      height: `${rect.height}px`,
      margin: '0',
      pointerEvents: 'none',
      opacity: '0.7',
      zIndex: '2147483646',
      boxSizing: 'border-box',
    })
    source.parentElement?.appendChild(ghost)
    const origin = ghost.getBoundingClientRect()
    ghostOffsetX += origin.left
    ghostOffsetY += origin.top
    placeGhost()
    document.body.classList.add(DRAG_ACTIVE_BODY_CLASS)
  }

  const placeGhost = () => {
    if (!ghost) return
    ghost.style.transform = `translate(${lastClientX - ghostOffsetX}px, ${lastClientY - ghostOffsetY}px)`
  }

  const onPointerMove = (moveEvent: PointerEvent) => {
    if (moveEvent.pointerId !== pointerId) return
    lastClientX = moveEvent.clientX
    lastClientY = moveEvent.clientY
    if (!dataTransfer) {
      if (!hasTravelledDragThreshold(startScreenX, startScreenY, moveEvent.screenX, moveEvent.screenY)) return
      begin()
      if (!dataTransfer) return
    }
    moveEvent.preventDefault()
    placeGhost()
    const target = elementUnderPointer()
    if (target) dispatch('dragover', target)
  }

  const onPointerUp = (upEvent: PointerEvent) => {
    if (upEvent.pointerId !== pointerId) return
    lastClientX = upEvent.clientX
    lastClientY = upEvent.clientY
    finish(true)
  }

  const onPointerCancel = (cancelEvent: PointerEvent) => {
    if (cancelEvent.pointerId !== pointerId) return
    finish(false)
  }

  const onKeyDown = (keyEvent: KeyboardEvent) => {
    if (keyEvent.key !== 'Escape' || !dataTransfer) return
    // The Escape belongs to the drag: without this it would also raise the
    // escape-hold ring underneath.
    keyEvent.preventDefault()
    keyEvent.stopPropagation()
    finish(false)
  }

  let finished = false
  const finish = (drop: boolean) => {
    if (finished) return
    finished = true
    window.removeEventListener('pointermove', onPointerMove, true)
    window.removeEventListener('pointerup', onPointerUp, true)
    window.removeEventListener('pointercancel', onPointerCancel, true)
    window.removeEventListener('keydown', onKeyDown, true)
    if (activeDragCancel === cancel) activeDragCancel = null
    if (!dataTransfer) return

    ghost?.remove()
    ghost = null
    document.body.classList.remove(DRAG_ACTIVE_BODY_CLASS)
    if (drop) {
      const target = elementUnderPointer()
      if (target) dispatch('drop', target)
      swallowNextClick()
    }
    dispatch('dragend', source)
  }

  const cancel = () => finish(false)
  activeDragCancel = cancel

  window.addEventListener('pointermove', onPointerMove, true)
  window.addEventListener('pointerup', onPointerUp, true)
  window.addEventListener('pointercancel', onPointerCancel, true)
  window.addEventListener('keydown', onKeyDown, true)
}

/**
 * Swallows the click the browser synthesises from a drag's release. It fires
 * in the same task as the `pointerup` or not at all (a release over a
 * different element than the press produces none), so the guard lives only
 * until the next task rather than waiting for a click that may never come.
 */
function swallowNextClick(): void {
  const onClick = (clickEvent: MouseEvent) => {
    clickEvent.preventDefault()
    clickEvent.stopPropagation()
  }
  window.addEventListener('click', onClick, { capture: true, once: true })
  window.setTimeout(() => window.removeEventListener('click', onClick, true), 0)
}
