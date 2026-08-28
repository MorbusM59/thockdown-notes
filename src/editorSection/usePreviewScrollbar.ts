import { useCallback, useEffect, useRef, useState } from 'react'
import type { MouseEvent, MutableRefObject } from 'react'
import type { PreviewDocumentPositionApi } from './usePreviewMarkdownRendering'
import { beginScrollTrackHold } from '../editor/scrollTrackHold'
import {
  buildReleaseRampDownPlanFromCurrentParams,
  cancelNonQuantizedSmoothScroll,
  CONTINUOUS_SCROLL_APEX_SPEED_MULTIPLIER,
  resolveApexSpeedPxPerSecFromCurrentParams,
  sampleReleaseRampDownPlan,
  resolveRampCrossingTimeSecFromCurrentParams,
  scrollToNonQuantizedSmooth,
} from '../editor/NonQuantizedSmoothScroll'

type ViewStyleKey =
  | 'modern'
  | 'narrow'
  | 'cute'
  | 'xkcd'
  | 'print'
  | 'calibrilight'
  | 'opensans'
  | 'notoserif'
  | 'neuton'
  | 'faunaone'
  | 'fredericka'
  | 'bubblerone'
const SCROLL_TRACK_MIN_THUMB_HEIGHT_PX = 28
const SCROLL_TRACK_EDGE_GAP_PX = 3
const PREVIEW_CONTINUOUS_SCROLL_APEX_MULTIPLIER = CONTINUOUS_SCROLL_APEX_SPEED_MULTIPLIER

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

const syncTextureToScroll = (scrollTop: number, maskEl: HTMLElement) => {
  maskEl.style.maskPosition = `0 ${-scrollTop}px`;
  maskEl.style.webkitMaskPosition = `0 ${-scrollTop}px`;
};

export interface UsePreviewScrollbarOptions {
  isPreviewMode: boolean
  isPreviewScrollInteractionBlocked?: () => boolean
  previewScrollRef: MutableRefObject<HTMLDivElement | null>
  /**
   * Whether this section is the one the reader is working in.
   *
   * The page-key listener below is on the window, so in split view every
   * preview pane would otherwise answer the same keypress and both would page
   * at once. Only the active section's does.
   */
  isSectionActive?: boolean
  /**
   * The preview's position in character space, published by
   * usePreviewMarkdownRendering. When present the thumb's POSITION is driven
   * from it rather than from pixels -- see previewCharPosition.ts. Optional,
   * and null until the preview has blocks, so every path here still has to
   * work on the pixel mapping alone.
   */
  previewDocumentPositionRef?: MutableRefObject<PreviewDocumentPositionApi | null>
  activeNoteId: string | null
  currentEditorText: string
  viewStyle: ViewStyleKey
  viewFontSize: number
  viewSpacing: number
  viewLetterSpacingEm: number
}

/**
 * Custom preview scrollbar (direct-DOM thumb sync + drag), PageUp/PageDown
 * continuous-scroll-with-momentum-release, and the native-scroll texture
 * sync -- extracted verbatim from App.tsx with zero behavior change. Direct
 * DOM mutation instead of React state is deliberate: per-frame scroll events
 * would otherwise re-render the entire App component on every tick.
 */
