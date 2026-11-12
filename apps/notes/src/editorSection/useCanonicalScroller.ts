import { SCROLL_TRACK_EDGE_GAP_PX } from '@thockdown/interaction/scrollTrackGeometry'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { MouseEvent, MutableRefObject, PointerEvent } from 'react'
import type { PreviewDocumentPositionApi } from './usePreviewMarkdownRendering'
import { beginScrollTrackHold } from '../scroll/scrollTrackHold'
import { registerScrollBridge } from '../scroll/scrollBridge'
import { resolveThumbRubberBand } from '../scroll/scrollThumbRubberBand'
import { createCommittedThumbHeight } from '../scroll/scrollThumbMetrics'
import { sampleCurveRampProgress } from '@thockdown/interaction/ScrollCurvePlan'
import type { ScrollJourneyTiming } from '@thockdown/interaction/scrollJourney'
import { measureAverageCharWidthPx } from '../scroll/scrollBridgeTexture'
import { createContinuousWheel, type ContinuousWheel } from '../scroll/continuousWheel'
import { borrowAutoScrollBehavior } from '@thockdown/interaction/scrollBehaviorLock'
import { buildReleaseRampDownPlanFromCurrentParams, CONTINUOUS_SCROLL_APEX_SPEED_MULTIPLIER, resolveApexSpeedPxPerSecFromCurrentParams, sampleReleaseRampDownPlan, resolveRampCrossingTimeSecFromCurrentParams, scrollToNonQuantizedSmooth } from '@thockdown/interaction/NonQuantizedSmoothScroll'
import { cancelSmoothScroll, isSmoothScrollActive } from '@thockdown/interaction/smoothScrollRegistry'
import { clamp } from '@thockdown/interaction/clamp'

const PREVIEW_CONTINUOUS_SCROLL_APEX_MULTIPLIER = CONTINUOUS_SCROLL_APEX_SPEED_MULTIPLIER


const syncTextureToScroll = (scrollTop: number, maskEl: HTMLElement) => {
  maskEl.style.maskPosition = `0 ${-scrollTop}px`;
  maskEl.style.webkitMaskPosition = `0 ${-scrollTop}px`;
};

export interface UseCanonicalScrollerOptions {
  /** Whether the scroller is on screen and taking input (the reader: its slot is in reader mode). */
  isEnabled: boolean
  isScrollInteractionBlocked?: () => boolean
  scrollerRef: MutableRefObject<HTMLElement | null>
  /**
   * Whether this scroller answers the keyboard: the page keys, and a
   * keystroke stopping a wheel coast.
   *
   * The page-key listener below is on the window, so in split view every
   * reader would otherwise answer the same keypress and both would page at
   * once. Only the active slot's does; the sidebar's lists never do.
   */
  ownsKeyboard?: boolean
  /**
   * Everything the thumb's size and the wheel's line height are made of,
   * besides the scroller's own geometry: a change re-decides the thumb's
   * committed size and re-measures the line height. The reader's is its
   * note, its text and its type settings.
   */
  layoutKey: string
  /** The layer drawn behind the content, kept in step with the scroll position. */
  textureRef?: MutableRefObject<HTMLDivElement | null>
  /**
   * The preview's position in character space, published by
   * usePreviewMarkdownRendering. When present the thumb's POSITION is driven
   * from it rather than from pixels -- see previewCharPosition.ts. Optional,
   * and null until the preview has blocks, so every path here still has to
   * work on the pixel mapping alone.
   */
  previewDocumentPositionRef?: MutableRefObject<PreviewDocumentPositionApi | null>
  /**
   * The pane box the long-journey bridge draws into (scroll/scrollBridge.ts).
   *
   * Deliberately the render CONTAINER rather than the scroller: a curtain
   * inside the scroller would scroll with the content and add its own height
   * to the scrollable area, which for a bridge this tall would be a good deal
   * worse than merely wrong.
   */
  previewBridgeHostRef?: MutableRefObject<HTMLDivElement | null>
  /** The text the bridge draws (the note's live text, see useDisplayedNoteText.ts); needed with a bridge host. */
  readBridgeText?: () => string
}


