import { useEffect, useRef, type MutableRefObject } from 'react'
import { useCanonicalScroller } from '../editorSection/useCanonicalScroller'

/**
 * The app's scrollbar (`.thockdown-scroll-rail`) for a scroll box that is
 * not the reader: the image shown in a slot, the sidebar. It is the reader's
 * scroller (`useCanonicalScroller`) whole, so the thumb, a track press, a
 * right-hold on the track, the wheel's notches and coast and, where the box
 * holds the keyboard, PageUp/PageDown behave identically everywhere.
 *
 * The hook binds its listeners to the element its ref holds when it mounts,
 * so a caller whose box can be replaced (the sidebar's scroller changes with
 * its view) gives this component a `key` that changes with the element.
 */
export function CanonicalScrollRail({
  scroller,
  ownsKeyboard,
  layoutKey,
  textureRef,
  className,
  thumbLabel,
}: {
  scroller: HTMLElement | null
  /** Whether PageUp/PageDown from the keyboard scroll this box. */
  ownsKeyboard: boolean
  /** Changes whenever the box's content may have changed size. */
  layoutKey: string
  /** A texture layer that scrolls with the box, when it has one. */
  textureRef?: MutableRefObject<HTMLDivElement | null>
  className?: string
  /** Text drawn on the thumb, centred (a paged list's page number). */
  thumbLabel?: string
}) {
  const scrollerRef = useRef<HTMLElement | null>(scroller)
  scrollerRef.current = scroller
  const {
    scrollbarTrackRef,
    scrollbarThumbRef,
    isThumbActive,
    isDraggingThumb,
    syncScrollbar,
    handleTrackPointerDown,
    handleTrackContextMenu,
    handleThumbPointerDown,
  } = useCanonicalScroller({
    isEnabled: scroller !== null,
    scrollerRef,
    ownsKeyboard,
    layoutKey,
    textureRef,
  })

  useEffect(() => { syncScrollbar() }, [scroller, layoutKey, syncScrollbar])

  return (
    <div className={`thockdown-scroll-rail${className ? ` ${className}` : ''}`}>
      <div
        ref={scrollbarTrackRef}
        className="thockdown-scroll-track"
        onPointerDown={handleTrackPointerDown}
        data-secondary-press="action"
        onContextMenu={handleTrackContextMenu}
      >
        <div
          ref={scrollbarThumbRef}
          className={`thockdown-scroll-thumb${isDraggingThumb ? ' is-dragging' : ''}${isThumbActive ? '' : ' is-inactive'}`}
          onPointerDown={handleThumbPointerDown}
        >
          {thumbLabel ? <span className="thockdown-scroll-thumb-label">{thumbLabel}</span> : null}
        </div>
      </div>
    </div>
  )
}
