/**
 * The page's scrollbar: the ONLY way the page scrolls on touch.
 *
 * Nearly everything on the page is a control, many of them dragged (the
 * sliders) or held (channels, soundscapes, slots, the power button), and a
 * finger cannot say whether it means the control or the page. So the page
 * does not scroll under a finger at all (touch-action: none on the
 * scroller, mobile.css) and this bar does the scrolling: drag the thumb, or
 * tap the track to travel there. Every other drag is then the control's
 * alone. A mouse wheel still scrolls, as a wheel cannot be mistaken for a
 * control.
 *
 * It is the desktop's scrollbar -- its track and thumb (the thumb padded
 * inside the track) and the shared thumb arithmetic in scrollTrackGeometry.ts
 * -- driven by pointer events so a finger works the same as a mouse. Being
 * the page's only scroll, it is worked from its WHOLE COLUMN, not the thin
 * track drawn in the middle of it: a press level with the thumb grabs it,
 * anywhere else travels there, so a finger does not have to land on a few
 * pixels to scroll.
 */
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import { scrollThumbFor, scrollTopForThumb } from '@thockdown/interaction/scrollTrackGeometry'
import { scrollToNonQuantizedSmooth } from '@thockdown/interaction/NonQuantizedSmoothScroll'

export function PageScrollbar({ scrollerRef }: { scrollerRef: RefObject<HTMLElement | null> }) {
  const trackRef = useRef<HTMLDivElement | null>(null)
  const thumbRef = useRef<HTMLDivElement | null>(null)
  const thumbHeightRef = useRef(0)
  const dragRef = useRef<{ pointerId: number; pointerY: number; thumbTop: number } | null>(null)
  const [active, setActive] = useState(false)
  const [dragging, setDragging] = useState(false)

  // The thumb's position is written to the DOM directly: a scroll event per
  // frame through React state would re-render the page every frame.
  const sync = useCallback(() => {
    const scroller = scrollerRef.current
    const track = trackRef.current
    const thumb = thumbRef.current
    if (!scroller || !track || !thumb) return
    const next = scrollThumbFor(scroller, track.clientHeight, thumb.offsetWidth)
    thumbHeightRef.current = next.height
    thumb.style.top = `${next.top}px`
    thumb.style.height = `${next.height}px`
    setActive(next.active)
  }, [scrollerRef])

  useEffect(() => {
    const scroller = scrollerRef.current
    if (!scroller) return undefined
    sync()
    scroller.addEventListener('scroll', sync, { passive: true })
    // The content grows and shrinks (a channel's controls, the schedule), and
    // the window turns: either changes the thumb without a scroll.
    const observer = new ResizeObserver(sync)
    observer.observe(scroller)
    for (const child of Array.from(scroller.children)) observer.observe(child)
    return () => {
      scroller.removeEventListener('scroll', sync)
      observer.disconnect()
    }
  }, [scrollerRef, sync])

  const endDrag = () => {
    dragRef.current = null
    setDragging(false)
  }

  return (
    <aside
      className="mobile-scrollbar-slot"
      aria-hidden="true"
      onPointerDown={(event) => {
        const scroller = scrollerRef.current
        const track = trackRef.current
        const thumb = thumbRef.current
        if (!scroller || !track || !thumb || !active) return
        event.preventDefault()
        const trackTop = track.getBoundingClientRect().top
        const y = event.clientY - trackTop
        if (y >= thumb.offsetTop && y <= thumb.offsetTop + thumb.offsetHeight) {
          // Level with the thumb: grab it.
          event.currentTarget.setPointerCapture(event.pointerId)
          dragRef.current = { pointerId: event.pointerId, pointerY: event.clientY, thumbTop: thumb.offsetTop }
          setDragging(true)
          return
        }
        // Anywhere else in the column: travel so the thumb is centred there.
        scrollToNonQuantizedSmooth(scroller, scrollTopForThumb(scroller, track.clientHeight, thumbHeightRef.current, y - (thumbHeightRef.current / 2)))
      }}
      onPointerMove={(event) => {
        const drag = dragRef.current
        const scroller = scrollerRef.current
        const track = trackRef.current
        if (!drag || drag.pointerId !== event.pointerId || !scroller || !track) return
        scroller.scrollTop = scrollTopForThumb(scroller, track.clientHeight, thumbHeightRef.current, drag.thumbTop + (event.clientY - drag.pointerY))
      }}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    >
      <div className="thockdown-scroll-rail mobile-scroll-rail">
        <div ref={trackRef} className="thockdown-scroll-track">
          <div
            ref={thumbRef}
            className={`thockdown-scroll-thumb${dragging ? ' is-dragging' : ''}${active ? '' : ' is-inactive'}`}
          />
        </div>
      </div>
    </aside>
  )
}
