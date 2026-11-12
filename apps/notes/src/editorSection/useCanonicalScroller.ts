import { SCROLL_TRACK_EDGE_GAP_PX } from '@thockdown/interaction/scrollTrackGeometry'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { MouseEvent, MutableRefObject, PointerEvent } from 'react'
import type { PreviewDocumentPositionApi } from './usePreviewMarkdownRendering'
import { beginScrollTrackHold } from '../scroll/scrollTrackHold'
import { registerScrollBridge } from '../scroll/scrollBridge'
import { createThumbRubberBand } from '../scroll/scrollThumbRubberBand'
import { createTrackRightHold } from '../scroll/trackRightHold'
import { createCommittedThumbHeight } from '../scroll/scrollThumbMetrics'
import { measureAverageCharWidthPx } from '../scroll/scrollBridgeTexture'
import { createContinuousWheel, type ContinuousWheel } from '../scroll/continuousWheel'
import { borrowAutoScrollBehavior } from '@thockdown/interaction/scrollBehaviorLock'
import { scrollToNonQuantizedSmooth } from '@thockdown/interaction/NonQuantizedSmoothScroll'
import { createPageKeys, type PageKeys } from '../scroll/pageKeys'
import { cancelSmoothScroll, isSmoothScrollActive } from '@thockdown/interaction/smoothScrollRegistry'
import { clamp } from '@thockdown/interaction/clamp'


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
  documentPositionRef?: MutableRefObject<PreviewDocumentPositionApi | null>
  /**
   * The pane box the long-journey bridge draws into (scroll/scrollBridge.ts).
   *
   * Deliberately the render CONTAINER rather than the scroller: a curtain
   * inside the scroller would scroll with the content and add its own height
   * to the scrollable area, which for a bridge this tall would be a good deal
   * worse than merely wrong.
   */
  bridgeHostRef?: MutableRefObject<HTMLDivElement | null>
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
 * What is particular to the reader (a document only partly drawn, and the
 * bridge over a long journey) arrives through the optional ports
 * `documentPositionRef` and `bridgeHostRef`; a scroller without them is
 * driven by its pixels alone. The wheel and the page keys are the shared
 * drivers in scroll/ (continuousWheel.ts, pageKeys.ts), and the scrollbar's
 * right hold and rubber band are scroll/trackRightHold.ts and
 * scroll/scrollThumbRubberBand.ts, which the editor's row-quantized
 * scrollbar uses too.
 *
 * Direct DOM mutation instead of React state is deliberate: per-frame scroll
 * events would otherwise re-render the host on every tick.
 */