export function usePreviewScrollbar({
  isPreviewMode,
  isPreviewScrollInteractionBlocked,
  previewScrollRef,
  isSectionActive = true,
  previewDocumentPositionRef,
  activeNoteId,
  currentEditorText,
  viewStyle,
  viewFontSize,
  viewSpacing,
  viewLetterSpacingEm,
}: UsePreviewScrollbarOptions) {
  const previewTextureRef = useRef<HTMLDivElement>(null)
  const previewScrollbarTrackRef = useRef<HTMLDivElement | null>(null)
  const previewScrollbarRafRef = useRef<number | null>(null)
  const previewScrollbarDragOriginRef = useRef<{ pointerY: number; thumbTopPx: number } | null>(null)
  const previewScrollbarThumbRef = useRef<HTMLDivElement | null>(null)
  const previewScrollThumbTopRef = useRef(0)
  const previewScrollThumbHeightRef = useRef(0)
  const previewContinuousScrollDirectionRef = useRef<-1 | 0 | 1>(0)
  const previewContinuousScrollRafRef = useRef<number | null>(null)
  const previewContinuousScrollLastTsRef = useRef<number | null>(null)
  const previewReleaseRampDownRafRef = useRef<number | null>(null)
  const previewContinuousPreviousScrollBehaviorRef = useRef<string | null>(null)
  const previewPageKeysHeldRef = useRef(new Set<string>())
  const previewContinuousHandoffTimeoutRef = useRef<number | null>(null)
  const previewScrollbarRightHoldRef = useRef<{
    key: 'PageUp' | 'PageDown'
    direction: 1 | -1
    cursorYPx: number
    rafId: number | null
  } | null>(null)
  const trackHoldCancelRef = useRef<(() => void) | null>(null)
  const [isPreviewScrollThumbActive, setIsPreviewScrollThumbActive] = useState(false)
  const [isDraggingPreviewScrollThumb, setIsDraggingPreviewScrollThumb] = useState(false)

  const shouldBlockPreviewInteraction = useCallback(() => {
    if (!isPreviewMode) return true
    return isPreviewScrollInteractionBlocked?.() ?? false
  }, [isPreviewMode, isPreviewScrollInteractionBlocked])

  const applyPreviewThumbDom = useCallback((topPx: number, heightPx: number) => {
    previewScrollThumbTopRef.current = topPx
    previewScrollThumbHeightRef.current = heightPx
    const thumbEl = previewScrollbarThumbRef.current
    if (!thumbEl) return
    thumbEl.style.top = `${topPx}px`
    thumbEl.style.height = `${Math.max(0, heightPx)}px`
  }, [])

  const syncPreviewCustomScrollbar = useCallback((options?: { force?: boolean }) => {
    if (isDraggingPreviewScrollThumb && !options?.force) {
      return
    }

    if (!isPreviewMode) {
      applyPreviewThumbDom(0, 0)
      setIsPreviewScrollThumbActive(false)
      return
    }

    const scroller = previewScrollRef.current
    const track = previewScrollbarTrackRef.current
    if (!scroller) return

    if (previewTextureRef.current) {
      syncTextureToScroll(scroller.scrollTop, previewTextureRef.current)
    }

    if (!track) return

    const viewportHeight = scroller.clientHeight
    const contentHeight = scroller.scrollHeight
    const trackHeight = track.clientHeight
    const usableTrackHeight = Math.max(0, trackHeight - (SCROLL_TRACK_EDGE_GAP_PX * 2))
    if (viewportHeight <= 0 || contentHeight <= 0 || trackHeight <= 0) {
      applyPreviewThumbDom(0, 0)
      setIsPreviewScrollThumbActive(false)
      return
    }

    if (contentHeight <= viewportHeight) {
      applyPreviewThumbDom(SCROLL_TRACK_EDGE_GAP_PX, usableTrackHeight)
      setIsPreviewScrollThumbActive(false)
      return
    }

    const visibleRatio = viewportHeight / contentHeight
    const nextThumbHeight = Math.max(
      SCROLL_TRACK_MIN_THUMB_HEIGHT_PX,
      Math.min(usableTrackHeight, Math.round(usableTrackHeight * visibleRatio)),
    )

    const maxScrollTop = contentHeight - viewportHeight
    const maxThumbTop = Math.max(0, usableTrackHeight - nextThumbHeight)

    // POSITION comes from character space when the preview can supply it: it
    // is exact by construction and, more to the point, it does not move when
    // the layout does. A pixel ratio has the thumb creep while block heights
    // are still being discovered and jump when the reader changes font size,
    // neither of which is a thing the reader did.
    //
    // SIZE stays a pixel ratio deliberately. "How much of the document is on
    // screen" in characters swings with the content -- a screen of dense prose
    // against a screen holding one big code block -- so a character-sized
    // thumb visibly grows and shrinks as you scroll through a mixed document.
    // Position is the half that has to be exact; size only has to be steady.
    const charViewport = previewDocumentPositionRef?.current?.readViewport() ?? null
    const charSpan = charViewport ? charViewport.totalChars - charViewport.visibleChars : 0
    const scrollRatio = charViewport && charSpan > 0
      ? clamp(charViewport.startChar / charSpan, 0, 1)
      : (maxScrollTop > 0 ? scroller.scrollTop / maxScrollTop : 0)
    const nextThumbTop = SCROLL_TRACK_EDGE_GAP_PX + Math.round(maxThumbTop * scrollRatio)

    applyPreviewThumbDom(nextThumbTop, nextThumbHeight)
    setIsPreviewScrollThumbActive(true)
  }, [applyPreviewThumbDom, isDraggingPreviewScrollThumb, isPreviewMode, previewScrollRef, previewDocumentPositionRef])

  const previewScrollFromThumbTop = useCallback((thumbTopPx: number) => {
    const scroller = previewScrollRef.current
    const track = previewScrollbarTrackRef.current
    if (!scroller || !track) return

    const trackHeight = track.clientHeight
    const usableTrackHeight = Math.max(0, trackHeight - (SCROLL_TRACK_EDGE_GAP_PX * 2))
    const maxThumbTravel = Math.max(0, usableTrackHeight - previewScrollThumbHeightRef.current)
    const minThumbTop = SCROLL_TRACK_EDGE_GAP_PX
    const maxThumbTop = SCROLL_TRACK_EDGE_GAP_PX + maxThumbTravel
    const clampedTop = Math.max(minThumbTop, Math.min(thumbTopPx, maxThumbTop))
    applyPreviewThumbDom(clampedTop, previewScrollThumbHeightRef.current)
    const ratio = maxThumbTravel > 0 ? (clampedTop - SCROLL_TRACK_EDGE_GAP_PX) / maxThumbTravel : 0

    // The exact inverse of the reading above, and it has to stay that way:
    // reading position in one space and writing it in another would drop the
    // thumb somewhere other than where it was released.
    const position = previewDocumentPositionRef?.current
    const charViewport = position?.readViewport() ?? null
    if (position && charViewport) {
      const charSpan = Math.max(0, charViewport.totalChars - charViewport.visibleChars)
      position.scrollToChar(ratio * charSpan)
      return
    }

    const maxScrollTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight)
    scroller.scrollTop = ratio * maxScrollTop
  }, [applyPreviewThumbDom, previewScrollRef, previewDocumentPositionRef])

  useEffect(() => {
    if (!isPreviewMode) return
    syncPreviewCustomScrollbar()
  }, [isPreviewMode, syncPreviewCustomScrollbar, activeNoteId, currentEditorText, viewStyle, viewFontSize, viewSpacing, viewLetterSpacingEm])

  useEffect(() => {
    if (!isPreviewMode) return

    const scroller = previewScrollRef.current
    if (!scroller) return

    const onScroll = () => {
      syncPreviewCustomScrollbar()
    }

    scroller.addEventListener('scroll', onScroll, { passive: true })
    return () => scroller.removeEventListener('scroll', onScroll)
  }, [isPreviewMode, syncPreviewCustomScrollbar, previewScrollRef])

  useEffect(() => {
    if (!isPreviewMode) return

    const scroller = previewScrollRef.current
    if (!scroller) return

    const scheduleSync = () => {
      if (previewScrollbarRafRef.current !== null) {
        cancelAnimationFrame(previewScrollbarRafRef.current)
      }

      previewScrollbarRafRef.current = requestAnimationFrame(() => {
        previewScrollbarRafRef.current = null
        syncPreviewCustomScrollbar()
      })
    }

    scheduleSync()
    const previewContentEl = scroller.firstElementChild as HTMLElement | null

    const resizeObserver = new ResizeObserver(() => scheduleSync())
    resizeObserver.observe(scroller)
    if (previewContentEl) {
      resizeObserver.observe(previewContentEl)
    }

    const mutationObserver = new MutationObserver(() => scheduleSync())
    mutationObserver.observe(scroller, {
      subtree: true,
      childList: true,
      characterData: true,
    })

    return () => {
      mutationObserver.disconnect()
      resizeObserver.disconnect()
      if (previewScrollbarRafRef.current !== null) {
        cancelAnimationFrame(previewScrollbarRafRef.current)
        previewScrollbarRafRef.current = null
      }
    }
  }, [isPreviewMode, syncPreviewCustomScrollbar, previewScrollRef])

  useEffect(() => {
    if (!isDraggingPreviewScrollThumb) return

    const onMouseMove = (event: globalThis.MouseEvent) => {
      const origin = previewScrollbarDragOriginRef.current
      if (!origin) return
      const deltaY = event.clientY - origin.pointerY
      previewScrollFromThumbTop(origin.thumbTopPx + deltaY)
    }

    const onMouseUp = () => {
      setIsDraggingPreviewScrollThumb(false)
      previewScrollbarDragOriginRef.current = null
      requestAnimationFrame(() => syncPreviewCustomScrollbar({ force: true }))
    }

    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
    return () => {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }
  }, [isDraggingPreviewScrollThumb, previewScrollFromThumbTop, syncPreviewCustomScrollbar])

  useEffect(() => {
    const scroller = previewScrollRef.current
    if (!scroller) return

    scroller.style.scrollBehavior = isDraggingPreviewScrollThumb ? 'auto' : ''

    return () => {
      scroller.style.scrollBehavior = ''
    }
  }, [isDraggingPreviewScrollThumb, previewScrollRef])

  // Right-click-and-hold on the track pages in the clicked direction for as
  // long as the button is held, exactly like holding PageUp/PageDown -- it's
  // dispatched as a real synthetic KeyboardEvent on window so it reuses the
  // one-shot jump, continuous-hold, and release-ramp logic below verbatim
  // instead of duplicating that curve/timing math here.
  const stopPreviewScrollbarRightHold = useCallback(() => {
    const hold = previewScrollbarRightHoldRef.current
    if (!hold) return
    if (hold.rafId !== null) {
      cancelAnimationFrame(hold.rafId)
    }
    previewScrollbarRightHoldRef.current = null
    window.dispatchEvent(new KeyboardEvent('keyup', { key: hold.key, code: hold.key, bubbles: true, cancelable: true }))
  }, [])

  useEffect(() => {
    const handleWindowMouseUp = (event: globalThis.MouseEvent) => {
      if (event.button === 2) stopPreviewScrollbarRightHold()
    }
    const handleWindowMouseMove = (event: globalThis.MouseEvent) => {
      const hold = previewScrollbarRightHoldRef.current
      const track = previewScrollbarTrackRef.current
      if (!hold || !track) return
      hold.cursorYPx = event.clientY - track.getBoundingClientRect().top
    }
    window.addEventListener('mouseup', handleWindowMouseUp)
    window.addEventListener('mousemove', handleWindowMouseMove)
    return () => {
      window.removeEventListener('mouseup', handleWindowMouseUp)
      window.removeEventListener('mousemove', handleWindowMouseMove)
    }
  }, [stopPreviewScrollbarRightHold])

  useEffect(() => stopPreviewScrollbarRightHold, [stopPreviewScrollbarRightHold])

  const handlePreviewTrackRightMouseDown = useCallback((event: MouseEvent<HTMLDivElement>) => {
    if (shouldBlockPreviewInteraction()) return
    const track = previewScrollbarTrackRef.current
    if (!track) return

    stopPreviewScrollbarRightHold()

    const clickY = event.clientY - track.getBoundingClientRect().top
    const thumbTop = previewScrollThumbTopRef.current
    const thumbBottom = thumbTop + previewScrollThumbHeightRef.current
    if (clickY >= thumbTop && clickY <= thumbBottom) return

    const direction: 1 | -1 = clickY > thumbBottom ? 1 : -1
    const key: 'PageUp' | 'PageDown' = direction === 1 ? 'PageDown' : 'PageUp'

    window.dispatchEvent(new KeyboardEvent('keydown', { key, code: key, bubbles: true, cancelable: true, repeat: false }))

    previewScrollbarRightHoldRef.current = { key, direction, cursorYPx: clickY, rafId: null }

    const watchThumbReachesCursor = () => {
      const hold = previewScrollbarRightHoldRef.current
      if (!hold) return
      const currentTrack = previewScrollbarTrackRef.current
      const scroller = previewScrollRef.current
      if (currentTrack && scroller) {
        const trackHeight = currentTrack.clientHeight
        const usableTrackHeight = Math.max(0, trackHeight - (SCROLL_TRACK_EDGE_GAP_PX * 2))
        const thumbHeightPx = previewScrollThumbHeightRef.current
        const maxThumbTravel = Math.max(0, usableTrackHeight - thumbHeightPx)
        const maxScrollTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight)
        const scrollRatio = maxScrollTop > 0 ? scroller.scrollTop / maxScrollTop : 0
        const currentThumbTop = SCROLL_TRACK_EDGE_GAP_PX + (maxThumbTravel * scrollRatio)
        const currentThumbBottom = currentThumbTop + thumbHeightPx
        const reachedCursor = hold.direction === 1
          ? currentThumbBottom >= hold.cursorYPx
          : currentThumbTop <= hold.cursorYPx
        if (reachedCursor) {
          stopPreviewScrollbarRightHold()
          return
        }
      }
      hold.rafId = requestAnimationFrame(watchThumbReachesCursor)
    }
    previewScrollbarRightHoldRef.current.rafId = requestAnimationFrame(watchThumbReachesCursor)
  }, [previewScrollRef, shouldBlockPreviewInteraction, stopPreviewScrollbarRightHold])

  const handlePreviewTrackContextMenu = useCallback((event: MouseEvent<HTMLDivElement>) => {
    event.preventDefault()
  }, [])

  const handlePreviewTrackMouseDown = useCallback((event: MouseEvent<HTMLDivElement>) => {
    if (shouldBlockPreviewInteraction()) return
    if (event.button === 2) {
      handlePreviewTrackRightMouseDown(event)
      return
    }
    if (event.button !== 0) return

    const track = previewScrollbarTrackRef.current
    const scroller = previewScrollRef.current
    if (!track || !scroller) return

    const rect = track.getBoundingClientRect()
    const clickY = event.clientY - rect.top
    const thumbHeightPx = previewScrollThumbHeightRef.current
    const targetThumbTop = clickY - (thumbHeightPx / 2)

    const trackHeight = track.clientHeight
    const usableTrackHeight = Math.max(0, trackHeight - (SCROLL_TRACK_EDGE_GAP_PX * 2))
    const maxThumbTravel = Math.max(0, usableTrackHeight - thumbHeightPx)
    const minThumbTop = SCROLL_TRACK_EDGE_GAP_PX
    const maxThumbTop = SCROLL_TRACK_EDGE_GAP_PX + maxThumbTravel
    const clampedTop = Math.max(minThumbTop, Math.min(targetThumbTop, maxThumbTop))
    const ratio = maxThumbTravel > 0 ? (clampedTop - SCROLL_TRACK_EDGE_GAP_PX) / maxThumbTravel : 0

    // Same character mapping as the thumb drag. Clicking the track at 30% and
    // dragging the thumb to 30% have to mean the same thing -- they are the
    // same gesture to the reader -- and until this was routed here they did
    // not: the click resolved against pixels, so on a document with uneven
    // content density the two landed in different places, and on one still
    // being sized up they landed VERY differently (measured: a click at 30%
    // on a just-opened note went to 13% of the text).
    const goTo = (instant: boolean) => {
      const element = previewScrollRef.current
      if (!element) return
      const position = previewDocumentPositionRef?.current
      const charViewport = position?.readViewport() ?? null
      if (position && charViewport) {
        const charSpan = Math.max(0, charViewport.totalChars - charViewport.visibleChars)
        const charTarget = ratio * charSpan
        if (instant) position.scrollToChar(charTarget)
        else position.smoothScrollToChar(charTarget)
        return
      }

      const maxScrollTop = Math.max(0, element.scrollHeight - element.clientHeight)
      const targetScrollTop = ratio * maxScrollTop
      if (instant) {
        cancelNonQuantizedSmoothScroll(element)
        const previousBehavior = element.style.scrollBehavior
        element.style.scrollBehavior = 'auto'
        element.scrollTop = targetScrollTop
        element.style.scrollBehavior = previousBehavior
        return
      }
      scrollToNonQuantizedSmooth(element, targetScrollTop)
    }

    // Click travels, hold snaps -- see scrollTrackHold.ts. Resolved on a timer
    // while the button is still down, so the gesture teaches itself.
    trackHoldCancelRef.current?.()
    trackHoldCancelRef.current = beginScrollTrackHold({
      onSnap: () => { trackHoldCancelRef.current = null; goTo(true) },
      onTravel: () => { trackHoldCancelRef.current = null; goTo(false) },
    })
  }, [previewScrollRef, shouldBlockPreviewInteraction, handlePreviewTrackRightMouseDown, previewDocumentPositionRef])

  // A gesture in flight when this unmounts would otherwise fire its snap into
  // a torn-down pane.
  useEffect(() => () => { trackHoldCancelRef.current?.() }, [])

  const handlePreviewThumbMouseDown = useCallback((event: MouseEvent<HTMLDivElement>) => {
    if (shouldBlockPreviewInteraction()) return
    if (event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    const scroller = previewScrollRef.current
    if (scroller) {
      scroller.style.scrollBehavior = 'auto'
    }
    setIsDraggingPreviewScrollThumb(true)
    previewScrollbarDragOriginRef.current = {
      pointerY: event.clientY,
      thumbTopPx: previewScrollThumbTopRef.current,
    }
  }, [previewScrollRef, shouldBlockPreviewInteraction])

  const stopPreviewContinuousScroll = useCallback(() => {
    previewContinuousScrollDirectionRef.current = 0
    previewContinuousScrollLastTsRef.current = null
    if (previewContinuousScrollRafRef.current !== null) {
      cancelAnimationFrame(previewContinuousScrollRafRef.current)
      previewContinuousScrollRafRef.current = null
    }
    if (previewReleaseRampDownRafRef.current !== null) {
      cancelAnimationFrame(previewReleaseRampDownRafRef.current)
      previewReleaseRampDownRafRef.current = null
    }

    const scroller = previewScrollRef.current
    if (scroller && previewContinuousPreviousScrollBehaviorRef.current !== null) {
      scroller.style.scrollBehavior = previewContinuousPreviousScrollBehaviorRef.current
      previewContinuousPreviousScrollBehaviorRef.current = null
    }
  }, [previewScrollRef])

  const clearPreviewContinuousHandoff = useCallback(() => {
    if (previewContinuousHandoffTimeoutRef.current !== null) {
      window.clearTimeout(previewContinuousHandoffTimeoutRef.current)
      previewContinuousHandoffTimeoutRef.current = null
    }
  }, [])

  const runPreviewContinuousScroll = useCallback((nowMs: number) => {
    const direction = previewContinuousScrollDirectionRef.current
    if (direction === 0) {
      previewContinuousScrollRafRef.current = null
      previewContinuousScrollLastTsRef.current = null
      return
    }

    const scroller = previewScrollRef.current
    if (!scroller || !isPreviewMode) {
      previewContinuousScrollDirectionRef.current = 0
      previewContinuousScrollRafRef.current = null
      previewContinuousScrollLastTsRef.current = null
      return
    }

    const previousTs = previewContinuousScrollLastTsRef.current
    previewContinuousScrollLastTsRef.current = nowMs
    if (previousTs !== null) {
      const deltaSec = Math.max(0, (nowMs - previousTs) / 1000)
      const speedPxPerSec = Math.max(
        1,
        resolveApexSpeedPxPerSecFromCurrentParams(scroller.clientHeight * 0.9)
          * PREVIEW_CONTINUOUS_SCROLL_APEX_MULTIPLIER,
      )
      const maxScrollTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight)
      const nextScrollTop = clamp(
        scroller.scrollTop + (direction * speedPxPerSec * deltaSec),
        0,
        maxScrollTop,
      )

      if (Math.abs(nextScrollTop - scroller.scrollTop) > 0.01) {
        scroller.scrollTop = nextScrollTop
        syncPreviewCustomScrollbar()
      }

      const hitBoundary = (direction < 0 && nextScrollTop <= 0.01)
        || (direction > 0 && nextScrollTop >= maxScrollTop - 0.01)
      if (hitBoundary) {
        previewContinuousScrollDirectionRef.current = 0
        previewContinuousScrollRafRef.current = null
        previewContinuousScrollLastTsRef.current = null
        return
      }
    }

    previewContinuousScrollRafRef.current = requestAnimationFrame(runPreviewContinuousScroll)
  }, [isPreviewMode, syncPreviewCustomScrollbar, previewScrollRef])

  const startPreviewReleaseRampDown = useCallback((direction: -1 | 1) => {
    if (!isPreviewMode) {
      stopPreviewContinuousScroll()
      return
    }

    const scroller = previewScrollRef.current
    if (!scroller) {
      stopPreviewContinuousScroll()
      return
    }

    const releaseSpeedPxPerSec = Math.max(
      1,
      resolveApexSpeedPxPerSecFromCurrentParams(scroller.clientHeight * 0.9)
        * PREVIEW_CONTINUOUS_SCROLL_APEX_MULTIPLIER,
    )
    const rampDownPlan = buildReleaseRampDownPlanFromCurrentParams(direction, releaseSpeedPxPerSec)
    if (!rampDownPlan) {
      stopPreviewContinuousScroll()
      return
    }

    if (previewContinuousScrollRafRef.current !== null) {
      cancelAnimationFrame(previewContinuousScrollRafRef.current)
      previewContinuousScrollRafRef.current = null
    }
    previewContinuousScrollDirectionRef.current = 0
    previewContinuousScrollLastTsRef.current = null

    if (previewReleaseRampDownRafRef.current !== null) {
      cancelAnimationFrame(previewReleaseRampDownRafRef.current)
      previewReleaseRampDownRafRef.current = null
    }

    if (previewContinuousPreviousScrollBehaviorRef.current === null) {
      previewContinuousPreviousScrollBehaviorRef.current = scroller.style.scrollBehavior
    }
    scroller.style.scrollBehavior = 'auto'

    const startScrollTop = scroller.scrollTop
    const maxScrollTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight)
    let startMs: number | null = null

    const animateRampDown = (nowMs: number) => {
      if (!isPreviewMode) {
        stopPreviewContinuousScroll()
        return
      }

      if (startMs === null) {
        startMs = nowMs
      }

      const elapsedSec = Math.max(0, (nowMs - startMs) / 1000)
      const displacement = sampleReleaseRampDownPlan(rampDownPlan, elapsedSec)
      const nextScrollTop = clamp(startScrollTop + displacement, 0, maxScrollTop)

      if (Math.abs(nextScrollTop - scroller.scrollTop) > 0.01) {
        scroller.scrollTop = nextScrollTop
        syncPreviewCustomScrollbar()
      }

      const hitBoundary = nextScrollTop <= 0.01 || nextScrollTop >= maxScrollTop - 0.01
      if (elapsedSec >= rampDownPlan.tailDurationSec || hitBoundary) {
        previewReleaseRampDownRafRef.current = null
        if (previewContinuousPreviousScrollBehaviorRef.current !== null) {
          scroller.style.scrollBehavior = previewContinuousPreviousScrollBehaviorRef.current
          previewContinuousPreviousScrollBehaviorRef.current = null
        }
        return
      }

      previewReleaseRampDownRafRef.current = requestAnimationFrame(animateRampDown)
    }

    previewReleaseRampDownRafRef.current = requestAnimationFrame(animateRampDown)
  }, [isPreviewMode, stopPreviewContinuousScroll, syncPreviewCustomScrollbar, previewScrollRef])

  const startPreviewContinuousScroll = useCallback((direction: -1 | 1) => {
    if (!isPreviewMode) return
    const scroller = previewScrollRef.current
    if (!scroller) return

    cancelNonQuantizedSmoothScroll(scroller)

    if (previewContinuousPreviousScrollBehaviorRef.current === null) {
      previewContinuousPreviousScrollBehaviorRef.current = scroller.style.scrollBehavior
    }
    scroller.style.scrollBehavior = 'auto'

    const previousDirection = previewContinuousScrollDirectionRef.current
    previewContinuousScrollDirectionRef.current = direction

    // Do not reset timing on every key-repeat event; that throttles effective
    // speed. Only reset when direction changes or when starting from idle.
    if (previewContinuousScrollRafRef.current === null || previousDirection !== direction) {
      previewContinuousScrollLastTsRef.current = null
    }

    if (previewContinuousScrollRafRef.current === null) {
      previewContinuousScrollRafRef.current = requestAnimationFrame(runPreviewContinuousScroll)
    }
  }, [isPreviewMode, runPreviewContinuousScroll, previewScrollRef])

  useEffect(() => {
    // Captured once per effect run -- previewPageKeysHeldRef.current is
    // mutated in place (add/delete/clear), never reassigned, so this is the
    // same Set instance the cleanup below still needs.
    const pageKeysHeld = previewPageKeysHeldRef.current

    if (!isPreviewMode) {
      pageKeysHeld.clear()
      clearPreviewContinuousHandoff()
      stopPreviewContinuousScroll()
      return
    }

    /**
     * Whether something else on the page has a real claim on a page key.
     *
     * Deliberately narrower than "is this an editable element": a focused
     * button or search field has no use for PageDown, and swallowing it there
     * is exactly the defect this pane's own keys were reported for. Anything
     * that genuinely binds these (the Options sliders nudge by ten steps)
     * calls preventDefault, which is checked separately. Kept identical to
     * CM6Editor's own rule so the two panes cannot drift apart.
     */
    const targetOwnsPageKeys = (target: EventTarget | null): boolean => {
      if (!(target instanceof HTMLElement)) return false
      return target.isContentEditable || target.tagName === 'TEXTAREA'
    }

    const onWindowKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.defaultPrevented) return
      if (!isSectionActive) return
      if (targetOwnsPageKeys(event.target)) return
      if (event.key !== 'PageDown' && event.key !== 'PageUp') return

      if (shouldBlockPreviewInteraction()) {
        event.preventDefault()
        pageKeysHeld.delete(event.key)
        clearPreviewContinuousHandoff()
        stopPreviewContinuousScroll()
        return
      }

      const scroller = previewScrollRef.current
      if (!scroller) return

      event.preventDefault()
      const direction: -1 | 1 = event.key === 'PageDown' ? 1 : -1
      pageKeysHeld.add(event.key)

      if (event.repeat) {
        if (previewContinuousHandoffTimeoutRef.current === null) {
          startPreviewContinuousScroll(direction)
        }
        return
      }

      clearPreviewContinuousHandoff()
      stopPreviewContinuousScroll()
      const pageStepPx = Math.max(1, scroller.clientHeight * 0.9)
      const startScrollTop = scroller.scrollTop
      const targetScrollTop = scroller.scrollTop + (direction * pageStepPx)
      scrollToNonQuantizedSmooth(scroller, targetScrollTop, {
        onStep: () => syncPreviewCustomScrollbar(),
      })

      const targetContinuousSpeedPxPerSec = Math.max(
        1,
        resolveApexSpeedPxPerSecFromCurrentParams(targetScrollTop - startScrollTop)
          * PREVIEW_CONTINUOUS_SCROLL_APEX_MULTIPLIER,
      )
      const crossingTimeSec = resolveRampCrossingTimeSecFromCurrentParams(
        targetScrollTop - startScrollTop,
        targetContinuousSpeedPxPerSec,
      )

      if (crossingTimeSec !== null) {
        const delayMs = Math.max(0, Math.round(crossingTimeSec * 1000))
        previewContinuousHandoffTimeoutRef.current = window.setTimeout(() => {
          previewContinuousHandoffTimeoutRef.current = null
          if (!isPreviewMode) return
          if (!pageKeysHeld.has(event.key)) return
          startPreviewContinuousScroll(direction)
        }, delayMs)
      }
    }

    const onWindowKeyUp = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'PageDown' || event.key === 'PageUp') {
        pageKeysHeld.delete(event.key)
        clearPreviewContinuousHandoff()
        if (pageKeysHeld.size === 0) {
          const activeDirection = previewContinuousScrollDirectionRef.current
          if (activeDirection !== 0) {
            startPreviewReleaseRampDown(activeDirection)
          } else {
            stopPreviewContinuousScroll()
          }
        }
      }
    }

    const onWindowBlur = () => {
      pageKeysHeld.clear()
      clearPreviewContinuousHandoff()
      stopPreviewContinuousScroll()
    }

    window.addEventListener('keydown', onWindowKeyDown)
    window.addEventListener('keyup', onWindowKeyUp)
    window.addEventListener('blur', onWindowBlur)
    return () => {
      window.removeEventListener('keydown', onWindowKeyDown)
      window.removeEventListener('keyup', onWindowKeyUp)
      window.removeEventListener('blur', onWindowBlur)
      pageKeysHeld.clear()
      clearPreviewContinuousHandoff()
      stopPreviewContinuousScroll()
    }
  }, [
    clearPreviewContinuousHandoff,
    isPreviewMode,
    isSectionActive,
    shouldBlockPreviewInteraction,
    startPreviewReleaseRampDown,
    startPreviewContinuousScroll,
    stopPreviewContinuousScroll,
    syncPreviewCustomScrollbar,
    previewScrollRef,
  ])

  // Native scroll (covers mouse wheel, trackpad, keyboard when not intercepted)
  const handlePreviewScroll = useCallback(() => {
    if (!previewScrollRef.current || !previewTextureRef.current) return;
    syncTextureToScroll(previewScrollRef.current.scrollTop, previewTextureRef.current);
  }, [previewScrollRef]);

  // The render view is normally plain (non-editable) rendered markdown, but
  // Chromium's native spellchecker only underlines misspellings inside an
  // editable region. To let spell check work in render view too, we make the
  // preview container contentEditable when the render-view spell check
  // toggle is on, and block every event that would actually mutate its
  // content — so it stays visually read-only while still being "editable"
  // enough for the OS/Chromium spellchecker to run against it.
  const blockPreviewEditMutation = useCallback((event: { preventDefault: () => void }) => {
    event.preventDefault()
  }, [])

  return {
    previewTextureRef,
    previewScrollbarTrackRef,
    previewScrollbarThumbRef,
    isPreviewScrollThumbActive,
    isDraggingPreviewScrollThumb,
    syncPreviewCustomScrollbar,
    handlePreviewTrackMouseDown,
    handlePreviewTrackContextMenu,
    handlePreviewThumbMouseDown,
    handlePreviewScroll,
    blockPreviewEditMutation,
  }
}
