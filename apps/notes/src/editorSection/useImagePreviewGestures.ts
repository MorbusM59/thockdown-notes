import { useEffect, useRef, type MutableRefObject, type RefObject } from 'react'
import type { EditorAdapter } from '../editor/EditorContract'
import { insertAtBlockStart, locateImage, moveImage, reshapeImage, sameAlt, type ImageEdit } from '../editor/ImagePlacement'
import { type ImageAlignment, type ImageInset, type ImageLayout, type ImageLength } from '../shared/imageLayout'
import { IMAGE_DRAG_MIME_TYPE, imageMarkdown, isImageFile } from '../shared/images'
import { importImageFilesAsMarkdown } from '../shared/storedImages'

// SHAPING AN IMAGE IN THE RENDER VIEW, with the pointer:
//
//   Ctrl + drag          move it to the start of the block it is dropped on,
//                        aligned by where across the page it lands (left
//                        third, middle, right third)
//   Shift + drag         resize, keeping its proportions (the longer of the
//                        two movements decides; down grows, and across, a
//                        drag away from the side the image is aligned to
//                        grows: rightward for left (and unaligned), leftward
//                        for right, outward from the middle for centre)
//   Ctrl + Shift + drag  resize width and height separately
//   Ctrl + drag on the   crop: within 1em of an edge, that edge moves in
//     image's border     or out; within 1em of a corner, both of its edges
//                        (the title's `inset(...)`, shared/imageLayout.ts)
//   Ctrl + right-click   take the crop off
//
// A crop changes the image's own proportions, so a Shift resize after it
// keeps the cropped ones.
//
// and dropping image files (or an image card from the library) onto a block
// stores them and puts them at its start. Without a modifier the pointer does what it always does there.
//
// Each gesture ends in one edit of the note's text (ImagePlacement.ts),
// applied through the editor so it is one undo step and is saved like
// typing; the render view then redraws from the text. While a resize is
// under way the frame is sized directly, so the reader sees what they will
// get; nothing is written until the button is released.

const DRAG_START_PX = 3
/** The most of either dimension a crop may take away, so an image never vanishes into its own border. */
const MAX_CROP_PERCENT = 95

/** Which edges of `rect` a point within `band` px of them grabs: none in the middle. */
function cropEdgesAt(rect: DOMRect, x: number, y: number, band: number): { top: boolean; right: boolean; bottom: boolean; left: boolean } {
  // A small image keeps a middle to move it by: the band is at most a third of each side.
  const across = Math.min(band, rect.width / 3)
  const down = Math.min(band, rect.height / 3)
  return {
    top: y - rect.top < down,
    bottom: rect.bottom - y < down,
    left: x - rect.left < across,
    right: rect.right - x < across,
  }
}

/** `start` with the grabbed edges moved by the pointer's travel; `perPixel` is the percent of the whole image one displayed pixel stands for. */
function draggedInset(
  start: ImageInset,
  edges: ReturnType<typeof cropEdgesAt>,
  dx: number,
  dy: number,
  perPixel: { x: number; y: number },
): ImageInset {
  const clamp = (value: number, opposite: number) => Math.max(0, Math.min(Math.max(0, MAX_CROP_PERCENT - opposite), value))
  const next = { ...start }
  if (edges.left) next.left = clamp(start.left + dx * perPixel.x, start.right)
  if (edges.right) next.right = clamp(start.right - dx * perPixel.x, start.left)
  if (edges.top) next.top = clamp(start.top + dy * perPixel.y, start.bottom)
  if (edges.bottom) next.bottom = clamp(start.bottom - dy * perPixel.y, start.top)
  return next
}

interface Context {
  activeNoteId: string | null
  scrollerRef: RefObject<HTMLDivElement | null>
  adapterRef: MutableRefObject<EditorAdapter | null>
  readEditorText: () => string
  canEdit: boolean
  /** Debug-tagged notes refuse edits made from outside the text, as dropping into the editor does. */
  activeNoteHasDebugTagRef: MutableRefObject<boolean>
}

/** The image's line, its index among the images drawn from that line, and how many there are. */
function addressOf(scroller: HTMLElement, frame: HTMLElement): { line0: number; ordinal: number; drawn: number } | null {
  const line = frame.dataset.imageLine
  if (line === undefined) return null
  const siblings = Array.from(scroller.querySelectorAll<HTMLElement>(`[data-image-line="${line}"]`))
  return { line0: Number(line), ordinal: siblings.indexOf(frame), drawn: siblings.length }
}

