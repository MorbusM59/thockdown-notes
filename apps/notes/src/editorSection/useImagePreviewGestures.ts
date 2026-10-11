import { useEffect, useRef, type MutableRefObject, type RefObject } from 'react'
import type { EditorAdapter } from '../editor/EditorContract'
import { insertAtBlockStart, locateImage, moveImage, reshapeImage, sameAlt, type ImageEdit } from '../editor/ImagePlacement'
import type { ImageAlignment, ImageLength, ImageLayout } from '../shared/imageLayout'
import { isImageFile } from '../shared/images'
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
//
// and dropping image files onto a block stores them and puts them at its
// start. Without a modifier the pointer does what it always does there.
//
// Each gesture ends in one edit of the note's text (ImagePlacement.ts),
// applied through the editor so it is one undo step and is saved like
// typing; the render view then redraws from the text. While a resize is
// under way the frame is sized directly, so the reader sees what they will
// get; nothing is written until the button is released.

const DRAG_START_PX = 3

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
      if (event.button !== 0 || !(event.ctrlKey || event.shiftKey)) return
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

      const mode: 'move' | 'resize-locked' | 'resize-free' = !event.shiftKey ? 'move' : event.ctrlKey ? 'resize-free' : 'resize-locked'
      const start = { x: event.clientX, y: event.clientY }
      const startRect = (img ?? frame).getBoundingClientRect()
      const ratio = startRect.height > 0 ? startRect.width / startRect.height : 1
      let moved = false
      let size = { width: startRect.width, height: startRect.height }
      const restore = { frameWidth: frame.style.width, imgWidth: img?.style.width ?? '', imgHeight: img?.style.height ?? '', opacity: frame.style.opacity, objectFit: img?.style.objectFit ?? '' }
      frame.setPointerCapture(event.pointerId)

      const handleMove = (move: PointerEvent) => {
        const dy = move.clientY - start.y
        if (!moved && Math.hypot(move.clientX - start.x, dy) < DRAG_START_PX) return
        const dx = widthGrowth(image.layout.align, start.x, move.clientX, startRect.left + startRect.width / 2)
        moved = true
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
          if (mode === 'resize-free') img.style.objectFit = 'contain'
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
        if (img) {
          img.style.width = restore.imgWidth
          img.style.height = restore.imgHeight
          img.style.objectFit = restore.objectFit
        }
        if (!commit || !moved || readEditorText() !== text) return
        if (mode === 'move') {
          const target = blockLineAt(scroller, up.clientX, up.clientY)
          if (target === null) return
          apply(text, moveImage(text, image, target, alignmentAt(scroller, up.clientX)))
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
    const swallowClick = (click: MouseEvent) => {
      click.preventDefault()
      click.stopPropagation()
    }

    const isImageDrag = (event: DragEvent) => Array.from(event.dataTransfer?.items ?? []).some((item) => item.kind === 'file')
    const handleDragOver = (event: DragEvent) => {
      if (!isImageDrag(event)) return
      event.preventDefault()
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
    }
    const handleDrop = (event: DragEvent) => {
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
    scroller.addEventListener('dragover', handleDragOver)
    scroller.addEventListener('drop', handleDrop)
    return () => {
      scroller.removeEventListener('pointerdown', handlePointerDown, { capture: true })
      scroller.removeEventListener('dragover', handleDragOver)
      scroller.removeEventListener('drop', handleDrop)
    }
  }, [activeNoteHasDebugTagRef, adapterRef, canEdit, readEditorText, scrollerRef, activeNoteId])
}