/**
 * THE CANONICAL SCROLLING of every scroll box in the app that is not the
 * editor's row-quantized one: the reader, the sidebar's lists and panels, and
 * a library image shown in a slot. One implementation, so the same gesture
 * behaves the same everywhere:
 *
 * - the app's own scrollbar (direct-DOM thumb sync, a committed thumb size,
 *   a drag of the thumb, a track click that travels and a track hold that
 *   snaps, a right hold on the track that pages towards the pointer, the
 *   thumb stretched across a bridged journey);
 * - PageUp/PageDown, continuous while held, with a momentum release;
 * - the wheel's notch glide and spin-to-keep-scrolling coast.
 *
 * Written for the reader first, which is why its internal names say
 * `preview`: what is particular to the reader (a document only partly drawn,
 * and the bridge over a long journey) arrives through the optional ports
 * `previewDocumentPositionRef` and `previewBridgeHostRef`, and a scroller
 * without them is driven by its pixels alone.
 *
 * Direct DOM mutation instead of React state is deliberate: per-frame scroll
 * events would otherwise re-render the host on every tick.
 */
export function useCanonicalScroller({
  isEnabled: isPreviewMode,
  isScrollInteractionBlocked: isPreviewScrollInteractionBlocked,
  scrollerRef: previewScrollRef,
  ownsKeyboard: isSectionActive = true,
  layoutKey,
  textureRef,
  previewDocumentPositionRef,
  previewBridgeHostRef,
  readBridgeText,
}: UseCanonicalScrollerOptions) {
  const ownTextureRef = useRef<HTMLDivElement>(null)
  const previewTextureRef = textureRef ?? ownTextureRef
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
  const previewContinuousPreviousScrollBehaviorRef = useRef<(() => void) | null>(null)
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
  // This scroller's wheel driver (scroll/continuousWheel.ts), created by the
  // wheel effect below for the element it binds to.
  const wheelRef = useRef<ContinuousWheel | null>(null)
  const [isPreviewScrollThumbActive, setIsPreviewScrollThumbActive] = useState(false)
  const [isDraggingPreviewScrollThumb, setIsDraggingPreviewScrollThumb] = useState(false)

  const shouldBlockPreviewInteraction = useCallback(() => {
    if (!isPreviewMode) return true
    return isPreviewScrollInteractionBlocked?.() ?? false
  }, [isPreviewMode, isPreviewScrollInteractionBlocked])

  /**
   * End a coast, whatever it was doing, and say why in the wheel trace.
   *
   * Declared up here rather than beside the wheel handler because the
   * scrollbar's own handlers -- a track click, a thumb drag -- have to be
   * able to call it, and they are defined further down. Everything it
   * touches is a ref, so it has no dependency on any of that.
   */
  const stopPreviewWheelSpin = useCallback((reason: string) => {
    wheelRef.current?.stop(reason)
  }, [])

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
      // Not scrollTop: on a windowed pane that number jumps every time the
      // window's front edge moves, and the texture would slip against the
      // text it is meant to be printed on.
      const continuousOffsetPx = previewDocumentPositionRef?.current?.readContinuousScrollOffsetPx?.()
      syncTextureToScroll(continuousOffsetPx ?? scroller.scrollTop, previewTextureRef.current)
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
    // scroll/scrollThumbMetrics.ts. The signature is every input that may
    // honestly change the size -- the document, the viewport, the track, and
    // the type geometry -- and deliberately not scrollHeight, which moves as
    // blocks are measured, nor the scroll position, which is none of the
    // size's business.
    const nextThumbHeight = thumbHeightCommitRef.current.resolve({
      signature: [layoutKey, viewportHeight, usableTrackHeight].join('|'),
      // Only a settled answer is committed to. Until the document's heights
      // are real, the live pixel ratio is drawn but never frozen -- otherwise
      // a small document, which is entitled to an exact scrollbar, keeps
      // whatever estimate happened to be current on its first answer.
      ratio: position?.isThumbRatioSettled() ? position.readThumbRatio() : null,
      provisionalRatio: viewportHeight / contentHeight,
      usableTrackHeightPx: usableTrackHeight,
      // The thumb's floor is its own WIDTH, so the smallest it can be is a
      // square. Read from the element rather than from a constant: the width
      // follows --canonical-scroll-thickness and the handle gap, both of which
      // move with the reader's own spacing settings. Before the thumb is laid
      // out the width is 0 -- harmless, since the committed height is held
      // against its floor too and re-decided once the real width exists (see
      // createCommittedThumbHeight).
      minThumbHeightPx: previewScrollbarThumbRef.current?.offsetWidth ?? 0,
    })

    const maxScrollTop = contentHeight - viewportHeight
    const maxThumbTop = Math.max(0, usableTrackHeight - nextThumbHeight)

    const scrollRatio = position?.readScrollRatio()
      ?? (maxScrollTop > 0 ? clamp(scroller.scrollTop / maxScrollTop, 0, 1) : 0)
    const nextThumbTop = SCROLL_TRACK_EDGE_GAP_PX + Math.round(maxThumbTop * scrollRatio)

    applyPreviewThumbDom(nextThumbTop, nextThumbHeight)
    setIsPreviewScrollThumbActive(true)
  }, [applyPreviewThumbDom, isDraggingPreviewScrollThumb, isPreviewMode, previewScrollRef, previewDocumentPositionRef, previewTextureRef, layoutKey])

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
      if (elapsedSec >= totalSec || !scrollerNow || !isSmoothScrollActive(scrollerNow)) {
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

  /**
   * The thumb top a ratio corresponds to. The one conversion the track click
   * and a travel started from elsewhere have to agree on, or the band sets off
   * for a destination the sync does not put it at.
   */
  const resolveThumbTopForRatio = useCallback((ratio: number): number => {
    const track = previewScrollbarTrackRef.current
    const trackHeight = track?.clientHeight ?? 0
    const usableTrackHeight = Math.max(0, trackHeight - (SCROLL_TRACK_EDGE_GAP_PX * 2))
    const maxThumbTop = Math.max(0, usableTrackHeight - previewScrollThumbHeightRef.current)
    return SCROLL_TRACK_EDGE_GAP_PX + Math.round(maxThumbTop * clamp(ratio, 0, 1))
  }, [])

  /**
   * Travel to a ratio exactly as a click on the track would.
   *
   * Published so that everything with a reason to move the pane a long way --
   * a search hit, an anchor -- gets the journey the scrollbar already has:
   * the bridge over the cut, the thumb stretched across it, the landing. The
   * alternative each such caller kept reinventing was a scroll of its own
   * followed by a correction, and a correction is exactly what the reader sees
   * as the pane arriving twice.
   *
   * A journey already in flight is ENDED first rather than refused. The track
   * click refuses a second click for a real reason -- the thumb is stretched
   * across the first journey, and a second would take that stretched span for
   * its own base size -- but a reader clicking a second search hit is asking
   * for that hit, not repeating themselves, and dropping the click would be
   * the worse answer. Cancelling the scroll, releasing the band and forcing
   * the sync puts the thumb back at its committed size on the position it has
   * actually reached, which is the honest base for the next journey.
   */
  const travelPreviewToRatio = useCallback((ratio: number): boolean => {
    const scroller = previewScrollRef.current
    const position = previewDocumentPositionRef?.current
    if (!scroller || !position) return false

    if (rubberBandRafRef.current !== null || isSmoothScrollActive(scroller)) {
      cancelSmoothScroll(scroller)
      stopThumbRubberBand()
      syncPreviewCustomScrollbar({ force: true })
    }

    const startThumbTopPx = previewScrollThumbTopRef.current
    const timing = position.travelToRatio(ratio)
    if (timing) startThumbRubberBand(timing, startThumbTopPx, resolveThumbTopForRatio(ratio))
    return true
  }, [
    previewScrollRef,
    previewDocumentPositionRef,
    resolveThumbTopForRatio,
    startThumbRubberBand,
    stopThumbRubberBand,
    syncPreviewCustomScrollbar,
  ])

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
    // layoutKey is not read: it is one of the things that changes the thumb's size.
  }, [isPreviewMode, syncPreviewCustomScrollbar, layoutKey])

  /**
   * Offers this pane a curtain for long journeys (scroll/scrollBridge.ts).
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
  useEffect(() => {
    const scroller = previewScrollRef.current
    const host = previewBridgeHostRef?.current
    if (!scroller || !host || !readBridgeText) return undefined

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
          text: readBridgeText(),
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
  }, [previewScrollRef, previewBridgeHostRef, readBridgeText])

  useEffect(() => {
    if (!isPreviewMode) return

    const scroller = previewScrollRef.current
    if (!scroller) return

    const onScroll = () => {
      syncPreviewCustomScrollbar()
    }

    scroller.addEventListener('scroll', onScroll, { passive: true })
    return () => scroller.removeEventListener('scroll', onScroll)
  }, [isPreviewMode, syncPreviewCustomScrollbar, previewScrollRef, previewDocumentPositionRef])

  useEffect(() => {
    if (!isPreviewMode) return

    const scroller = previewScrollRef.current
    if (!scroller) return

    // Coalesced, not debounced: a request while one is pending joins it.
    // Cancelling the pending frame and asking for the next one never ran
    // while something mutated the content every frame (an accordion section
    // animating its height writes a style each frame from its own rAF
    // callback), so the thumb stood still for the whole animation.
    const scheduleSync = () => {
      if (previewScrollbarRafRef.current !== null) return
      previewScrollbarRafRef.current = requestAnimationFrame(() => {
        previewScrollbarRafRef.current = null
        syncPreviewCustomScrollbar()
      })
    }

    scheduleSync()

    // What grows and shrinks inside the scroller is its children: the
    // reader's content, a sidebar panel, a list's cards. Each is watched for
    // size, and the set is refreshed when the scroller's own children change.
    const resizeObserver = new ResizeObserver(() => scheduleSync())
    resizeObserver.observe(scroller)
    const observed = new Set<Element>()
    const observeChildren = () => {
      for (const child of Array.from(scroller.children)) {
        if (observed.has(child)) continue
        observed.add(child)
        resizeObserver.observe(child)
      }
      for (const child of observed) {
        if (child.parentElement === scroller) continue
        observed.delete(child)
        resizeObserver.unobserve(child)
      }
    }
    observeChildren()

    const mutationObserver = new MutationObserver((records) => {
      if (records.some((record) => record.target === scroller && record.type === 'childList')) observeChildren()
      scheduleSync()
    })
    mutationObserver.observe(scroller, {
      subtree: true,
      childList: true,
      characterData: true,
    })

    const onDetailsToggle = (event: Event) => {
      if (event.target instanceof HTMLDetailsElement) scheduleSync()
    }
    scroller.addEventListener('toggle', onDetailsToggle, true)

    return () => {
      scroller.removeEventListener('toggle', onDetailsToggle, true)
      mutationObserver.disconnect()
      resizeObserver.disconnect()
      if (previewScrollbarRafRef.current !== null) {
        cancelAnimationFrame(previewScrollbarRafRef.current)
        previewScrollbarRafRef.current = null
      }
    }
  }, [isPreviewMode, syncPreviewCustomScrollbar, previewScrollRef, previewDocumentPositionRef])

  useEffect(() => {
    if (!isDraggingPreviewScrollThumb) return

    const onPointerMove = (event: globalThis.PointerEvent) => {
      const origin = previewScrollbarDragOriginRef.current
      if (!origin) return
      const deltaY = event.clientY - origin.pointerY
      previewScrollFromThumbTop(origin.thumbTopPx + deltaY)
    }

    const onPointerUp = () => {
      setIsDraggingPreviewScrollThumb(false)
      previewScrollbarDragOriginRef.current = null
      requestAnimationFrame(() => syncPreviewCustomScrollbar({ force: true }))
    }

    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
    window.addEventListener('pointercancel', onPointerUp)
    return () => {
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
      window.removeEventListener('pointercancel', onPointerUp)
    }
  }, [isDraggingPreviewScrollThumb, previewScrollFromThumbTop, syncPreviewCustomScrollbar])

  useEffect(() => {
    const scroller = previewScrollRef.current
    if (!scroller) return

    // A drag is a cross-frame borrow like any other, so it goes through the
    // lock. Writing the property directly here is what made this a stealer:
    // the effect re-runs on every drag state change and used to hand the
    // property back to the empty string, whether or not a journey or a coast
    // was in the middle of using it.
    if (!isDraggingPreviewScrollThumb) return
    const release = borrowAutoScrollBehavior(scroller)
    return release
  }, [isDraggingPreviewScrollThumb, previewScrollRef])

  // Right-click-and-hold on the track pages in the clicked direction for as
  // long as the button is held, exactly like holding PageUp/PageDown -- it's
  // pressed through the same page press the keys use (pageControlRef), so it reuses the
  // one-shot jump, continuous-hold, and release-ramp logic below verbatim
  // instead of duplicating that curve/timing math here.
  // The page press and release the page keys drive, published by the key
  // effect below. The track hold calls them directly rather than dispatching
  // a key on window: a window key would also reach every other scroller and
  // the editor, and would be refused here whenever this scroller does not
  // own the keyboard (the sidebar never does).
  const pageControlRef = useRef<{
    press: (key: 'PageUp' | 'PageDown', repeat: boolean) => boolean
    release: (key: 'PageUp' | 'PageDown') => void
  } | null>(null)

  const stopPreviewScrollbarRightHold = useCallback(() => {
    const hold = previewScrollbarRightHoldRef.current
    if (!hold) return
    if (hold.rafId !== null) {
      cancelAnimationFrame(hold.rafId)
    }
    previewScrollbarRightHoldRef.current = null
    pageControlRef.current?.release(hold.key)
  }, [])

  useEffect(() => {
    const handleWindowMouseUp = (event: globalThis.PointerEvent) => {
      if (event.button === 2 || event.type === 'pointercancel') stopPreviewScrollbarRightHold()
    }
    const handleWindowMouseMove = (event: globalThis.PointerEvent) => {
      const hold = previewScrollbarRightHoldRef.current
      const track = previewScrollbarTrackRef.current
      if (!hold || !track) return
      hold.cursorYPx = event.clientY - track.getBoundingClientRect().top
    }
    window.addEventListener('pointerup', handleWindowMouseUp)
    window.addEventListener('pointercancel', handleWindowMouseUp)
    window.addEventListener('pointermove', handleWindowMouseMove)
    return () => {
      window.removeEventListener('pointerup', handleWindowMouseUp)
      window.removeEventListener('pointercancel', handleWindowMouseUp)
      window.removeEventListener('pointermove', handleWindowMouseMove)
    }
  }, [stopPreviewScrollbarRightHold])

  useEffect(() => stopPreviewScrollbarRightHold, [stopPreviewScrollbarRightHold])

  const handlePreviewTrackRightPointerDown = useCallback((event: PointerEvent<HTMLDivElement>) => {
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

    pageControlRef.current?.press(key, false)

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

  const handlePreviewTrackPointerDown = useCallback((event: PointerEvent<HTMLDivElement>) => {
    if (shouldBlockPreviewInteraction()) return
    // The scrollbar is not inside the scroller, so the coast's own
    // mousedown listener never sees a click here -- and a reader reaching
    // for the thumb has plainly stopped being carried along.
    stopPreviewWheelSpin('scrollbar')
    if (event.button === 2) {
      handlePreviewTrackRightPointerDown(event)
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
    // Held for a short window rather than applied once. The document's height
    // does not stop moving the instant the journey does -- measured in the
    // edit view, it was still shrinking several frames later (15340 -> 15132)
    // -- so a single correction lands on a number that is about to change
    // again. This keeps the end pinned for as long as the end keeps moving.
    const landOnDocumentEnd = () => {
      let framesLeft = 40
      let expectedTopPx: number | null = null
      const step = () => {
        const el = previewScrollRef.current
        if (!el || framesLeft-- <= 0) return
        const maxScrollTopPx = Math.max(0, el.scrollHeight - el.clientHeight)

        // "Did the reader take over?" is a question about who MOVED the
        // scroller, not about how far from the end it is. Distance was the
        // first rule tried and it was exactly backwards: a journey that landed
        // at 19% of the document -- the very failure this exists to correct --
        // looks far from the end, so the correction stood down precisely when
        // it was needed. Compare against what we last left instead. The
        // scroller also clamps scrollTop down by itself when content shrinks,
        // so sitting exactly at the maximum is never read as input.
        if (expectedTopPx !== null
          && Math.abs(el.scrollTop - expectedTopPx) > 2
          && el.scrollTop !== maxScrollTopPx) return

        if (el.scrollTop < maxScrollTopPx - 0.5) {
          const position = previewDocumentPositionRef?.current
          // On a windowed pane `maxScrollTopPx` is the end of the MOUNTED
          // RUN, so writing it would park the reader at the edge of a window
          // somewhere in the middle of the note and call it the end. Ask the
          // document for its own end instead. (This whole correction exists to
          // undo a landing spoiled by estimated heights -- on a pane with no
          // estimates it is mostly redundant, but a ratio of 1 is still the
          // right way to say "the end" there.)
          if (position?.isAtDocumentEdge) {
            position.jumpToRatio(1)
          } else {
            const previousBehavior = el.style.scrollBehavior
            el.style.scrollBehavior = 'auto'
            el.scrollTop = maxScrollTopPx
            el.style.scrollBehavior = previousBehavior
          }
          syncPreviewCustomScrollbar({ force: true })
        }
        expectedTopPx = el.scrollTop
        requestAnimationFrame(step)
      }
      requestAnimationFrame(step)
    }
    const landOnDocumentEndAfterJourney = () => {
      const waitForArrival = () => {
        const el = previewScrollRef.current
        if (!el) return
        if (isSmoothScrollActive(el)) {
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
      || (!!scrollerNow && isSmoothScrollActive(scrollerNow))

    const goTo = (instant: boolean) => {
      const element = previewScrollRef.current
      if (!element) return
      const position = previewDocumentPositionRef?.current
      if (position) {
        if (instant) {
          // Land, and hand the thumb back at its committed size. Without
          // stopping the band first it goes on stretching toward a target
          // nobody is travelling to.
          cancelSmoothScroll(element)
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
        cancelSmoothScroll(element)
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
  }, [previewScrollRef, shouldBlockPreviewInteraction, stopPreviewWheelSpin, handlePreviewTrackRightPointerDown, previewDocumentPositionRef, startThumbRubberBand, stopThumbRubberBand, syncPreviewCustomScrollbar])

  // A gesture in flight when this unmounts would otherwise fire its snap into
  // a torn-down pane.
  useEffect(() => () => { trackHoldCancelRef.current?.() }, [])

  const handlePreviewThumbPointerDown = useCallback((event: PointerEvent<HTMLDivElement>) => {
    if (shouldBlockPreviewInteraction()) return
    stopPreviewWheelSpin('scrollbar')
    if (event.button !== 0) return
    // No preventDefault: cancelling a pointerdown suppresses the mousedown
    // that focusOwnership.ts reads to keep the keyboard where it is.
    event.stopPropagation()
    // The borrow belongs to the drag effect above, which runs before any
    // pointermove can be delivered.
    setIsDraggingPreviewScrollThumb(true)
    previewScrollbarDragOriginRef.current = {
      pointerY: event.clientY,
      thumbTopPx: previewScrollThumbTopRef.current,
    }
  }, [shouldBlockPreviewInteraction, stopPreviewWheelSpin])

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
      previewContinuousPreviousScrollBehaviorRef.current?.()
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

      // Running out of scroller is not the same as running out of document.
      // A windowed preview (editorSection/previewWindow.ts) reaches the end of
      // its mounted content many times on the way through a large note -- each
      // one a runway being consumed, with more arriving a frame later. Stopping
      // there would strand the reader mid-document with a key still held.
      const atScrollerEnd = (direction < 0 && nextScrollTop <= 0.01)
        || (direction > 0 && nextScrollTop >= maxScrollTop - 0.01)
      const position = previewDocumentPositionRef?.current
      const hitBoundary = atScrollerEnd
        && (position?.isAtDocumentEdge?.(direction) ?? true)
      if (hitBoundary) {
        previewContinuousScrollDirectionRef.current = 0
        previewContinuousScrollRafRef.current = null
        previewContinuousScrollLastTsRef.current = null
        return
      }
    }

    previewContinuousScrollRafRef.current = requestAnimationFrame(runPreviewContinuousScroll)
  }, [isPreviewMode, syncPreviewCustomScrollbar, previewScrollRef, previewDocumentPositionRef])

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
      previewContinuousPreviousScrollBehaviorRef.current = borrowAutoScrollBehavior(scroller)
    }

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

      // Same distinction as the continuous loop above: the release ramp must
      // coast to a stop, not be cut short by a runway edge.
      const rampDirection: -1 | 1 = displacement >= 0 ? 1 : -1
      const atScrollerEnd = nextScrollTop <= 0.01 || nextScrollTop >= maxScrollTop - 0.01
      const hitBoundary = atScrollerEnd
        && (previewDocumentPositionRef?.current?.isAtDocumentEdge?.(rampDirection) ?? true)
      if (elapsedSec >= rampDownPlan.tailDurationSec || hitBoundary) {
        previewReleaseRampDownRafRef.current = null
        previewContinuousPreviousScrollBehaviorRef.current?.()
        previewContinuousPreviousScrollBehaviorRef.current = null
        return
      }

      previewReleaseRampDownRafRef.current = requestAnimationFrame(animateRampDown)
    }

    previewReleaseRampDownRafRef.current = requestAnimationFrame(animateRampDown)
  }, [isPreviewMode, stopPreviewContinuousScroll, syncPreviewCustomScrollbar, previewScrollRef, previewDocumentPositionRef])

  const startPreviewContinuousScroll = useCallback((direction: -1 | 1) => {
    if (!isPreviewMode) return
    const scroller = previewScrollRef.current
    if (!scroller) return

    cancelSmoothScroll(scroller)

    if (previewContinuousPreviousScrollBehaviorRef.current === null) {
      previewContinuousPreviousScrollBehaviorRef.current = borrowAutoScrollBehavior(scroller)
    }

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

    // One page press, from the keyboard or from this scroller's own track
    // hold. Returns whether it was taken, so a key event is consumed exactly
    // when a press happened.
    const pressPage = (key: 'PageUp' | 'PageDown', repeat: boolean): boolean => {
      if (shouldBlockPreviewInteraction()) {
        pageKeysHeld.delete(key)
        clearPreviewContinuousHandoff()
        stopPreviewContinuousScroll()
        return true
      }

      const scroller = previewScrollRef.current
      if (!scroller) return false

      const direction: -1 | 1 = key === 'PageDown' ? 1 : -1
      pageKeysHeld.add(key)

      if (repeat) {
        if (previewContinuousHandoffTimeoutRef.current === null) {
          startPreviewContinuousScroll(direction)
        }
        return true
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
          if (!pageKeysHeld.has(key)) return
          startPreviewContinuousScroll(direction)
        }, delayMs)
      }
      return true
    }

    const releasePage = (key: 'PageUp' | 'PageDown') => {
      pageKeysHeld.delete(key)
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
    pageControlRef.current = { press: pressPage, release: releasePage }

    const onWindowKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.defaultPrevented) return
      if (!isSectionActive) return
      if (targetOwnsPageKeys(event.target)) return
      if (event.key !== 'PageDown' && event.key !== 'PageUp') return
      if (pressPage(event.key, event.repeat)) event.preventDefault()
    }

    const onWindowKeyUp = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'PageDown' || event.key === 'PageUp') releasePage(event.key)
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
      pageControlRef.current = null
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

  /**
   * The wheel: every notch is this scroller's own (scroll/continuousWheel.ts),
   * so a notch is worth the reader's step in line heights on every surface.
   * Recreated when the layout changes, because the driver measures the line
   * height once.
   */
  useEffect(() => {
    if (!isPreviewMode) return
    const scroller = previewScrollRef.current
    if (!scroller) return
    const wheel = createContinuousWheel({
      scroller,
      isBlocked: shouldBlockPreviewInteraction,
      onScrolled: () => syncPreviewCustomScrollbar(),
      isAtDocumentEdge: previewDocumentPositionRef
        ? (direction) => previewDocumentPositionRef.current?.isAtDocumentEdge?.(direction) ?? true
        : undefined,
      traceLabel: 'preview',
    })
    wheelRef.current = wheel

    // Anything that means the reader is now doing something else ends a coast.
    const cancelOnOtherInput = () => wheel.stop('other input')
    // A keystroke ends a coast too, but a scroller that holds no focusable
    // element never receives one, so the window is watched, narrowed to a key
    // pressed inside this scroller or while it owns the keyboard.
    const cancelOnWindowKeyDown = (event: globalThis.KeyboardEvent) => {
      const target = event.target
      const insideThisScroller = target instanceof Node && scroller.contains(target)
      if (!insideThisScroller && !isSectionActive) return
      wheel.stop('keystroke')
    }

    scroller.addEventListener('wheel', wheel.handleWheel, { passive: false })
    scroller.addEventListener('pointerdown', cancelOnOtherInput, { capture: true })
    window.addEventListener('keydown', cancelOnWindowKeyDown, { capture: true })
    return () => {
      scroller.removeEventListener('wheel', wheel.handleWheel)
      scroller.removeEventListener('pointerdown', cancelOnOtherInput, { capture: true })
      window.removeEventListener('keydown', cancelOnWindowKeyDown, { capture: true })
      wheel.stop('unmount')
      if (wheelRef.current === wheel) wheelRef.current = null
    }
  }, [
    isPreviewMode,
    isSectionActive,
    previewScrollRef,
    previewDocumentPositionRef,
    shouldBlockPreviewInteraction,
    syncPreviewCustomScrollbar,
    layoutKey,
  ])

  // Native scroll (covers mouse wheel, trackpad, keyboard when not intercepted)
  const handlePreviewScroll = useCallback(() => {
    if (!previewScrollRef.current || !previewTextureRef.current) return;
    syncTextureToScroll(previewScrollRef.current.scrollTop, previewTextureRef.current);
  }, [previewScrollRef, previewTextureRef]);

  return {
    previewTextureRef,
    previewScrollbarTrackRef,
    previewScrollbarThumbRef,
    isPreviewScrollThumbActive,
    isDraggingPreviewScrollThumb,
    syncPreviewCustomScrollbar,
    handlePreviewTrackPointerDown,
    handlePreviewTrackContextMenu,
    handlePreviewThumbPointerDown,
    handlePreviewScroll,
    travelPreviewToRatio,
  }
}