/** The first source line of the block under a point in the render view, or null. */
function blockLineAt(scroller: HTMLElement, x: number, y: number): number | null {
  const hit = document.elementFromPoint(x, y)
  const block = hit instanceof Element ? hit.closest<HTMLElement>('[data-source-line-start]') : null
  if (!block || !scroller.contains(block)) return null
  const line = Number(block.dataset.sourceLineStart)
  return Number.isFinite(line) ? line : null
}

/**
 * How much wider a drag from `startX` to `x` makes an image aligned `align`
 * whose box centre is at `centerX`: the free edge follows the pointer, and a
 * centred image grows on both sides at once, so twice the outward movement.
 */
function widthGrowth(align: ImageAlignment | null, startX: number, x: number, centerX: number): number {
  if (align === 'right') return startX - x
  if (align === 'center') return 2 * (Math.abs(x - centerX) - Math.abs(startX - centerX))
  return x - startX
}

function alignmentAt(scroller: HTMLElement, x: number): ImageAlignment {
  const rect = scroller.getBoundingClientRect()
  const fraction = (x - rect.left) / Math.max(1, rect.width)
  return fraction < 1 / 3 ? 'left' : fraction > 2 / 3 ? 'right' : 'center'
}

/** `px` in the unit the image already uses for that side (em when it has none). */
function lengthIn(px: number, unit: ImageLength['unit'] | undefined, frame: HTMLElement, side: 'width' | 'height'): ImageLength {
  const fontSizePx = parseFloat(getComputedStyle(frame).fontSize) || 16
  if (unit === 'px') return { value: Math.max(1, Math.round(px)), unit: 'px' }
  if (unit === '%' && side === 'width') {
    const column = frame.parentElement?.getBoundingClientRect().width ?? 0
    if (column > 0) return { value: Math.min(100, Math.max(1, Math.round((px / column) * 100))), unit: '%' }
  }
  return { value: Math.max(0.5, Math.round((px / fontSizePx) * 2) / 2), unit: 'em' }
}

