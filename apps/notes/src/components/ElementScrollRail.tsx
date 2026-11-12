import { useEffect, useRef, useState, type PointerEvent } from 'react'
import { scrollThumbFor, scrollTopForThumb } from '@thockdown/interaction/scrollTrackGeometry'

/**
 * The app's own scrollbar (the `.thockdown-scroll-rail` the editor, the
 * reader and the sidebar draw), bound to any one scroll box: the thumb
 * follows the box's scroll position and size, a drag of the thumb scrolls
 * it, and a press on the track puts the thumb's middle under the pointer and
 * goes on dragging from there. The box itself hides its native scrollbar
 * (`.thockdown-custom-scrollbar`).
 *
 * For a scroll box with nothing else to coordinate. The editor and the
 * reader keep their own rails, which also carry their row quantization,
 * smooth travel and snapping.
 */
export function ElementScrollRail({ scroller }: { scroller: HTMLElement | null }) {
  const trackRef = useRef<HTMLDivElement | null>(null)
  const thumbRef = useRef<HTMLDivElement | null>(null)
  const geometryRef = useRef({ height: 0 })
  const [isActive, setIsActive] = useState(false)
  const [isDragging, setIsDragging] = useState(false)

  useEffect(() => {
    const track = trackRef.current
    const thumb = thumbRef.current
    if (!scroller || !track || !thumb) return
    let frame: number | null = null
    // Written straight to the thumb's style: a scroll must not render React.
    const sync = () => {
      frame = null
      const next = scrollThumbFor(scroller, track.clientHeight, thumb.offsetWidth)
      geometryRef.current.height = next.height
      thumb.style.top = `${next.top}px`
      thumb.style.height = `${Math.max(0, next.height)}px`
      setIsActive(next.active)
    }
    const schedule = () => { frame ??= requestAnimationFrame(sync) }
    sync()
    scroller.addEventListener('scroll', schedule, { passive: true })
    const observer = new ResizeObserver(schedule)
    observer.observe(scroller)
    observer.observe(track)
    for (const child of Array.from(scroller.children)) observer.observe(child)
    return () => {
      scroller.removeEventListener('scroll', schedule)
      observer.disconnect()
      if (frame !== null) cancelAnimationFrame(frame)
    }
  }, [scroller])

  const dragFrom = (event: PointerEvent<HTMLElement>, grabOffsetPx: number) => {
    const track = trackRef.current
    if (!scroller || !track || event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    const pointerId = event.pointerId
    const capture = event.currentTarget
    capture.setPointerCapture(pointerId)
    setIsDragging(true)
    const moveTo = (clientY: number) => {
      const rect = track.getBoundingClientRect()
      scroller.scrollTop = scrollTopForThumb(scroller, track.clientHeight, geometryRef.current.height, clientY - rect.top - grabOffsetPx)
    }
    moveTo(event.clientY)
    const onMove = (move: globalThis.PointerEvent) => { if (move.pointerId === pointerId) moveTo(move.clientY) }
    const onEnd = (end: globalThis.PointerEvent) => {
      if (end.pointerId !== pointerId) return
      capture.removeEventListener('pointermove', onMove)
      capture.removeEventListener('pointerup', onEnd)
      capture.removeEventListener('pointercancel', onEnd)
      setIsDragging(false)
    }
    capture.addEventListener('pointermove', onMove)
    capture.addEventListener('pointerup', onEnd)
    capture.addEventListener('pointercancel', onEnd)
  }

  return (
    <div className="thockdown-scroll-rail">
      <div
        ref={trackRef}
        className="thockdown-scroll-track"
        onPointerDown={(event) => dragFrom(event, geometryRef.current.height / 2)}
      >
        <div
          ref={thumbRef}
          className={`thockdown-scroll-thumb${isDragging ? ' is-dragging' : ''}${isActive ? '' : ' is-inactive'}`}
          // Grabbed where it was pressed, so the thumb does not jump.
          onPointerDown={(event) => dragFrom(event, event.clientY - event.currentTarget.getBoundingClientRect().top)}
        />
      </div>
    </div>
  )
}