export function useCanonicalScroller({
  isEnabled,
  isScrollInteractionBlocked,
  scrollerRef,
  ownsKeyboard = true,
  layoutKey,
  textureRef,
  documentPositionRef,
  bridgeHostRef,
  readBridgeText,
}: UseCanonicalScrollerOptions) {
  const ownTextureRef = useRef<HTMLDivElement>(null)
  const textureLayerRef = textureRef ?? ownTextureRef
  const scrollbarTrackRef = useRef<HTMLDivElement | null>(null)
  const scrollbarRafRef = useRef<number | null>(null)
  const thumbDragOriginRef = useRef<{ pointerY: number; thumbTopPx: number } | null>(null)
  const scrollbarThumbRef = useRef<HTMLDivElement | null>(null)
  const thumbTopRef = useRef(0)
  const thumbHeightRef = useRef(0)
  const thumbHeightCommitRef = useRef(createCommittedThumbHeight())
  const trackHoldCancelRef = useRef<(() => void) | null>(null)
  // This scroller's wheel driver (scroll/continuousWheel.ts), created by the
  // wheel effect below for the element it binds to.
  const wheelRef = useRef<ContinuousWheel | null>(null)
  const [isThumbActive, setIsThumbActive] = useState(false)
  const [isDraggingThumb, setIsDraggingThumb] = useState(false)

  const isBlocked = useCallback(() => {
    if (!isEnabled) return true
    return isScrollInteractionBlocked?.() ?? false
  }, [isEnabled, isScrollInteractionBlocked])

  /**
   * End a coast, whatever it was doing, and say why in the wheel trace.
   *
   * Declared up here rather than beside the wheel handler because the
   * scrollbar's own handlers -- a track click, a thumb drag -- have to be
   * able to call it, and they are defined further down. Everything it
   * touches is a ref, so it has no dependency on any of that.
   */
  const stopWheelSpin = useCallback((reason: string) => {
    wheelRef.current?.stop(reason)
  }, [])

  const paintThumb = useCallback((topPx: number, heightPx: number) => {
    thumbTopRef.current = topPx
    thumbHeightRef.current = heightPx
    const thumbEl = scrollbarThumbRef.current
    if (!thumbEl) return
    thumbEl.style.top = `${topPx}px`
    thumbEl.style.height = `${Math.max(0, heightPx)}px`
  }, [])

  // The loop is scroll/scrollThumbRubberBand.ts's, shared with the editor.
  // It is made once; the sync it hands the thumb back to is read through a
  // ref, since the sync itself asks whether the band is running.
  const syncScrollbarRef = useRef<(options?: { force?: boolean }) => void>(() => {})
  const [rubberBand] = useState(() => createThumbRubberBand({
    scroller: () => scrollerRef.current,
    thumbHeightPx: () => thumbHeightRef.current,
    paint: paintThumb,
    onSettled: () => syncScrollbarRef.current({ force: true }),
  }))
  useEffect(() => rubberBand.stop, [rubberBand])

  const syncScrollbar = useCallback((options?: { force?: boolean }) => {
    // The rubber band owns the thumb for the length of a bridged journey, the
    // same way a drag does. Both would otherwise be overwritten every frame by
    // a sync reading the real scroll position -- which during a bridge is
    // mid-cut and says nothing anybody wants drawn.
    if ((isDraggingThumb || rubberBand.isRunning()) && !options?.force) {
      return
    }

    if (!isEnabled) {
      paintThumb(0, 0)
      setIsThumbActive(false)
      return
    }

    const scroller = scrollerRef.current
    const track = scrollbarTrackRef.current
    if (!scroller) return

    if (textureLayerRef.current) {
      // Not scrollTop: on a windowed pane that number jumps every time the
      // window's front edge moves, and the texture would slip against the
      // text it is meant to be printed on.
      const continuousOffsetPx = documentPositionRef?.current?.readContinuousScrollOffsetPx?.()
      syncTextureToScroll(continuousOffsetPx ?? scroller.scrollTop, textureLayerRef.current)
    }

    if (!track) return

    const viewportHeight = scroller.clientHeight
    const contentHeight = scroller.scrollHeight
    const trackHeight = track.clientHeight
    const usableTrackHeight = Math.max(0, trackHeight - (SCROLL_TRACK_EDGE_GAP_PX * 2))
    if (viewportHeight <= 0 || contentHeight <= 0 || trackHeight <= 0) {
      paintThumb(0, 0)
      setIsThumbActive(false)
      return
    }

    if (contentHeight <= viewportHeight) {
      paintThumb(SCROLL_TRACK_EDGE_GAP_PX, usableTrackHeight)
      setIsThumbActive(false)
      return
    }

    // Both numbers come from the document itself (editor/documentPosition.ts),
    // which answers in ratios and does not say whether this document is being
    // measured or modelled underneath. The pixel fallbacks below are for the
    // one frame before it can answer at all -- not a second opinion.
    const position = documentPositionRef?.current ?? null

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
      minThumbHeightPx: scrollbarThumbRef.current?.offsetWidth ?? 0,
    })

    const maxScrollTop = contentHeight - viewportHeight
    const maxThumbTop = Math.max(0, usableTrackHeight - nextThumbHeight)

    const scrollRatio = position?.readScrollRatio()
      ?? (maxScrollTop > 0 ? clamp(scroller.scrollTop / maxScrollTop, 0, 1) : 0)
    const nextThumbTop = SCROLL_TRACK_EDGE_GAP_PX + Math.round(maxThumbTop * scrollRatio)

    paintThumb(nextThumbTop, nextThumbHeight)
    setIsThumbActive(true)
  }, [paintThumb, isDraggingThumb, isEnabled, scrollerRef, documentPositionRef, textureLayerRef, layoutKey, rubberBand])

  useEffect(() => { syncScrollbarRef.current = syncScrollbar }, [syncScrollbar])

  /**
   * The thumb top a ratio corresponds to. The one conversion the track click
   * and a travel started from elsewhere have to agree on, or the band sets off
   * for a destination the sync does not put it at.
   */
  const resolveThumbTopForRatio = useCallback((ratio: number): number => {
    const track = scrollbarTrackRef.current
    const trackHeight = track?.clientHeight ?? 0
    const usableTrackHeight = Math.max(0, trackHeight - (SCROLL_TRACK_EDGE_GAP_PX * 2))
    const maxThumbTop = Math.max(0, usableTrackHeight - thumbHeightRef.current)
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
  const travelToRatio = useCallback((ratio: number): boolean => {
    const scroller = scrollerRef.current
    const position = documentPositionRef?.current
    if (!scroller || !position) return false

    if (rubberBand.isRunning() || isSmoothScrollActive(scroller)) {
      cancelSmoothScroll(scroller)
      rubberBand.stop()
      syncScrollbar({ force: true })
    }

    const startThumbTopPx = thumbTopRef.current
    const timing = position.travelToRatio(ratio)
    if (timing) rubberBand.start(timing, startThumbTopPx, resolveThumbTopForRatio(ratio))
    return true
  }, [
    scrollerRef,
    documentPositionRef,
    resolveThumbTopForRatio,
    rubberBand,
    syncScrollbar,
  ])

  const scrollFromThumbTop = useCallback((thumbTopPx: number) => {
    const scroller = scrollerRef.current
    const track = scrollbarTrackRef.current
    if (!scroller || !track) return

    const trackHeight = track.clientHeight
    const usableTrackHeight = Math.max(0, trackHeight - (SCROLL_TRACK_EDGE_GAP_PX * 2))
    const maxThumbTravel = Math.max(0, usableTrackHeight - thumbHeightRef.current)
    const minThumbTop = SCROLL_TRACK_EDGE_GAP_PX
    const maxThumbTop = SCROLL_TRACK_EDGE_GAP_PX + maxThumbTravel
    const clampedTop = Math.max(minThumbTop, Math.min(thumbTopPx, maxThumbTop))
    paintThumb(clampedTop, thumbHeightRef.current)
    const ratio = maxThumbTravel > 0 ? (clampedTop - SCROLL_TRACK_EDGE_GAP_PX) / maxThumbTravel : 0

    // The exact inverse of the reading above, and it has to stay that way:
    // reading position in one space and writing it in another would drop the
    // thumb somewhere other than where it was released. Routing both through
    // the same object is what guarantees it.
    const position = documentPositionRef?.current
    if (position) {
      position.jumpToRatio(ratio)
      return
    }

    const maxScrollTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight)
    scroller.scrollTop = ratio * maxScrollTop
  }, [paintThumb, scrollerRef, documentPositionRef])

  useEffect(() => {
    if (!isEnabled) return
    syncScrollbar()
    // layoutKey is not read: it is one of the things that changes the thumb's size.
  }, [isEnabled, syncScrollbar, layoutKey])

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
    const scroller = scrollerRef.current
    const host = bridgeHostRef?.current
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
  }, [scrollerRef, bridgeHostRef, readBridgeText])

  useEffect(() => {
    if (!isEnabled) return

    const scroller = scrollerRef.current
    if (!scroller) return

    const onScroll = () => {
      syncScrollbar()
    }

    scroller.addEventListener('scroll', onScroll, { passive: true })
    return () => scroller.removeEventListener('scroll', onScroll)
  }, [isEnabled, syncScrollbar, scrollerRef, documentPositionRef])

  useEffect(() => {
    if (!isEnabled) return

    const scroller = scrollerRef.current
    if (!scroller) return

    // Coalesced, not debounced: a request while one is pending joins it.
    // Cancelling the pending frame and asking for the next one never ran
    // while something mutated the content every frame (an accordion section
    // animating its height writes a style each frame from its own rAF
    // callback), so the thumb stood still for the whole animation.
    const scheduleSync = () => {
      if (scrollbarRafRef.current !== null) return
      scrollbarRafRef.current = requestAnimationFrame(() => {
        scrollbarRafRef.current = null
        syncScrollbar()
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
      if (scrollbarRafRef.current !== null) {
        cancelAnimationFrame(scrollbarRafRef.current)
        scrollbarRafRef.current = null
      }
    }
  }, [isEnabled, syncScrollbar, scrollerRef, documentPositionRef])

  useEffect(() => {
    if (!isDraggingThumb) return

    const onPointerMove = (event: globalThis.PointerEvent) => {
      const origin = thumbDragOriginRef.current
      if (!origin) return
      const deltaY = event.clientY - origin.pointerY
      scrollFromThumbTop(origin.thumbTopPx + deltaY)
    }

    const onPointerUp = () => {
      setIsDraggingThumb(false)
      thumbDragOriginRef.current = null
      requestAnimationFrame(() => syncScrollbar({ force: true }))
    }

    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
    window.addEventListener('pointercancel', onPointerUp)
    return () => {
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
      window.removeEventListener('pointercancel', onPointerUp)
    }
  }, [isDraggingThumb, scrollFromThumbTop, syncScrollbar])

  useEffect(() => {
    const scroller = scrollerRef.current
    if (!scroller) return

    // A drag is a cross-frame borrow like any other, so it goes through the
    // lock. Writing the property directly here is what made this a stealer:
    // the effect re-runs on every drag state change and used to hand the
    // property back to the empty string, whether or not a journey or a coast
    // was in the middle of using it.
    if (!isDraggingThumb) return
    const release = borrowAutoScrollBehavior(scroller)
    return release
  }, [isDraggingThumb, scrollerRef])

  // Right-click-and-hold on the track pages in the clicked direction for as
  // long as the button is held, exactly like holding PageUp/PageDown -- it's
  // pressed through the same page keys (scroll/pageKeys.ts), published by the
  // key effect below. The track hold calls them directly rather than dispatching
  // a key on window: a window key would also reach every other scroller and
  // the editor, and would be refused here whenever this scroller does not
  // own the keyboard (the sidebar never does).
  const pageKeysRef = useRef<PageKeys | null>(null)

  const [trackRightHold] = useState(() => createTrackRightHold({
    track: () => scrollbarTrackRef.current,
    pageKeys: () => pageKeysRef.current,
    // The painted thumb, which the scroll sync keeps current. It is the only
    // honest answer for a windowed note: its thumb is placed by character
    // position (documentPositionRef), and the mounted pixels say nothing
    // about where in the document the reader is.
    liveThumb: () => (scrollbarTrackRef.current
      ? { topPx: thumbTopRef.current, heightPx: thumbHeightRef.current }
      : null),
  }))
  useEffect(() => trackRightHold.stop, [trackRightHold])

  const handleTrackRightPointerDown = useCallback((event: PointerEvent<HTMLDivElement>) => {
    if (isBlocked()) return
    trackRightHold.begin(event.clientY)
  }, [isBlocked, trackRightHold])

  const handleTrackContextMenu = useCallback((event: MouseEvent<HTMLDivElement>) => {
    event.preventDefault()
  }, [])

  const handleTrackPointerDown = useCallback((event: PointerEvent<HTMLDivElement>) => {
    if (isBlocked()) return
    // The scrollbar is not inside the scroller, so the coast's own
    // mousedown listener never sees a click here -- and a reader reaching
    // for the thumb has plainly stopped being carried along.
    stopWheelSpin('scrollbar')
    if (event.button === 2) {
      handleTrackRightPointerDown(event)
      return
    }
    if (event.button !== 0) return

    const track = scrollbarTrackRef.current
    const scroller = scrollerRef.current
    if (!track || !scroller) return

    const rect = track.getBoundingClientRect()
    const clickY = event.clientY - rect.top
    const thumbHeightPx = thumbHeightRef.current
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
        const el = scrollerRef.current
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
          const position = documentPositionRef?.current
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
          syncScrollbar({ force: true })
        }
        expectedTopPx = el.scrollTop
        requestAnimationFrame(step)
      }
      requestAnimationFrame(step)
    }
    const landOnDocumentEndAfterJourney = () => {
      const waitForArrival = () => {
        const el = scrollerRef.current
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
    const scrollerNow = scrollerRef.current
    const journeyInFlight = rubberBand.isRunning()
      || (!!scrollerNow && isSmoothScrollActive(scrollerNow))

    const goTo = (instant: boolean) => {
      const element = scrollerRef.current
      if (!element) return
      const position = documentPositionRef?.current
      if (position) {
        if (instant) {
          // Land, and hand the thumb back at its committed size. Without
          // stopping the band first it goes on stretching toward a target
          // nobody is travelling to.
          cancelSmoothScroll(element)
          rubberBand.stop()
          position.jumpToRatio(ratio)
          syncScrollbar({ force: true })
          if (aimedAtEnd) landOnDocumentEnd()
          return
        }
        const startThumbTopPx = thumbTopRef.current
        const timing = position.travelToRatio(ratio)
        if (timing) rubberBand.start(timing, startThumbTopPx, clampedTop)
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
  }, [scrollerRef, isBlocked, stopWheelSpin, handleTrackRightPointerDown, documentPositionRef, rubberBand, syncScrollbar])

  // A gesture in flight when this unmounts would otherwise fire its snap into
  // a torn-down pane.
  useEffect(() => () => { trackHoldCancelRef.current?.() }, [])

  const handleThumbPointerDown = useCallback((event: PointerEvent<HTMLDivElement>) => {
    if (isBlocked()) return
    stopWheelSpin('scrollbar')
    if (event.button !== 0) return
    // No preventDefault: cancelling a pointerdown suppresses the mousedown
    // that focusOwnership.ts reads to keep the keyboard where it is.
    event.stopPropagation()
    // The borrow belongs to the drag effect above, which runs before any
    // pointermove can be delivered.
    setIsDraggingThumb(true)
    thumbDragOriginRef.current = {
      pointerY: event.clientY,
      thumbTopPx: thumbTopRef.current,
    }
  }, [isBlocked, stopWheelSpin])

  /**
   * The page keys (scroll/pageKeys.ts): one page is 90% of the scroller's
   * height, written sub-pixel on the reader's own engine. A windowed
   * scroller's edge is the document's only where the window says so.
   */
  useEffect(() => {
    if (!isEnabled) return
    const scroller = scrollerRef.current
    if (!scroller) return
    const pageKeys = createPageKeys({
      scroller,
      isBlocked: isBlocked,
      pageStepPx: () => Math.max(1, scroller.clientHeight * 0.9),
      travelTo: (target) => scrollToNonQuantizedSmooth(scroller, target, { onStep: () => syncScrollbar() }),
      onScrolled: () => syncScrollbar(),
      isAtDocumentEdge: documentPositionRef
        ? (direction) => documentPositionRef.current?.isAtDocumentEdge?.(direction) ?? true
        : undefined,
    })
    pageKeysRef.current = pageKeys

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
      return target.isContentEditable && (scrollerRef.current?.contains(target) ?? false)
    }

    const onWindowKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.defaultPrevented) return
      if (!ownsKeyboard) return
      if (targetOwnsPageKeys(event.target)) return
      if (event.key !== 'PageDown' && event.key !== 'PageUp') return
      if (pageKeys.press(event.key, event.repeat)) event.preventDefault()
    }
    const onWindowKeyUp = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'PageDown' || event.key === 'PageUp') pageKeys.release(event.key)
    }
    const onWindowBlur = () => pageKeys.reset()

    window.addEventListener('keydown', onWindowKeyDown)
    window.addEventListener('keyup', onWindowKeyUp)
    window.addEventListener('blur', onWindowBlur)
    return () => {
      window.removeEventListener('keydown', onWindowKeyDown)
      window.removeEventListener('keyup', onWindowKeyUp)
      window.removeEventListener('blur', onWindowBlur)
      pageKeys.reset()
      if (pageKeysRef.current === pageKeys) pageKeysRef.current = null
    }
  }, [
    isEnabled,
    ownsKeyboard,
    isBlocked,
    syncScrollbar,
    scrollerRef,
    documentPositionRef,
  ])

  /**
   * The wheel: every notch is this scroller's own (scroll/continuousWheel.ts),
   * so a notch is worth the reader's step in line heights on every surface.
   * Recreated when the layout changes, because the driver measures the line
   * height once.
   */
  useEffect(() => {
    if (!isEnabled) return
    const scroller = scrollerRef.current
    if (!scroller) return
    const wheel = createContinuousWheel({
      scroller,
      isBlocked: isBlocked,
      onScrolled: () => syncScrollbar(),
      isAtDocumentEdge: documentPositionRef
        ? (direction) => documentPositionRef.current?.isAtDocumentEdge?.(direction) ?? true
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
      if (!insideThisScroller && !ownsKeyboard) return
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
    isEnabled,
    ownsKeyboard,
    scrollerRef,
    documentPositionRef,
    isBlocked,
    syncScrollbar,
    layoutKey,
  ])

  // Native scroll (covers mouse wheel, trackpad, keyboard when not intercepted)
  const handleScroll = useCallback(() => {
    if (!scrollerRef.current || !textureLayerRef.current) return;
    syncTextureToScroll(scrollerRef.current.scrollTop, textureLayerRef.current);
  }, [scrollerRef, textureLayerRef]);

  return {
    textureLayerRef,
    scrollbarTrackRef,
    scrollbarThumbRef,
    isThumbActive,
    isDraggingThumb,
    syncScrollbar,
    handleTrackPointerDown,
    handleTrackContextMenu,
    handleThumbPointerDown,
    handleScroll,
    travelToRatio,
  }
}