export function useImagePreviewGestures({ activeNoteId, scrollerRef, adapterRef, readEditorText, canEdit, activeNoteHasDebugTagRef }: Context): void {
  const noteRef = useRef(activeNoteId)
  noteRef.current = activeNoteId
  const canEditRef = useRef(canEdit)
  canEditRef.current = canEdit
  useEffect(() => {
    const scroller = scrollerRef.current
    if (!scroller || !canEdit) return

    const apply = (text: string, edit: ImageEdit | ImageEdit[] | null) => {
      if (edit && !activeNoteHasDebugTagRef.current) adapterRef.current?.applyEdit(Array.isArray(edit) ? edit : [edit], text)
    }

    const handlePointerDown = (event: PointerEvent) => {
      const resetsCrop = event.button === 2 && event.ctrlKey && !event.shiftKey
      if (!resetsCrop && (event.button !== 0 || !(event.ctrlKey || event.shiftKey))) return
      const frame = event.target instanceof Element ? event.target.closest<HTMLElement>('.markdown-image-frame[data-image-line]') : null
      if (!frame || !scroller.contains(frame)) return
      const address = addressOf(scroller, frame)
      const text = readEditorText()
      const image = address && locateImage(text, address.line0, address.ordinal, address.drawn)
      if (!image) return
      const img = frame.querySelector('img')
      if (img && !sameAlt(image.alt, img.alt)) return
      event.preventDefault()
      event.stopPropagation()
      if (resetsCrop) {
        if (image.layout.inset) apply(text, reshapeImage(text, image, { ...image.layout, inset: null }))
        return
      }

      const startRect = (img ?? frame).getBoundingClientRect()
      const band = parseFloat(getComputedStyle(frame).fontSize) || 16
      const edges = cropEdgesAt(startRect, event.clientX, event.clientY, band)
      const crops = img !== null && event.ctrlKey && !event.shiftKey && (edges.top || edges.right || edges.bottom || edges.left)
      const mode: 'move' | 'crop' | 'resize-locked' | 'resize-free' = crops ? 'crop'
        : !event.shiftKey ? 'move' : event.ctrlKey ? 'resize-free' : 'resize-locked'
      const start = { x: event.clientX, y: event.clientY }
      const startInset: ImageInset = image.layout.inset ?? { top: 0, right: 0, bottom: 0, left: 0 }
      // One displayed pixel is this many percent of the whole image: the
      // displayed part is what the crop keeps.
      const perPixel = {
        x: (100 - startInset.left - startInset.right) / Math.max(1, startRect.width),
        y: (100 - startInset.top - startInset.bottom) / Math.max(1, startRect.height),
      }
      let inset = startInset
      const ratio = startRect.height > 0 ? startRect.width / startRect.height : 1
      let moved = false
      let size = { width: startRect.width, height: startRect.height }
      const restore = {
        frameWidth: frame.style.width,
        imgWidth: img?.style.width ?? '',
        imgHeight: img?.style.height ?? '',
        opacity: frame.style.opacity,
      }
      const cropGhost = mode === 'crop' && img ? createCropGhost(frame, img, startInset) : null
      frame.setPointerCapture(event.pointerId)

      const handleMove = (move: PointerEvent) => {
        const dy = move.clientY - start.y
        if (!moved && Math.hypot(move.clientX - start.x, dy) < DRAG_START_PX) return
        const dx = widthGrowth(image.layout.align, start.x, move.clientX, startRect.left + startRect.width / 2)
        moved = true
        if (mode === 'crop') {
          inset = draggedInset(startInset, edges, move.clientX - start.x, dy, perPixel)
          if (cropGhost) cropGhost.show(inset)
          return
        }
        if (mode === 'move') {
          frame.style.opacity = '0.5'
          return
        }
        if (mode === 'resize-locked') {
          // The longer movement decides; dx is already signed as growth.
          const delta = Math.abs(dx) >= Math.abs(dy) ? dx : dy * ratio
          const width = Math.max(16, startRect.width + delta)
          size = { width, height: width / ratio }
        } else {
          size = { width: Math.max(16, startRect.width + dx), height: Math.max(16, startRect.height + dy) }
        }
        frame.style.width = `${size.width}px`
        if (img) {
          img.style.width = '100%'
          img.style.height = mode === 'resize-free' ? `${size.height}px` : ''
        }
      }

      const finish = (up: PointerEvent, commit: boolean) => {
        frame.removeEventListener('pointermove', handleMove)
        frame.removeEventListener('pointerup', handleUp)
        frame.removeEventListener('pointercancel', handleCancel)
        frame.removeEventListener('lostpointercapture', handleCancel)
        if (moved) {
          // A drag is not a click: an image inside a link must not follow it.
          window.addEventListener('click', swallowClick, { capture: true, once: true })
          window.setTimeout(() => window.removeEventListener('click', swallowClick, { capture: true }), 0)
        }
        frame.style.width = restore.frameWidth
        frame.style.opacity = restore.opacity
        cropGhost?.remove()
        if (img) {
          img.style.width = restore.imgWidth
          img.style.height = restore.imgHeight
        }
        if (!commit || !moved || readEditorText() !== text) return
        if (mode === 'move') {
          const target = blockLineAt(scroller, up.clientX, up.clientY)
          if (target === null) return
          apply(text, moveImage(text, image, target, alignmentAt(scroller, up.clientX)))
          return
        }
        if (mode === 'crop') {
          apply(text, reshapeImage(text, image, { ...image.layout, inset }))
          return
        }
        const layout: ImageLayout = mode === 'resize-locked'
          ? { ...image.layout, width: lengthIn(size.width, image.layout.width?.unit, frame, 'width'), height: null }
          : {
              ...image.layout,
              width: lengthIn(size.width, image.layout.width?.unit, frame, 'width'),
              height: lengthIn(size.height, image.layout.height?.unit ?? (image.layout.width?.unit === 'px' ? 'px' : 'em'), frame, 'height'),
            }
        apply(text, reshapeImage(text, image, layout))
      }
      const handleUp = (up: PointerEvent) => finish(up, true)
      const handleCancel = (cancel: PointerEvent) => finish(cancel, false)
      frame.addEventListener('pointermove', handleMove)
      frame.addEventListener('pointerup', handleUp)
      frame.addEventListener('pointercancel', handleCancel)
      frame.addEventListener('lostpointercapture', handleCancel)
    }
    // Ctrl + right-click on an image is a gesture, never a menu.
    const handleContextMenu = (event: MouseEvent) => {
      if (event.ctrlKey && event.target instanceof Element && event.target.closest('.markdown-image-frame[data-image-line]')) event.preventDefault()
    }
    const swallowClick = (click: MouseEvent) => {
      click.preventDefault()
      click.stopPropagation()
    }

    const isImageDrag = (event: DragEvent) => Array.from(event.dataTransfer?.items ?? []).some((item) => item.kind === 'file')
      || Boolean(event.dataTransfer?.types.includes(IMAGE_DRAG_MIME_TYPE))
    const handleDragOver = (event: DragEvent) => {
      if (!isImageDrag(event)) return
      event.preventDefault()
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
    }
    const handleDrop = (event: DragEvent) => {
      // An image card from the library: already stored, so only referenced.
      const libraryImageId = event.dataTransfer?.getData(IMAGE_DRAG_MIME_TYPE)
      if (libraryImageId) {
        event.preventDefault()
        event.stopPropagation()
        const line = blockLineAt(scroller, event.clientX, event.clientY)
        if (line === null) return
        const text = readEditorText()
        apply(text, insertAtBlockStart(text, line, imageMarkdown('', libraryImageId)))
        return
      }
      const files = Array.from(event.dataTransfer?.files ?? []).filter(isImageFile)
      if (files.length === 0) return
      event.preventDefault()
      event.stopPropagation()
      const line = blockLineAt(scroller, event.clientX, event.clientY)
      if (line === null) return
      const droppedOn = noteRef.current
      const textAtDrop = readEditorText()
      void importImageFilesAsMarkdown(files).then((markdown) => {
        // Stored either way; inserted only where it was dropped: the same
        // note, still editable, its text unchanged (the line may have moved).
        if (!markdown || noteRef.current !== droppedOn || !canEditRef.current || readEditorText() !== textAtDrop) return
        apply(textAtDrop, insertAtBlockStart(textAtDrop, line, markdown))
      })
    }

    scroller.addEventListener('pointerdown', handlePointerDown, { capture: true })
    scroller.addEventListener('contextmenu', handleContextMenu)
    scroller.addEventListener('dragover', handleDragOver)
    scroller.addEventListener('drop', handleDrop)
    return () => {
      scroller.removeEventListener('contextmenu', handleContextMenu)
      scroller.removeEventListener('pointerdown', handlePointerDown, { capture: true })
      scroller.removeEventListener('dragover', handleDragOver)
      scroller.removeEventListener('drop', handleDrop)
    }
  }, [activeNoteHasDebugTagRef, adapterRef, canEdit, readEditorText, scrollerRef, activeNoteId])
}

