import { SCROLL_TRACK_EDGE_GAP_PX } from '../shared/scrollTrackGeometry'
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
import { createWheelNotchState, resolveWheelEventUnits } from '../editor/wheelNotch'
import { getWheelStepLines } from '../editor/wheelStep'
import { borrowAutoScrollBehavior } from '../editor/scrollBehaviorLock'
import { appendWheelTrace, isWheelTraceOn } from '../editor/wheelTrace'
import {
  cancelWheelSpin,
  createWheelSpinState,
  getWheelSpinCutoffMs,
  getWheelSpinDampenDivisor,
  getWheelSpinEffectiveThresholdMs,
  refreshWheelSpinCoast,
  registerWheelSpinNudge,
  type WheelSpinDirection,
} from '../editor/wheelSpin'
import {
  remainingWheelNotchTravelPx,
  retargetWheelNotchTravel,
  resolveWheelNotchTravelMs,
  takeWheelNotchTravelStep,
  type WheelNotchTravel,
} from '../editor/wheelNotchTravel'
import {
  addWheelSpinProfileCarry,
  buildWheelSpinProfile,
  sampleWheelSpinProfile,
  wheelSpinProfileSpeedPxPerMs,
  wheelSpinProfileUndeliveredCarryPx,
  type WheelSpinProfile,
} from '../editor/wheelSpinProfile'
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
  /** The section's live text, read when needed, and its version (see useDisplayedNoteText.ts). */
  readEditorText: () => string
  editorTextVersion: number
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
  readEditorText,
  editorTextVersion,
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
  // Spin-to-keep-scrolling, the render view's half (editor/wheelSpin.ts for
  // the gesture, editor/wheelSpinProfile.ts for the curve this one rides).
  // Per hook instance, like the edit view's is per mount: two split-view
  // panes are two scrollers, and a spin in one says nothing about the other.
  const previewWheelSpinStateRef = useRef(createWheelSpinState())
  // Not used to scroll -- native scrolling still does that here -- only to
  // decide what counts as one nudge, exactly as the edit view decides it.
  // See the wheel handler for why detection has to be shared and motion
  // must not be.
  const previewWheelNotchStateRef = useRef(createWheelNotchState())
  const previewWheelSpinProfileRef = useRef<WheelSpinProfile | null>(null)
  const previewWheelSpinRafRef = useRef<number | null>(null)
  const previewWheelSpinLastFrameMsRef = useRef<number | null>(null)
  /**
   * How far into the profile the coast is, and how much of it has been paid.
   *
   * The clock is kept separately from wall time so a stalled frame can be
   * absorbed by advancing it less than the wall did -- see `coastFrame`. The
   * paid figure is what makes the profile's absolute-time sampling usable on
   * a scroller whose own `scrollTop` moves underneath us: the profile says
   * the total distance owed at a moment, and the difference against what has
   * already been paid is this frame's delta.
   */
  const previewWheelSpinClockMsRef = useRef(0)
  const previewWheelSpinPaidPxRef = useRef(0)
  /**
   * The single notch's own glide (editor/wheelNotchTravel.ts).
   *
   * Separate from the coast because it answers a different question -- how a
   * notch is delivered, rather than what happens after the hand lets go --
   * and because the two never run at once: a coast that starts inherits
   * whatever this had left to deliver and this is torn down.
   */
  const previewNotchTravelRef = useRef<WheelNotchTravel | null>(null)
  const previewNotchTravelRafRef = useRef<number | null>(null)
  /**
   * Sub-pixel remainder owed to the reader, across every wheel write.
   *
   * Without it a slow coast rounds to a standstill and a fractional step
   * quietly under-delivers on every notch. Shared by both, because both are
   * the same debt.
   */
  const previewWheelSpinCarryPxRef = useRef(0)
  /**
   * The wheel's hold on `scroll-behavior` (editor/scrollBehaviorLock.ts).
   *
   * A borrow rather than a saved string: a journey, a held page key and a
   * thumb drag all want the same property, and a saved string hands back
   * whatever the last writer happened to leave -- which is how a wheel
   * gesture followed by a scrollbar click used to kill the click's animation
   * four pixels in.
   */
  const previewWheelSpinScrollBehaviorRef = useRef<(() => void) | null>(null)
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
    const wasRunning = previewWheelSpinProfileRef.current !== null
      || previewWheelSpinRafRef.current !== null
      || previewNotchTravelRef.current !== null
      || previewWheelSpinStateRef.current.coast !== null
    if (previewWheelSpinRafRef.current !== null) {
      cancelAnimationFrame(previewWheelSpinRafRef.current)
      previewWheelSpinRafRef.current = null
    }
    previewWheelSpinProfileRef.current = null
    previewWheelSpinLastFrameMsRef.current = null
    previewWheelSpinClockMsRef.current = 0
    previewWheelSpinPaidPxRef.current = 0
    // A notch glide is stopped by everything that stops a coast, and for the
    // same reasons: the reader has started doing something else. The one
    // caller that must NOT lose it is the coast taking over, which reads the
    // remainder out first and hands it to the profile.
    if (previewNotchTravelRafRef.current !== null) {
      cancelAnimationFrame(previewNotchTravelRafRef.current)
      previewNotchTravelRafRef.current = null
    }
    previewNotchTravelRef.current = null
    // The sub-pixel carry deliberately survives: it is under one pixel by
    // construction, it belongs to the reader rather than to any one gesture,
    // and discarding it here would reintroduce exactly the drip of lost
    // fractions it exists to stop.
    cancelWheelSpin(previewWheelSpinStateRef.current)

    // `.markdown-preview` carries `scroll-behavior: smooth`, so the coast
    // borrows `auto` for its own writes and must hand back whatever was
    // there -- the same borrow-and-return the page-key scroll does, and for
    // the same reason: a per-frame write that the browser then animates is
    // a coast chasing its own tail.
    previewWheelSpinScrollBehaviorRef.current?.()
    previewWheelSpinScrollBehaviorRef.current = null

    if (wasRunning && isWheelTraceOn()) appendWheelTrace(`preview   coast ENDED (${reason})`)
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
    // editor/scrollThumbMetrics.ts. The signature is every input that may
    // honestly change the size -- the document, the viewport, the track, and
    // the type geometry -- and deliberately not scrollHeight, which moves as
    // blocks are measured, nor the scroll position, which is none of the
    // size's business.
    const nextThumbHeight = thumbHeightCommitRef.current.resolve({
      signature: [
        activeNoteId ?? '',
        readEditorText().length,
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
  }, [applyPreviewThumbDom, isDraggingPreviewScrollThumb, isPreviewMode, previewScrollRef, previewDocumentPositionRef, activeNoteId, readEditorText, viewStyle, viewFontSize, viewSpacing, viewLetterSpacingEm])

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

    if (rubberBandRafRef.current !== null || isNonQuantizedSmoothScrollActive(scroller)) {
      cancelNonQuantizedSmoothScroll(scroller)
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
    // editorTextVersion is not read: a new text is one of the things that
    // changes the thumb's size.
  }, [isPreviewMode, syncPreviewCustomScrollbar, activeNoteId, editorTextVersion, viewStyle, viewFontSize, viewSpacing, viewLetterSpacingEm])

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
          text: readEditorText(),
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
  }, [previewScrollRef, previewBridgeHostRef, activeNoteId, readEditorText])

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
  }, [isPreviewMode, syncPreviewCustomScrollbar, previewScrollRef, previewDocumentPositionRef])

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
    // The scrollbar is not inside the scroller, so the coast's own
    // mousedown listener never sees a click here -- and a reader reaching
    // for the thumb has plainly stopped being carried along.
    stopPreviewWheelSpin('scrollbar')
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
  }, [previewScrollRef, shouldBlockPreviewInteraction, stopPreviewWheelSpin, handlePreviewTrackRightMouseDown, previewDocumentPositionRef, startThumbRubberBand, stopThumbRubberBand, syncPreviewCustomScrollbar])

  // A gesture in flight when this unmounts would otherwise fire its snap into
  // a torn-down pane.
  useEffect(() => () => { trackHoldCancelRef.current?.() }, [])

  const handlePreviewThumbMouseDown = useCallback((event: MouseEvent<HTMLDivElement>) => {
    if (shouldBlockPreviewInteraction()) return
    stopPreviewWheelSpin('scrollbar')
    if (event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    // The borrow belongs to the drag effect above, which runs before any
    // mousemove can be delivered.
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

    cancelNonQuantizedSmoothScroll(scroller)

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

  /**
   * Spin-to-keep-scrolling in the render view.
   *
   * The gesture, its sliders and its rules are the edit view's, whole and
   * unchanged: `editor/wheelSpin.ts` decides what a spin is, how long the
   * tail of one is ignored, when the next notch takes control back, and when
   * the coast has damped out. `editor/wheelNotch.ts` decides what counts as
   * a notch, so the same wheel on the same desk makes a nudge in both panes
   * at the same moment and a trackpad's sub-notch stream makes one in
   * neither. `editor/wheelStep.ts` says what a notch is worth.
   *
   * This pane owns every notch, exactly as the edit view does. It has to:
   * the reader's `step` is a number of line heights, and a notch cannot be
   * worth what they asked for while the browser is still scrolling it by
   * whatever pixel delta the device happened to send. That has a real cost
   * -- a non-passive wheel listener takes the pane's scrolling off the
   * compositor, measured at 4ms to first movement when passive against 33ms
   * when not, on a 1200-section note -- and it buys the thing the setting is
   * for: the same gesture moves the same amount of READING at any text size,
   * in both panes, on any machine.
   *
   * One thing is different from the edit view, and it follows from this pane
   * having no row grid: **the coast is continuous, not stepped**. The nudge
   * distance sets how far the coast travels and how fast, and nothing about
   * how the pixels are laid down -- `editor/wheelSpinProfile.ts` plans the
   * whole schedule at the moment the spin is detected and hands back a
   * smooth curve through it, ending in the shared release ramp. This loop
   * only reads that curve and pays the difference.
   */
  useEffect(() => {
    if (!isPreviewMode) return

    const scroller = previewScrollRef.current
    if (!scroller) return

    const spinState = previewWheelSpinStateRef.current
    const notchState = previewWheelNotchStateRef.current

    /**
     * The line height this pane actually renders at.
     *
     * Measured once per effect run rather than per wheel event: a
     * getComputedStyle inside a wheel handler is a forced style pass on
     * every notch, and the answer only changes when the view style, text
     * size or line spacing does -- all of which are in this effect's
     * dependencies, so the measurement is retaken exactly when it can have
     * moved.
     */
    let lineHeightPxCache: number | null = null
    const previewLineHeightPx = (): number => {
      if (lineHeightPxCache !== null) return lineHeightPxCache
      const style = window.getComputedStyle(scroller)
      const parsed = Number.parseFloat(style.lineHeight)
      if (Number.isFinite(parsed) && parsed > 0) {
        lineHeightPxCache = parsed
        return parsed
      }
      // `line-height: normal` reports as the keyword, not a length. The
      // 1.5 is this pane's own CSS default, not a guess at the browser's.
      const fontPx = Number.parseFloat(style.fontSize)
      lineHeightPxCache = Number.isFinite(fontPx) && fontPx > 0 ? fontPx * 1.5 : 24
      return lineHeightPxCache
    }

    /**
     * What one wheel event is worth here, in pixels, or 0 when the device
     * has not turned far enough to make a notch yet.
     *
     * Notches are counted by the shared accumulator (editor/wheelNotch.ts),
     * so the same wheel on the same desk makes a nudge in this pane and the
     * edit view at the same moment -- and a trackpad's sub-notch stream
     * makes one in neither. What a notch is WORTH is the reader's `step`,
     * measured in line heights (editor/wheelStep.ts): the same setting at
     * any text size moves the same amount of reading, which a pixel figure
     * cannot promise.
     */
    const resolveNudgePixels = (event: WheelEvent): number => {
      const notches = resolveWheelEventUnits(event, notchState, performance.now())
      if (notches === 0) return 0
      return Math.abs(notches) * getWheelStepLines() * previewLineHeightPx()
    }

    /**
     * The one write both a real notch and the coast's own motion go through.
     *
     * `.markdown-preview` carries `scroll-behavior: smooth` in CSS, which
     * applies to programmatic writes and would turn every notch into an
     * animation chasing the last one. The coast borrows `auto` for its whole
     * run; a lone notch borrows and returns it here, because the property is
     * only consulted at the moment of the write.
     */
    const scrollPreviewByPx = (deltaPx: number, traceLabel: string | null): boolean => {
      const maxScrollTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight)
      const beforeTop = scroller.scrollTop
      // Sub-pixel remainders are carried, not dropped. A step of 3.0 lines at
      // 25.6px is 76.8px, and a scroller that reports whole pixels would eat
      // the .8 on every notch -- a percent of the reader's setting, in the
      // direction of "the slider does not quite do what it says". The same
      // carry serves the coast, whose per-frame slice is a fraction of a
      // pixel far more often than a notch is.
      const owedPx = previewWheelSpinCarryPxRef.current + deltaPx
      const wholePx = Math.trunc(owedPx)
      previewWheelSpinCarryPxRef.current = owedPx - wholePx
      const nextScrollTop = clamp(beforeTop + wholePx, 0, maxScrollTop)
      // Borrowed for the single write rather than conditionally on whether
      // the coast already holds one: the lock counts, so taking a second
      // borrow while one is held costs an increment and cannot disturb it.
      const releaseForWrite = borrowAutoScrollBehavior(scroller)
      if (Math.abs(nextScrollTop - beforeTop) > 0.01) {
        scroller.scrollTop = nextScrollTop
        syncPreviewCustomScrollbar()
      }
      releaseForWrite()
      if (traceLabel !== null && isWheelTraceOn()) {
        appendWheelTrace(
          `${traceLabel} px=${deltaPx.toFixed(2)} lh=${previewLineHeightPx().toFixed(2)}` +
          ` step=${getWheelStepLines().toFixed(1)}` +
          ` top ${beforeTop.toFixed(2)}->${scroller.scrollTop.toFixed(2)}`,
        )
      }
      return scroller.scrollTop !== beforeTop
    }

    /**
     * One frame of a notch's glide.
     *
     * Deliberately thinner than `coastFrame`: a glide is at most a couple of
     * hundred milliseconds and cannot outlive the gesture that made it, so
     * the checks that end a coast on a changed setting or a document edge
     * have nothing to catch here. The two that do matter are the pane going
     * away and the transition blocking input, both of which mean this write
     * must not land at all.
     */
    /**
     * Tear a glide down and hand back what it borrowed.
     *
     * `.markdown-preview` carries `scroll-behavior: smooth` in CSS, and a
     * glide borrows `auto` for its whole run rather than per write. Leaving
     * that borrow standing would quietly turn off smooth behaviour for every
     * later programmatic scroll of this pane. A coast running now owns the
     * same borrow and returns it itself, so this must not take it back.
     */
    const endNotchTravel = () => {
      if (previewNotchTravelRafRef.current !== null) {
        cancelAnimationFrame(previewNotchTravelRafRef.current)
        previewNotchTravelRafRef.current = null
      }
      previewNotchTravelRef.current = null
      if (previewWheelSpinProfileRef.current === null) {
        previewWheelSpinScrollBehaviorRef.current?.()
        previewWheelSpinScrollBehaviorRef.current = null
      }
    }

    const notchFrame = (nowMs: number) => {
      previewNotchTravelRafRef.current = null
      const travel = previewNotchTravelRef.current
      if (!travel) return

      if (!isPreviewMode || !previewScrollRef.current || shouldBlockPreviewInteraction()) {
        endNotchTravel()
        return
      }
      // Something with a destination of its own took the scroller over --
      // the same rule the coast follows, and the same one check for all of
      // them.
      if (isNonQuantizedSmoothScrollActive(scroller)) {
        endNotchTravel()
        return
      }

      const step = takeWheelNotchTravelStep(travel, nowMs)
      if (step.pixels !== 0) scrollPreviewByPx(step.pixels, null)

      if (step.finished) {
        endNotchTravel()
        if (isWheelTraceOn()) appendWheelTrace('preview   notch glide LANDED')
        return
      }
      previewNotchTravelRafRef.current = requestAnimationFrame(notchFrame)
    }

    /**
     * Deliver `signedPixels` on a curve, splicing onto a glide already running.
     *
     * This is the whole of "a notch is travelled, not jumped": the first one
     * eases from rest, and every one after it picks up the exact velocity and
     * acceleration of the motion it interrupts, so a turning wheel reads as
     * one gathering movement rather than a train of separate hops.
     */
    const travelPreviewByNotch = (signedPixels: number, traceLabel: string | null) => {
      // Whatever else was travelling, the hand has just overruled it.
      cancelNonQuantizedSmoothScroll(scroller)
      if (previewWheelSpinScrollBehaviorRef.current === null) {
        previewWheelSpinScrollBehaviorRef.current = borrowAutoScrollBehavior(scroller)
      }

      const nowMs = performance.now()
      previewNotchTravelRef.current = retargetWheelNotchTravel(
        previewNotchTravelRef.current,
        signedPixels,
        nowMs,
      )
      if (traceLabel !== null && isWheelTraceOn()) {
        // Which kind of leg it is matters more than any single number here:
        // a `curve` leg is the one the ramp and shape sliders shape, a
        // `continuation` is the one that had to match a velocity instead.
        const leg = previewNotchTravelRef.current.leg
        appendWheelTrace(
          `${traceLabel} px=${signedPixels.toFixed(2)} leg=${leg.kind}` +
          ` owed=${(leg.kind === 'continuation' ? leg.plan.signedDistance : leg.signedDistance).toFixed(2)}` +
          ` over=${(leg.durationSec * 1000).toFixed(0)}ms` +
          (leg.kind === 'continuation' ? ` v0=${leg.plan.initialVelocity.toFixed(1)}` : ''),
        )
      }
      if (previewNotchTravelRafRef.current === null) {
        previewNotchTravelRafRef.current = requestAnimationFrame(notchFrame)
      }
    }

    const coastFrame = (nowMs: number) => {
      previewWheelSpinRafRef.current = null
      const profile = previewWheelSpinProfileRef.current
      if (!profile) return

      if (!isPreviewMode || !previewScrollRef.current) {
        stopPreviewWheelSpin('pane gone')
        return
      }
      if (shouldBlockPreviewInteraction()) {
        stopPreviewWheelSpin('scroll blocked')
        return
      }
      // The threshold going to its off position mid-coast means the feature
      // was switched off while it was running; honour that now, not at the
      // next spin.
      if (getWheelSpinEffectiveThresholdMs() <= 0) {
        stopPreviewWheelSpin('bypassed')
        return
      }
      // A search jump, a scrollbar travel, a chapter change: something with
      // a destination of its own has taken the scroller over. One check
      // covers every one of them, and covers the ones added later.
      if (isNonQuantizedSmoothScrollActive(scroller)) {
        stopPreviewWheelSpin('journey took over')
        return
      }

      const lastFrameMs = previewWheelSpinLastFrameMsRef.current
      previewWheelSpinLastFrameMsRef.current = nowMs
      // A frame that arrives after a long stall (a hidden window, a heavy
      // render) advances the coast's own clock by at most 100ms, so the
      // reader is not thrown a second's worth of travel in one jump. Inside
      // that cap the profile is still sampled at an absolute time rather
      // than accumulated per frame, so an ordinarily late frame -- the
      // common case, and the one the old per-frame payout quietly lost
      // distance on -- lands exactly where the schedule says it should.
      const advanceMs = lastFrameMs === null ? 0 : clamp(nowMs - lastFrameMs, 0, 100)
      previewWheelSpinClockMsRef.current += advanceMs
      const sample = sampleWheelSpinProfile(profile, previewWheelSpinClockMsRef.current)
      const owedPx = sample.travelledPx - previewWheelSpinPaidPxRef.current
      previewWheelSpinPaidPxRef.current = sample.travelledPx

      if (owedPx !== 0) {
        scrollPreviewByPx(profile.direction * owedPx, null)
        const maxScrollTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight)
        const nextScrollTop = scroller.scrollTop

        // Running out of scroller is not running out of document: a windowed
        // preview (editorSection/previewWindow.ts) reaches the end of its
        // mounted content many times on the way through a large note, with
        // more of it arriving a frame later. Only the document's own edge
        // ends a coast -- the edit view can use "it did not move" for this
        // and this pane cannot.
        const atScrollerEnd = (profile.direction < 0 && nextScrollTop <= 0.01)
          || (profile.direction > 0 && nextScrollTop >= maxScrollTop - 0.01)
        const position = previewDocumentPositionRef?.current
        if (atScrollerEnd && (position?.isAtDocumentEdge?.(profile.direction) ?? true)) {
          stopPreviewWheelSpin('document end')
          return
        }
      }

      if (sample.finished) {
        stopPreviewWheelSpin('damped out')
        return
      }

      previewWheelSpinRafRef.current = requestAnimationFrame(coastFrame)
    }

    const startPreviewWheelSpin = (
      direction: WheelSpinDirection,
      pixelsPerNudge: number,
      averageGapMs: number,
      carryPx: number,
    ) => {
      if (previewWheelSpinRafRef.current !== null) {
        cancelAnimationFrame(previewWheelSpinRafRef.current)
        previewWheelSpinRafRef.current = null
      }
      // Whatever else was travelling, the hand has just overruled it.
      cancelNonQuantizedSmoothScroll(scroller)
      if (previewWheelSpinScrollBehaviorRef.current === null) {
        previewWheelSpinScrollBehaviorRef.current = borrowAutoScrollBehavior(scroller)
      }
      // The glide's remainder is already in `carryPx`; the coast owns the
      // scroller and the borrow from here. Two writers is the one thing this
      // pane must never have.
      if (previewNotchTravelRafRef.current !== null) {
        cancelAnimationFrame(previewNotchTravelRafRef.current)
        previewNotchTravelRafRef.current = null
      }
      previewNotchTravelRef.current = null
      // The whole coast, decided here and not revisited: the dampening and
      // the cut off are read once, at the moment the hand set the gesture's
      // shape. See editor/wheelSpinProfile.ts.
      previewWheelSpinProfileRef.current = buildWheelSpinProfile({
        direction,
        pixelsPerNudge,
        averageGapMs,
        dampenDivisor: getWheelSpinDampenDivisor(),
        cutoffMs: getWheelSpinCutoffMs(),
        carryPx,
      })
      previewWheelSpinClockMsRef.current = 0
      previewWheelSpinPaidPxRef.current = 0
      // Null, not `nowMs`: the first frame pays out nothing and only
      // establishes the clock, so the coast begins one frame behind the
      // notch that started it rather than one frame ahead of it.
      previewWheelSpinLastFrameMsRef.current = null
      previewWheelSpinRafRef.current = requestAnimationFrame(coastFrame)
    }

    const handleWheel = (event: WheelEvent) => {
      const tracing = isWheelTraceOn()
      // This pane owns its notches now, so a blocked transition means the
      // wheel does nothing at all -- the same bargain the edit view makes.
      // A transition that blocks input and then lets a wheel scroll under it
      // is not blocking input.
      event.preventDefault()
      if (shouldBlockPreviewInteraction()) {
        if (tracing) appendWheelTrace(`preview wheel dy=${event.deltaY} DECLINED blocked`)
        stopPreviewWheelSpin('scroll blocked')
        return
      }
      if (event.deltaY === 0) return

      const pixels = resolveNudgePixels(event)
      if (pixels === 0) {
        if (tracing) {
          appendWheelTrace(
            `preview wheel dy=${event.deltaY} mode=${event.deltaMode} DECLINED sub-notch` +
            ` notch=${notchState.notchPx} pending=${notchState.pendingPx.toFixed(2)}`,
          )
        }
        return
      }

      const direction: WheelSpinDirection = event.deltaY > 0 ? 1 : -1
      const thresholdMs = getWheelSpinEffectiveThresholdMs()

      if (thresholdMs <= 0) {
        // The auto-scroll slider's off position: the spin machinery is not
        // consulted and not started. The step still applies -- what a notch
        // is worth is a different setting from whether a spin may outlive
        // the hand, and turning the second off must not silently change the
        // first.
        stopPreviewWheelSpin('bypassed')
        travelPreviewByNotch(
          direction * pixels,
          `preview wheel[spin off] dy=${event.deltaY} mode=${event.deltaMode}`,
        )
        return
      }

      const action = registerWheelSpinNudge(spinState, {
        nowMs: performance.now(),
        direction,
        // This pane's currency: pixels, not rows.
        rows: pixels,
        thresholdMs,
      })

      if (action.kind === 'ignore') {
        // The tail of the user's own spin, arriving while the coast runs.
        if (tracing) appendWheelTrace(`preview wheel dy=${event.deltaY} SWALLOWED spin-tail`)
        return
      }
      if (action.kind === 'stop') {
        // The bargain the edit view makes: the notch that stops the coast
        // scrolls nothing, so you can halt on the line you meant to.
        stopPreviewWheelSpin('user nudge')
        return
      }

      /**
       * One more line, on top of a coast already running.
       *
       * Added to the profile as a carry from the current clock rather than
       * scrolled directly: the coast owns the scroller, and a second writer
       * would fight it. The blend is a notch's own travel time, because this
       * is a fresh request from the reader and should visibly answer --
       * unlike the carry a coast is born with, which is merely owed.
       */
      const extendCoastByOneNudge = (rows: number, label: string): boolean => {
        const profile = previewWheelSpinProfileRef.current
        if (!profile) return false
        addWheelSpinProfileCarry(
          profile,
          direction * rows,
          previewWheelSpinClockMsRef.current,
          resolveWheelNotchTravelMs(),
        )
        if (isWheelTraceOn()) appendWheelTrace(`${label} px=${(direction * rows).toFixed(2)}`)
        return true
      }

      if (action.kind === 'extend') {
        // A nudge the coast's own way: not an interruption, a request for
        // more of what is already happening.
        if (extendCoastByOneNudge(action.rows, `preview wheel EXTEND dy=${event.deltaY}`)) return
        travelPreviewByNotch(direction * action.rows, `preview wheel[no coast] dy=${event.deltaY}`)
        return
      }

      if (action.kind === 'respin') {
        // Three quick nudges the coast's way. Worth adopting only if the
        // hand is now turning FASTER than the coast is going -- a reader
        // spinning harder wants more speed, and one spinning slower than the
        // coast has not asked it to slow down. The comparison is against the
        // profile's real speed at this instant, not the rate the coast was
        // planned at: a coast a second and a half old has decayed to a
        // seventh of that, and a respin that beats what is actually
        // happening is the one the reader can feel.
        const profile = previewWheelSpinProfileRef.current
        const currentSpeedPxPerMs = profile
          ? wheelSpinProfileSpeedPxPerMs(profile, previewWheelSpinClockMsRef.current)
          : 0
        const respinSpeedPxPerMs = action.rows / Math.max(1, action.averageGapMs)
        if (profile && respinSpeedPxPerMs > currentSpeedPxPerMs) {
          if (isWheelTraceOn()) {
            appendWheelTrace(
              `preview wheel RESPIN gap=${action.averageGapMs.toFixed(1)}ms` +
              ` ${(currentSpeedPxPerMs * 1000).toFixed(0)}->${(respinSpeedPxPerMs * 1000).toFixed(0)}px/s`,
            )
          }
          refreshWheelSpinCoast(spinState, performance.now(), action.averageGapMs, action.rows)
          // The new coast replaces this one, so it inherits whatever this one
          // was still folding in, as the glide's remainder is inherited
          // below: distance the hand turned is owed whoever delivers it.
          const undeliveredPx = wheelSpinProfileUndeliveredCarryPx(profile, previewWheelSpinClockMsRef.current)
          startPreviewWheelSpin(direction, action.rows, action.averageGapMs, (direction * action.rows) + undeliveredPx)
          return
        }
        // Not faster: it is still three nudges the reader asked for.
        if (extendCoastByOneNudge(action.rows, `preview wheel RESPIN-declined dy=${event.deltaY}`)) return
        travelPreviewByNotch(direction * action.rows, `preview wheel[no coast] dy=${event.deltaY}`)
        return
      }

      const traceLabel = `preview wheel[b=${thresholdMs} c=${getWheelSpinDampenDivisor()}` +
        `${action.startsCoast ? ' SPIN' : ''}] dy=${event.deltaY} mode=${event.deltaMode}`

      if (!action.startsCoast) {
        travelPreviewByNotch(direction * action.rows, traceLabel)
        return
      }

      // The third notch of a spin. It is still a notch and still owed, but
      // the coast is what will deliver it: read out everything the glide has
      // not paid yet -- this notch included -- and hand that to the profile
      // as its carry, so a spin travels the distance the hand actually
      // turned. Then the glide is torn down, because two owners writing the
      // same scroller is the one thing this pane must never do.
      const carryPx = remainingWheelNotchTravelPx(previewNotchTravelRef.current)
        + (direction * action.rows)
      if (isWheelTraceOn()) appendWheelTrace(`${traceLabel} carry=${carryPx.toFixed(2)}`)
      // The mean gap of the spin just detected -- the one thing the coast
      // knows about how hard the wheel was turned, and now the one input
      // its whole curve is planned from.
      const averageGapMs = spinState.coast?.averageGapMs ?? thresholdMs
      startPreviewWheelSpin(direction, action.rows, averageGapMs, carryPx)
    }

    // Anything that means the reader is now doing something other than
    // being carried along ends the coast, exactly as in the edit view.
    const cancelOnOtherInput = () => stopPreviewWheelSpin('other input')

    /**
     * A keystroke ends a coast -- but this pane cannot listen for one on its
     * own scroller the way the edit view does.
     *
     * The edit view's scroller holds the focused editable, so every keystroke
     * made while reading it arrives there. Nothing in the render view is
     * focusable (unless render-view spell check has made it contentEditable),
     * so a keystroke goes to the body and a scroller-scoped listener never
     * sees it -- confirmed live: the coast sailed straight through a
     * keypress. Hence the window, narrowed to the two cases that are this
     * pane's business: a key pressed inside it, or a key pressed anywhere
     * while this is the section the reader is working in. A keystroke into
     * the OTHER pane of a split is that pane's, and does not stop this one.
     */
    const cancelOnWindowKeyDown = (event: globalThis.KeyboardEvent) => {
      const target = event.target
      const insideThisPane = target instanceof Node && scroller.contains(target)
      if (!insideThisPane && !isSectionActive) return
      stopPreviewWheelSpin('keystroke')
    }

    scroller.addEventListener('wheel', handleWheel, { passive: false })
    scroller.addEventListener('mousedown', cancelOnOtherInput, { capture: true })
    window.addEventListener('keydown', cancelOnWindowKeyDown, { capture: true })

    return () => {
      scroller.removeEventListener('wheel', handleWheel)
      scroller.removeEventListener('mousedown', cancelOnOtherInput, { capture: true })
      window.removeEventListener('keydown', cancelOnWindowKeyDown, { capture: true })
      stopPreviewWheelSpin('unmount')
    }
  }, [
    isPreviewMode,
    isSectionActive,
    previewScrollRef,
    previewDocumentPositionRef,
    shouldBlockPreviewInteraction,
    stopPreviewWheelSpin,
    syncPreviewCustomScrollbar,
    activeNoteId,
    // Not incidental: these are what the pane's line height is made of, and
    // the step is measured in line heights. Re-running the effect is how the
    // measurement is retaken.
    viewStyle,
    viewFontSize,
    viewSpacing,
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
    travelPreviewToRatio,
  }
}
