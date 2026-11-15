import { useCallback, useState, type DragEvent, type PointerEvent } from 'react'
import { armPointerDrag, DRAG_PICTURE_ATTRIBUTE, DRAG_SOURCE_ATTRIBUTE } from './pointerDrag'

/**
 * What a selector cell needs to be dragged within its selector
 * (the desktop's `SelectorRows`, the phone's presets grid): the press that arms the drag (`pointerDrag.ts`,
 * which a cell with a press handler of its own calls from it), and the
 * attributes and handlers that make it a source and a drop target. The
 * picture is carried on the cursor rather than as a copy of the cell, because
 * the selector's window clips everything inside it, a copy included.
 */
export interface SelectorReorderCell {
  onPointerDown: (event: PointerEvent<HTMLElement>) => void
  props: {
    [DRAG_SOURCE_ATTRIBUTE]: ''
    [DRAG_PICTURE_ATTRIBUTE]?: 'cursor'
    'data-drag-state'?: 'source' | 'target'
    onDragStart: (event: DragEvent<HTMLElement>) => void
    onDragOver: (event: DragEvent<HTMLElement>) => void
    onDrop: (event: DragEvent<HTMLElement>) => void
    onDragEnd: () => void
  }
}

/** The DataTransfer type a selector's drag carries its cell's id under: another surface may accept it as a drop (the phone's schedule takes a soundscape this way). */
export function selectorDragType(scope: string): string {
  return `application/x-thockdown-selector-${scope}`
}

/**
 * DRAG TO REORDER a selector's cells, by id. A drop on a cell calls
 * `onMove(dragged, target)`, which moves the dragged entry to the target's
 * place the way every reorder in the app does: further on, the target and
 * everything between move towards the start; further back, towards the end.
 * `scope` keeps two selectors' drags apart, as a type on the DataTransfer.
 *
 * `picture`: `cursor` carries the picture on the cursor (the desktop's
 * selector window clips a copy); `copy` drags a copy of the cell under the
 * finger, for a host with no cursor to carry it (the phone). `onStart` runs
 * as the drag begins.
 */
export function useSelectorReorder(
  scope: string,
  onMove: (draggedId: string, targetId: string) => void,
  { picture = 'cursor', onStart }: { picture?: 'cursor' | 'copy'; onStart?: () => void } = {},
): (id: string) => SelectorReorderCell {
  const type = selectorDragType(scope)
  const [drag, setDrag] = useState<{ source: string; target: string | null } | null>(null)

  const end = useCallback(() => setDrag(null), [])

  return (id: string): SelectorReorderCell => ({
    onPointerDown: armPointerDrag,
    props: {
      [DRAG_SOURCE_ATTRIBUTE]: '',
      ...(picture === 'cursor' ? { [DRAG_PICTURE_ATTRIBUTE]: 'cursor' as const } : {}),
      'data-drag-state': drag?.source === id ? 'source' : drag?.target === id ? 'target' : undefined,
      onDragStart: (event) => {
        event.dataTransfer?.setData(type, id)
        if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'
        setDrag({ source: id, target: null })
        onStart?.()
      },
      onDragOver: (event) => {
        if (!event.dataTransfer?.types.includes(type)) return
        event.preventDefault()
        event.dataTransfer.dropEffect = 'move'
        setDrag((current) => (current && current.target !== id ? { ...current, target: id } : current))
      },
      onDrop: (event) => {
        const dragged = event.dataTransfer?.getData(type)
        if (!dragged) return
        event.preventDefault()
        onMove(dragged, id)
        end()
      },
      onDragEnd: end,
    },
  })
}