/**
 * What a crop drag shows: the image keeps its place in the layout, hidden, so
 * the text does not move, and a copy laid over it -- out of the flow, at the
 * displayed scale -- is cut to the inset being dragged, border and all. The
 * edges move and the picture does not. Release removes the copy and the real
 * image is drawn at the committed inset.
 *
 * The copy is a child of the frame, so it sits in the same stacking context
 * and under the same scene filter as the image; `visibility: visible` on it
 * overrides the frame's `hidden`.
 */
function createCropGhost(frame: HTMLElement, img: HTMLImageElement, startInset: ImageInset) {
  const frameStyle = getComputedStyle(frame)
  const restore = { position: frame.style.position, overflow: frame.style.overflow, visibility: frame.style.visibility }
  // Positioned first, so the image's offsets below are measured from the frame.
  if (frameStyle.position === 'static') frame.style.position = 'relative'
  const keptX = (100 - startInset.left - startInset.right) / 100
  const keptY = (100 - startInset.top - startInset.bottom) / 100
  // The whole image at the displayed scale, in the frame's coordinates.
  const fullWidth = img.offsetWidth / keptX
  const fullHeight = img.offsetHeight / keptY
  const fullLeft = img.offsetLeft - fullWidth * startInset.left / 100
  const fullTop = img.offsetTop - fullHeight * startInset.top / 100
  const box = document.createElement('div')
  Object.assign(box.style, {
    position: 'absolute',
    overflow: 'hidden',
    visibility: 'visible',
    boxSizing: 'content-box',
    border: frameStyle.border,
    borderRadius: frameStyle.borderRadius,
    pointerEvents: 'none',
  })
  const copy = document.createElement('img')
  copy.src = img.currentSrc || img.src
  copy.alt = ''
  Object.assign(copy.style, {
    position: 'absolute',
    display: 'block',
    maxWidth: 'none',
    width: `${fullWidth}px`,
    height: `${fullHeight}px`,
    filter: getComputedStyle(img).filter,
  })
  box.appendChild(copy)
  frame.style.overflow = 'visible'
  frame.style.visibility = 'hidden'
  frame.appendChild(box)
  // Offsets inside the frame are measured from its padding box; the copy's
  // border sits outside its own box, so it is drawn where the frame's was.
  const borderLeft = parseFloat(frameStyle.borderLeftWidth) || 0
  const borderTop = parseFloat(frameStyle.borderTopWidth) || 0
  const show = (inset: ImageInset) => {
    const left = fullLeft + fullWidth * inset.left / 100
    const top = fullTop + fullHeight * inset.top / 100
    box.style.left = `${left - borderLeft}px`
    box.style.top = `${top - borderTop}px`
    box.style.width = `${fullWidth * (100 - inset.left - inset.right) / 100}px`
    box.style.height = `${fullHeight * (100 - inset.top - inset.bottom) / 100}px`
    copy.style.left = `${fullLeft - left}px`
    copy.style.top = `${fullTop - top}px`
  }
  show(startInset)
  return {
    show,
    remove: () => {
      box.remove()
      frame.style.position = restore.position
      frame.style.overflow = restore.overflow
      frame.style.visibility = restore.visibility
    },
  }
}
