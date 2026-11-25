import { useCallback, useRef } from 'react'
import { registerDragLayer } from './dragLayer'

/**
 * The app's drag layer (dragLayer.ts): mount once, inside
 * `.app-saturate-wrapper`, as the tooltip layer is.
 */
export function DragLayer() {
  const unregister = useRef<(() => void) | null>(null)
  const ref = useCallback((element: HTMLDivElement | null) => {
    unregister.current?.()
    unregister.current = element ? registerDragLayer(element) : null
  }, [])
  return <div ref={ref} className="drag-layer" aria-hidden="true" />
}
