import { useCallback, useEffect, useRef, useState } from 'react'
import type { MouseEvent, MutableRefObject } from 'react'
import type { PreviewDocumentPositionApi } from './usePreviewMarkdownRendering'
import { beginScrollTrackHold } from '../editor/scrollTrackHold'
import { registerScrollBridge } from '../editor/scrollBridge'
import { resolveThumbRubberBand } from '../editor/scrollThumbRubberBand'
import { createCommittedThumbHeight } from '../editor/scrollThumbMetrics'
import { sampleCurveRampProgress } from '../editor/ScrollCurvePlan'
import type { ScrollJourneyTiming } from '../editor/scrollJourney'
import { measureAverageCharWidthPx } from '../editor/scrollBridgeTexture'
import {
  buildReleaseRampDownPlanFromCurrentParams,
  cancelNonQuantizedSmoothScroll,
  CONTINUOUS_SCROLL_APEX_SPEED_MULTIPLIER,
  isNonQuantizedSmoothScrollActive,
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
  /**
   * The pane box the long-journey bridge draws into (editor/scrollBridge.ts).
   *
   * Deliberately the render CONTAINER rather than the scroller: a curtain
   * inside the scroller would scroll with the content and add its own height
   * to the scrollable area, which for a bridge this tall would be a good deal
   * worse than merely wrong.
   */
  previewBridgeHostRef?: MutableRefObject<HTMLDivElement | null>
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
  previewBridgeHostRef,
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
  const thumbHeightCommitRef = useRef(createCommittedThumbHeight())
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
  const rubberBandRafRef = useRef<number | null>(null)
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
    // The rubber band owns the thumb for the length of a bridged journey, the
    // same way a drag does. Both would otherwise be overwritten every frame by
    // a sync reading the real scroll position -- which during a bridge is
    // mid-cut and says nothing anybody wants drawn.
    if ((isDraggingPreviewScrollThumb || rubberBandRafRef.current !== null) && !options?.force) {
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

    // Both numbers come from the document itself (editor/documentPosition.ts),
    // which answers in ratios and does not say whether this document is being
    // measured or modelled underneath. The pixel fallbacks below are for the
    // one frame before it can answer at all -- not a second opinion.
    const position = previewDocumentPositionRef?.current ?? null

    // SIZE is committed and held; POSITION stays live. See
    // editor/scrollThumbMetrics.ts. The signature is every input that may
    // honestly change the size -- the document, the viewport, the track, and
    // the type geometry -- and deliberately not scrollHeight, which moves as
    // blocks are measured, nor the scroll position, which is none of the
    // size's business.
    const nextThumbHeight = thumbHeightCommitRef.current.resolve({
      signature: [
        activeNoteId ?? '',
        currentEditorTextRef.current.length,
        viewportHeight,
        usableTrackHeight,
        viewStyle,
        viewFontSize,
        viewSpacing,
        viewLetterSpacingEm,
      ].join('|'),
      // Only a settled answer is committed to. Until the document's heights
      // are real, the live pixel ratio is drawn but never frozen -- otherwise
      // a small document, which is entitled to an exact scrollbar, keeps
      // whatever estimate happened to be current on its first answer.
      ratio: position?.isThumbRatioSettled() ? position.readThumbRatio() : null,
      provisionalRatio: viewportHeight / contentHeight,
      usableTrackHeightPx: usableTrackHeight,
      minThumbHeightPx: SCROLL_TRACK_MIN_THUMB_HEIGHT_PX,
    })

    const maxScrollTop = contentHeight - viewportHeight
    const maxThumbTop = Math.max(0, usableTrackHeight - nextThumbHeight)

    const scrollRatio = position?.readScrollRatio()
      ?? (maxScrollTop > 0 ? clamp(scroller.scrollTop / maxScrollTop, 0, 1) : 0)
    const nextThumbTop = SCROLL_TRACK_EDGE_GAP_PX + Math.round(maxThumbTop * scrollRatio)

    applyPreviewThumbDom(nextThumbTop, nextThumbHeight)
    setIsPreviewScrollThumbActive(true)
  }, [applyPreviewThumbDom, isDraggingPreviewScrollThumb, isPreviewMode, previewScrollRef, previewDocumentPositionRef, activeNoteId, viewStyle, viewFontSize, viewSpacing, viewLetterSpacingEm])

  /**
   * The thumb during a bridged journey: it stretches rather than slides.
   *
   * The edge in the direction of travel runs the whole span while the other
   * stays put, both hold still while the bridge covers the cut, and then the
   * trailing edge catches up. The document is not sliding either -- its middle
   * is being cut out -- so a thumb that slid smoothly would be describing a
   * journey that did not happen. Stretching says the true thing: for a moment
   * the reader is spread across all of it.
   *
   * Each edge follows the POSITION curve of its own ramp, normalized and
   * applied to the full span. The ramps' own pixel distances are no use here:
   * a ramp-up carries the document a few thousand pixels of a journey that may
   * be a million, while the thumb's leading edge crosses the entire track in
   * that same window. What carries over is the shape.
   */
  const stopThumbRubberBand = useCallback(() => {
    if (rubberBandRafRef.current === null) return
    cancelAnimationFrame(rubberBandRafRef.current)
    rubberBandRafRef.current = null
  }, [])

  const startThumbRubberBand = useCallback((
    timing: ScrollJourneyTiming,
    startTopPx: number,
    targetTopPx: number,
  ) => {
    stopThumbRubberBand()
    const thumbHeightPx = previewScrollThumbHeightRef.current
    const rampUpSec = timing.rampUp.durationSec
    const bridgeEndSec = rampUpSec + timing.bridgeDurationSec
    const totalSec = bridgeEndSec + timing.rampDown.durationSec
    let startedAtMs: number | null = null

    const frame = (nowMs: number) => {
      if (startedAtMs === null) startedAtMs = nowMs
      const elapsedSec = (nowMs - startedAtMs) / 1000

      // The reader is allowed to interrupt a journey with a wheel, a drag, a
      // page key or another click, and every one of those cancels the scroll
      // rather than telling the scrollbar anything. Asking the engine whether
      // its journey is still running covers all of them at once -- without it
      // the band would go on stretching toward a target nobody is travelling
      // to any more, for the rest of its half second.
      const scrollerNow = previewScrollRef.current
      if (elapsedSec >= totalSec || !scrollerNow || !isNonQuantizedSmoothScrollActive(scrollerNow)) {
        rubberBandRafRef.current = null
        // Hand the thumb back to the ordinary sync, which now reads a settled
        // scroll position -- wherever the journey actually ended up.
        syncPreviewCustomScrollbar({ force: true })
        return
      }

      const leadProgress = elapsedSec < rampUpSec
        ? sampleCurveRampProgress(timing.rampUp, elapsedSec)
        : 1
      const trailProgress = elapsedSec <= bridgeEndSec
        ? 0
        : sampleCurveRampProgress(timing.rampDown, elapsedSec - bridgeEndSec)

      const { topPx, heightPx } = resolveThumbRubberBand({
        startTopPx,
        targetTopPx,
        thumbHeightPx,
        leadProgress,
        trailProgress,
      })
      applyPreviewThumbDom(topPx, heightPx)
      rubberBandRafRef.current = requestAnimationFrame(frame)
    }

    rubberBandRafRef.current = requestAnimationFrame(frame)
  }, [applyPreviewThumbDom, stopThumbRubberBand, syncPreviewCustomScrollbar, previewScrollRef])

  useEffect(() => stopThumbRubberBand, [stopThumbRubberBand])

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
    // thumb somewhere other than where it was released. Routing both through
    // the same object is what guarantees it.
    const position = previewDocumentPositionRef?.current
    if (position) {
      position.jumpToRatio(ratio)
      return
    }

    const maxScrollTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight)
    scroller.scrollTop = ratio * maxScrollTop
  }, [applyPreviewThumbDom, previewScrollRef, previewDocumentPositionRef])

  useEffect(() => {
    if (!isPreviewMode) return
    syncPreviewCustomScrollbar()
  }, [isPreviewMode, syncPreviewCustomScrollbar, activeNoteId, currentEditorText, viewStyle, viewFontSize, viewSpacing, viewLetterSpacingEm])

  /**
   * Offers this pane a curtain for long journeys (editor/scrollBridge.ts).
   *
   * Registered rather than passed: the engine that needs it is
   * scrollToNonQuantizedSmooth, and it is reached from half a dozen places
   * that have no business knowing whether the pane they are scrolling can
   * cover a cut. A pane that registers nothing simply never has its journeys
   * bridged, which is the correct behaviour for one that cannot draw.
   *
   * `readStyle` is read fresh at the start of every journey, so a change of
   * font, size, spacing or theme needs no invalidation of its own.
   */
  const currentEditorTextRef = useRef(currentEditorText)
  useEffect(() => { currentEditorTextRef.current = currentEditorText }, [currentEditorText])

  useEffect(() => {
    const scroller = previewScrollRef.current
    const host = previewBridgeHostRef?.current
    if (!scroller || !host) return undefined

    return registerScrollBridge(scroller, {
      host,
      // The scroller is what holds the text, so it is what gets clipped away
      // under the band. The texture behind it and the background behind that
      // are left alone, which is the whole point.
      textLayer: scroller,
      readStyle: () => {
        // Measured from a rendered paragraph, not from the scroller. The
        // scroller carries the reader's font-size setting, but the markdown
        // styles size actual body text off it -- measured at 16px/25.6px on
        // the scroller against 12.8px/20.48px on a real paragraph, which drew
        // a bridge a quarter too big and immediately obvious against the
        // document either side of it.
        const paragraph = scroller.querySelector('p')
        const style = window.getComputedStyle(paragraph ?? scroller)
        const scrollerStyle = window.getComputedStyle(scroller)
        const fontPx = parseFloat(style.fontSize)
        const lineHeightPx = parseFloat(style.lineHeight)
        if (!(fontPx > 0) || !(lineHeightPx > 0)) return null

        // Padding stays the scroller's: it is what insets the text from the
        // pane's edge, and a paragraph has none of its own.
        const paddingLeftPx = parseFloat(scrollerStyle.paddingLeft) || 0
        const paddingRightPx = parseFloat(scrollerStyle.paddingRight) || 0
        const averageCharWidthPx = measureAverageCharWidthPx(fontPx, style.fontFamily)
        if (!averageCharWidthPx) return null

        const usableWidthPx = Math.max(1, scroller.clientWidth - paddingLeftPx - paddingRightPx)
        return {
          text: currentEditorTextRef.current,
          charsPerLine: Math.max(1, Math.round(usableWidthPx / averageCharWidthPx)),
          lineHeightPx,
          fontPx,
          fontFamily: style.fontFamily,
          color: style.color,
          paddingLeftPx,
          paddingRightPx,
        }
      },
    })
  }, [previewScrollRef, previewBridgeHostRef, activeNoteId])

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

    // Exactly the mapping the thumb drag uses. Clicking the track at 30% and
    // dragging the thumb to 30% have to mean the same thing -- they are the
    // same gesture to the reader -- and until both were routed through the
    // same object they did not: the click resolved against pixels, so on a
    // document with uneven content density the two landed in different
    // places, and on one still being sized up they landed VERY differently
    // (measured: a click at 30% on a just-opened note went to 13% of the
    // text).
    // The end of the track means the end of the DOCUMENT. Everything between
    // this click and the pixel it lands on -- the char target, the block
    // offsets it is resolved against -- is derived from heights that are still
    // estimates on a document nobody has read yet, and the error is not small:
    // measured on 1.5M characters, the first click at the bottom of the track
    // landed at 19% of the document instead of the end, intermittently (4px
    // short on one run, 197,900px short on the next). The reader asked for the
    // end, and the end is a fact about the text, not about how much of it has
    // been measured -- so once the journey is over and the geometry has
    // stopped moving, finish the trip.
    const aimedAtEnd = ratio >= 0.999
    const landOnDocumentEnd = () => {
      const element = previewScrollRef.current
      if (!element) return
      const settledAt = element.scrollTop
      requestAnimationFrame(() => {
        const el = previewScrollRef.current
        // Anything that moved the scroller since is the reader, who outranks
        // this correction.
        if (!el || Math.abs(el.scrollTop - settledAt) > 1) return
        const maxScrollTopPx = Math.max(0, el.scrollHeight - el.clientHeight)
        if (el.scrollTop >= maxScrollTopPx - 0.5) return
        const previousBehavior = el.style.scrollBehavior
        el.style.scrollBehavior = 'auto'
        el.scrollTop = maxScrollTopPx
        el.style.scrollBehavior = previousBehavior
        syncPreviewCustomScrollbar({ force: true })
      })
    }
    const landOnDocumentEndAfterJourney = () => {
      const waitForArrival = () => {
        const el = previewScrollRef.current
        if (!el) return
        if (isNonQuantizedSmoothScrollActive(el)) {
          requestAnimationFrame(waitForArrival)
          return
        }
        landOnDocumentEnd()
      }
      requestAnimationFrame(waitForArrival)
    }

    // A journey already in flight. A second click cannot become a second
    // journey: the thumb is stretched across the first one, so the new one
    // would take that stretched span for its own base size and set off from
    // it -- which is how a thumb ends up longer than its rail. Only the snap
    // is honored mid-flight, because a snap ends the journey outright rather
    // than trying to travel alongside it.
    const scrollerNow = previewScrollRef.current
    const journeyInFlight = rubberBandRafRef.current !== null
      || (!!scrollerNow && isNonQuantizedSmoothScrollActive(scrollerNow))

    const goTo = (instant: boolean) => {
      const element = previewScrollRef.current
      if (!element) return
      const position = previewDocumentPositionRef?.current
      if (position) {
        if (instant) {
          // Land, and hand the thumb back at its committed size. Without
          // stopping the band first it goes on stretching toward a target
          // nobody is travelling to.
          cancelNonQuantizedSmoothScroll(element)
          stopThumbRubberBand()
          position.jumpToRatio(ratio)
          syncPreviewCustomScrollbar({ force: true })
          if (aimedAtEnd) landOnDocumentEnd()
          return
        }
        const startThumbTopPx = previewScrollThumbTopRef.current
        const timing = position.travelToRatio(ratio)
        if (timing) startThumbRubberBand(timing, startThumbTopPx, clampedTop)
        if (aimedAtEnd) landOnDocumentEndAfterJourney()
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
      onTravel: () => {
        trackHoldCancelRef.current = null
        if (journeyInFlight) return
        goTo(false)
      },
    })
  }, [previewScrollRef, shouldBlockPreviewInteraction, handlePreviewTrackRightMouseDown, previewDocumentPositionRef, startThumbRubberBand, stopThumbRubberBand, syncPreviewCustomScrollbar])

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
     * Whether something else has a real claim on a page key.
     *
     * Deliberately narrower than "is this an editable element": a focused
     * button or search field has no use for PageDown, and swallowing it there
     * is exactly the defect this pane's keys were reported for. It is also
     * SLOT-AWARE -- the claim only counts for a caret inside this pane (this
     * preview is itself contentEditable while render-view spell check is on),
     * because a caret in another section's editor does not speak for the
     * section the reader is in. Controls that genuinely bind these keys (the
     * Options sliders nudge by ten steps) call preventDefault, checked
     * separately. Kept identical to CM6Editor's rule so the panes cannot
     * drift apart.
     */
    const targetOwnsPageKeys = (target: EventTarget | null): boolean => {
      if (!(target instanceof HTMLElement)) return false
      if (target.tagName === 'TEXTAREA') return true
      return target.isContentEditable && (previewScrollRef.current?.contains(target) ?? false)
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
