import { useCallback, useState, type DragEvent, type PointerEvent } from 'react'
import { armPointerDrag, DRAG_PICTURE_ATTRIBUTE, DRAG_SOURCE_ATTRIBUTE } from '../shared/pointerDrag'

/**
 * What a selector cell needs to be dragged within its selector
 * (`SelectorRows`): the press that arms the drag (`shared/pointerDrag.ts`,
 * which a cell with a press handler of its own calls from it), and the
 * attributes and handlers that make it a source and a drop target. The
 * picture is carried on the cursor rather than as a copy of the cell, because
 * the selector's window clips everything inside it, a copy included.
 */
export interface SelectorReorderCell {
  onPointerDown: (event: PointerEvent<HTMLElement>) => void
  props: {
    [DRAG_SOURCE_ATTRIBUTE]: ''
    [DRAG_PICTURE_ATTRIBUTE]: 'cursor'
    'data-drag-state'?: 'source' | 'target'
    onDragStart: (event: DragEvent<HTMLElement>) => void
    onDragOver: (event: DragEvent<HTMLElement>) => void
    onDrop: (event: DragEvent<HTMLElement>) => void
    onDragEnd: () => void
  }
}

/**
 * DRAG TO REORDER a selector's cells, by id. A drop on a cell calls
 * `onMove(dragged, target)`, which moves the dragged entry to the target's
 * place the way every reorder in the app does: further on, the target and
 * everything between move towards the start; further back, towards the end.
 * `scope` keeps two selectors' drags apart, as a type on the DataTransfer.
 */
export function useSelectorReorder(scope: string, onMove: (draggedId: string, targetId: string) => void): (id: string) => SelectorReorderCell {
  const type = `application/x-thockdown-selector-${scope}`
  const [drag, setDrag] = useState<{ source: string; target: string | null } | null>(null)

  const end = useCallback(() => setDrag(null), [])

  return (id: string): SelectorReorderCell => ({
    onPointerDown: armPointerDrag,
    props: {
      [DRAG_SOURCE_ATTRIBUTE]: '',
      [DRAG_PICTURE_ATTRIBUTE]: 'cursor',
      'data-drag-state': drag?.source === id ? 'source' : drag?.target === id ? 'target' : undefined,
      onDragStart: (event) => {
        event.dataTransfer?.setData(type, id)
        if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'
        setDrag({ source: id, target: null })
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
