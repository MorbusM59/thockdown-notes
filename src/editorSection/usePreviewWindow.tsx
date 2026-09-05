import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import type { MutableRefObject, ReactNode } from 'react'
import type { PreviewMarkdownBlock as PreviewBlock } from '../editor/PreviewBlockSplit'
import { isNonQuantizedSmoothScrollActive } from '../editor/NonQuantizedSmoothScroll'
import {
  findBlockAtChar,
  findBlockAtPixel,
  resolveLastScreenChars,
  resolvePreviewCharViewport,
  type PreviewBlockMeasurement,
  type PreviewCharViewport,
} from './previewCharPosition'
import {
  isWithinPreviewWindow,
  planPreviewWindowAround,
  resolvePreviewWindowAdjustment,
  type PreviewWindowRange,
} from './previewWindow'

/**
 * The windowed preview: the scroller holds a moving run of blocks, and
 * nothing else exists.
 *
 * See previewWindow.ts for what a window is and why the runway is sized the
 * way it is. This module is the part that touches the DOM: it renders the
 * window, measures it, moves it, and answers where the reader is.
 *
 * WHAT IS DIFFERENT FROM THE VIRTUALIZED PATH
 *  - Blocks are laid out by the browser in ordinary flow, not placed by us at
 *    a computed offset. There is no arithmetic to be wrong: `offsetTop` is
 *    where the block IS.
 *  - `scrollTop` is window-local and means nothing outside it. Every position
 *    that outlives a frame is a character offset (previewCharPosition.ts),
 *    which is the same currency the scrollbar already speaks.
 *  - Nothing is estimated. The one guess in the whole design -- the mean block
 *    height, used to decide how many blocks to add in one pass -- can only
 *    cost an extra pass, never a wrong landing.
 *
 * Each block keeps a wrapper with `display: flow-root`. That is not cosmetic:
 * the virtualized path gives every block an absolutely positioned box, so
 * adjacent blocks never collapse their margins into each other. Wrappers in
 * ordinary flow would, and every gap in the document would close up by the
 * smaller of its two margins. `flow-root` makes each wrapper its own block
 * formatting context, which reproduces the virtualized spacing exactly while
 * letting the browser do the positioning.
 */

/**
 * Opt-in trace of every window movement -- see CLAUDE.md's diagnostic traces.
 *
 * `localStorage['thockdown:debug-preview-window'] = '1'`, reload, reproduce,
 * then `copy(window.__previewWindowTrace.join('\n'))`. Attaches nothing when
 * unset.
 *
 * Buffered as well as logged, because the interesting defects here are the ones
 * that repeat: a two-state oscillation is invisible in a console that is
 * scrolling past, and obvious in forty lines side by side. Every line carries
 * the scrollTop BEFORE and AFTER, because a movement of the window and a
 * movement of the reader are different events that look identical from outside.
 */
let previewWindowDebugFlag: boolean | null = null
function isPreviewWindowDebugOn(): boolean {
  if (previewWindowDebugFlag === null) {
    try {
      previewWindowDebugFlag = typeof window !== 'undefined'
        && window.localStorage.getItem('thockdown:debug-preview-window') === '1'
    } catch {
      previewWindowDebugFlag = false
    }
  }
  return previewWindowDebugFlag
}

function tracePreviewWindow(line: string): void {
  if (!isPreviewWindowDebugOn()) return
  const w = window as unknown as { __previewWindowTrace?: string[] }
  if (!w.__previewWindowTrace) w.__previewWindowTrace = []
  w.__previewWindowTrace.push(line)
  if (w.__previewWindowTrace.length > 400) w.__previewWindowTrace.shift()
  console.log('[preview-window] ' + line)
}

/** How the reader's position is carried across a window change. */
interface PreviewWindowAnchor {
  blockIndex: number
  /** The block's own top, in the window's pixel space, before the change. */
  startPx: number
  /** Where the viewport sat, in that same space, before the change. */
  scrollTopPx: number
}

/**
 * How many trailing blocks to render when measuring the document's last screen,
 * and the ceiling on that search.
 *
 * It doubles until the measured tail covers a viewport, so the starting number
 * only decides how many passes an ordinary document takes -- eight covers a
 * screen of prose in one. The ceiling is what stops a document of empty blocks
 * from mounting itself entirely in the name of measuring its own end.
 */
const PREVIEW_TAIL_PROBE_INITIAL_BLOCKS = 8
const PREVIEW_TAIL_PROBE_MAX_BLOCKS = 512

/** A scroll that can only be performed once a particular window is mounted. */
interface PendingWindowScroll {
  blockIndex: number
  /** How far into the block to land, 0..1. */
  fraction: number
}

export interface PreviewWindowApi {
  /** Null when the window cannot answer yet -- nothing mounted, no geometry. */
  readCharViewport: () => PreviewCharViewport | null
  /** The mounted blocks' measured geometry, in document indices. */
  readMeasurements: () => readonly PreviewBlockMeasurement[]
  /** Puts `charOffset` at the top of the viewport, re-anchoring if it has to. */
  scrollToChar: (charOffset: number) => void
  /**
   * The same, then settles the window, and reports where the reader ended up.
   *
   * For a caller that has to AIM at the result -- the bridged journey's
   * ramp-down, which plays out over the next couple of hundred milliseconds and
   * needs a pixel that will still mean the same thing when it gets there.
   *
   * Landing alone is not enough for that. A window mounted around a target sits
   * with the target a third of the way in, so its backward runway is short, and
   * the very next adjustment pass grows it and compensates `scrollTop` to keep
   * the reader still. That compensation is correct and invisible normally --
   * but an animation already aiming at the pre-compensation pixel will overwrite
   * it every frame and land the reader wherever the old number pointed.
   * Measured: a track click that should have arrived at block 34 arrived at
   * block 16, one screenful short, every single time.
   *
   * So this runs the adjustment to a standstill first. It is a synchronous
   * commit or three, at the one moment they cost nothing: the pane is covered
   * by the curtain.
   */
  landOnChar: (charOffset: number) => number | null
  /**
   * The window-local pixel offset for `charOffset`, or null when that
   * character is not mounted. For a caller that needs a pixel it can animate
   * to rather than a place to be put.
   */
  resolveCharOffsetPx: (charOffset: number) => number | null
  /**
   * How many characters the document's last screenful holds.
   *
   * The scrollbar's span is `totalChars - this`, which is what makes the thumb
   * reach both ends of its track exactly. Measured once per document and
   * geometry from the real tail; null until that measurement has landed, so a
   * caller can stand in an estimate for a frame rather than be handed one
   * dressed up as a fact.
   */
  readLastScreenChars: () => number | null
  /**
   * A scroll offset that keeps counting across window changes.
   *
   * `scrollTop` alone jumps every time the front edge moves, so anything glued
   * to the content by it -- the paper texture's mask position -- would slip by
   * the compensated amount at every shift. This adds up what the compensations
   * took out, so the sum moves only when the reader does.
   */
  readContinuousScrollOffsetPx: () => number
  /**
   * Whether the scroller's end in `direction` is the DOCUMENT's end.
   *
   * A windowed scroller runs out of room constantly -- that is what a runway
   * being consumed looks like from the outside -- and anything that treats
   * running out of room as "the reader has arrived" will stop them dead in the
   * middle of the document. Only this can tell the two apart.
   */
  isAtDocumentEdge: (direction: -1 | 1) => boolean
}

export interface UsePreviewWindowOptions {
  enabled: boolean
  previewScrollRef: MutableRefObject<HTMLDivElement | null>
  previewBlocks: readonly PreviewBlock[]
  blockCharOffsetsRef: MutableRefObject<Float64Array | null>
  /**
   * Renders one block. Supplied by the caller rather than built here so the
   * windowed path mounts the SAME memoized component the virtualized path
   * does -- a second copy would have its own memo cache and would reparse
   * every block this one had already rendered.
   */
  renderBlock: (block: PreviewBlock, documentIndex: number) => ReactNode
  /**
   * Rendered as the window's first child, before any block.
   *
   * For the typography probe, which the thumb's line metrics are read from
   * and which therefore has to exist on this path too. It must sit INSIDE
   * this container rather than in the scroller: the scroller is
   * position:relative and carries --preview-edge-padding, so an absolutely
   * positioned probe attached there resolves `width: 100%` against the
   * padding box and reads 36px wider than a real block -- which would put
   * too many characters on every line and size the thumb from a document
   * that looks shorter than it is.
   */
  overlay?: ReactNode
  /**
   * An element whose box changes when the TYPOGRAPHY does -- the character
   * ruler in the overlay above.
   *
   * The last screen's character count depends on the pane's geometry, so it has
   * to be re-measured when that geometry moves. Watching the ruler rather than
   * the window's own container is deliberate: the container's height changes
   * every time the window shifts, which is constantly, and restarting the tail
   * probe on each of those would be a measurement running forever. The ruler
   * moves only when the font, its size, its letter spacing or the pane's width
   * do -- which is exactly the set of changes that invalidate the answer.
   */
  geometryProbeRef?: MutableRefObject<HTMLElement | null>
  /** Changes whenever the rendered document does, so the window can reset. */
  renderedDisplayText: string
  activeNoteId: string | null
}

export function usePreviewWindow(options: UsePreviewWindowOptions): {
  element: ReactNode
  api: PreviewWindowApi
} {
  const {
    enabled,
    previewScrollRef,
    previewBlocks,
    blockCharOffsetsRef,
    renderBlock,
    overlay,
    geometryProbeRef,
    renderedDisplayText,
    activeNoteId,
  } = options

  const containerRef = useRef<HTMLDivElement | null>(null)
  const [range, setRange] = useState<PreviewWindowRange>({ startIndex: 0, endIndex: -1 })
  const rangeRef = useRef(range)
  rangeRef.current = range

  const previewBlocksRef = useRef(previewBlocks)
  previewBlocksRef.current = previewBlocks

  // Rebuilt in a layout effect after every window change and on any resize of
  // the mounted content. Read on every scroll frame, so it must never force a
  // layout of its own -- flow geometry does not move between those rebuilds.
  const measurementsRef = useRef<PreviewBlockMeasurement[]>([])
  const contentHeightRef = useRef(0)
  const averageBlockHeightRef = useRef(0)

  // The tail probe: a hidden, bounded render of the document's last blocks,
  // just to learn how many characters its final screen holds. Nothing like the
  // survey this design replaced -- it measures the end of the document once,
  // not all of it, and its answer is used as an exact offset rather than as an
  // estimate of anything.
  const [tailProbeBlocks, setTailProbeBlocks] = useState(0)
  const tailProbeRef = useRef<HTMLDivElement | null>(null)
  const lastScreenCharsRef = useRef<number | null>(null)

  const pendingAnchorRef = useRef<PreviewWindowAnchor | null>(null)
  const pendingScrollRef = useRef<PendingWindowScroll | null>(null)
  /**
   * Whether a window change is committed but not yet measured.
   *
   * Adjustments must be serialized, and this is not a nicety. `adjust` runs on
   * every scroll event, which during a continuous scroll is every frame --
   * faster than React commits. A second adjustment computed before the first
   * has landed reads the OLD measurements while `rangeRef` already holds the
   * NEW range, so its anchor is captured against geometry that no longer
   * describes the window it is about to be applied to. Measured live: the
   * front edge moved 32 blocks while the compensation was computed for 6, the
   * reader was thrown 2,655px instead of 1,376px, the backward runway fell
   * under its own grow threshold, and the window spent the rest of the scroll
   * oscillating -- start index swinging 55 -> 87 -> 54 -> 93 -> 46 on
   * consecutive frames while the reader bounced with it.
   */
  const pendingCommitRef = useRef(false)
  /** True only inside settleWindow, where commits must be synchronous. */
  const settlingRef = useRef(false)
  /** See readContinuousScrollOffsetPx. */
  const originPxRef = useRef(0)
  const scheduledAdjustRef = useRef<number | null>(null)

  const readMeasurements = useCallback(() => measurementsRef.current, [])

  /**
   * Reads the window's geometry straight from the DOM.
   *
   * One forced layout for the whole window (~110 blocks), paid on a window
   * change or a resize -- not per frame.
   */
  const rebuildMeasurements = useCallback(() => {
    const container = containerRef.current
    if (!container) {
      measurementsRef.current = []
      contentHeightRef.current = 0
      return
    }
    // markdown.css gives every direct child of the scroller `position:
    // relative`, so this container is its children's offsetParent and their
    // offsetTop is measured from IT, not from the scroller -- short by the
    // scroller's own top padding. `scrollTop` is measured from the padding
    // edge, so without this every landing would sit one --preview-edge-padding
    // too far down the block it aimed at.
    const base = container.offsetParent !== null ? container.offsetTop : 0
    const nodes = container.querySelectorAll<HTMLElement>(':scope > [data-index]')
    const next: PreviewBlockMeasurement[] = []
    let total = 0
    nodes.forEach((node) => {
      const index = Number(node.getAttribute('data-index'))
      if (!Number.isFinite(index)) return
      const size = node.offsetHeight
      const start = (node.offsetParent === container ? base : 0) + node.offsetTop
      next.push({ index, start, size })
      total += size
    })
    measurementsRef.current = next
    // The scroller's own number, not the container's: it is what `scrollTop`
    // is bounded by, padding included, and the runway is a statement about
    // exactly that space.
    contentHeightRef.current = previewScrollRef.current?.scrollHeight ?? container.offsetHeight
    averageBlockHeightRef.current = next.length > 0 ? total / next.length : 0
  }, [previewScrollRef])

  /** The block at the top of the viewport, and where its own top sits. */
  const readAnchor = useCallback((): PreviewWindowAnchor | null => {
    const scroller = previewScrollRef.current
    const measurements = measurementsRef.current
    if (!scroller || measurements.length === 0) return null
    const position = findBlockAtPixel(measurements, scroller.scrollTop)
    if (position < 0) return null
    const measurement = measurements[position]
    return { blockIndex: measurement.index, startPx: measurement.start, scrollTopPx: scroller.scrollTop }
  }, [previewScrollRef])

  const readContinuousScrollOffsetPx = useCallback(() => (
    originPxRef.current + (previewScrollRef.current?.scrollTop ?? 0)
  ), [previewScrollRef])

  const isAtDocumentEdge = useCallback((direction: -1 | 1) => {
    const scroller = previewScrollRef.current
    if (!scroller) return true
    const blockCount = previewBlocksRef.current.length
    if (direction > 0) {
      const atWindowEnd = scroller.scrollTop >= scroller.scrollHeight - scroller.clientHeight - 1
      return atWindowEnd && rangeRef.current.endIndex >= blockCount - 1
    }
    return scroller.scrollTop <= 1 && rangeRef.current.startIndex <= 0
  }, [previewScrollRef])

  /**
   * Moves the window, carrying the reader with it.
   *
   * The anchor is captured HERE, against the geometry as it stands, because
   * this is the last moment it is still true. Applying it is the layout
   * effect's job, after React has committed the new blocks and the browser has
   * laid them out -- but before it paints, which is what makes the correction
   * invisible rather than a jump.
   */
  const moveWindow = useCallback((next: PreviewWindowRange, options?: { synchronous?: boolean }) => {
    if (pendingCommitRef.current) return
    const current = rangeRef.current
    if (next.startIndex === current.startIndex && next.endIndex === current.endIndex) return
    // Only a change at the FRONT edge moves the content under the reader.
    // Appending or dropping at the tail leaves every mounted block's offset
    // exactly where it was, so there is nothing to compensate.
    if (next.startIndex !== current.startIndex && pendingScrollRef.current === null) {
      pendingAnchorRef.current = readAnchor()
    }
    tracePreviewWindow(`move    ${current.startIndex}..${current.endIndex} -> ${next.startIndex}..${next.endIndex}`
      + ` top=${Math.round(previewScrollRef.current?.scrollTop ?? -1)}`
      + `${next.startIndex !== current.startIndex ? ' FRONT' : ''}${options?.synchronous ? ' sync' : ''}`)
    pendingCommitRef.current = true
    rangeRef.current = next
    if (options?.synchronous) {
      flushSync(() => setRange(next))
      return
    }
    setRange(next)
  }, [readAnchor, previewScrollRef])

  /**
   * Re-anchoring: mount a window around a block the reader is not near.
   *
   * SYNCHRONOUS when it moves the reader, and that is the whole difference
   * between this landing where it was asked to and landing somewhere near it.
   * Mounting a window is a React state update, and the scroll that follows it
   * can only be applied once the new blocks have been committed and measured --
   * a layout effect, one commit later. A caller that asks to be put at a
   * character and then reads back where it ended up gets the OLD position.
   *
   * That caller exists: the bridged journey's cut (NonQuantizedSmoothScroll's
   * onBridgeCut) re-anchors under the curtain and needs the new scroll offset
   * immediately, to aim its ramp-down. Measured before this flush, on a
   * 400,000-character note: a click near the top of the track moved the window
   * from blocks 1669..1794 to 347..489 while scrollTop sat unchanged at 1982,
   * so the reader arrived 45 blocks into the new window instead of at the
   * character they asked for -- and it took four clicks to walk to the top of
   * the document one journey at a time.
   *
   * `flushSync` is safe here because every caller is an event handler or an
   * animation frame, never a render. It is also the cheapest possible moment
   * for a synchronous commit: the pane is covered by the curtain.
   */
  const anchorWindowOn = useCallback((blockIndex: number, fraction: number, moveReader: boolean) => {
    const blockCount = previewBlocksRef.current.length
    if (blockCount === 0) return
    const next = planPreviewWindowAround(blockIndex, blockCount)
    if (moveReader) {
      pendingScrollRef.current = { blockIndex, fraction }
      // A landing overrides a carry: the reader is being moved on purpose.
      pendingAnchorRef.current = null
    }
    if (next.startIndex === rangeRef.current.startIndex && next.endIndex === rangeRef.current.endIndex) {
      // Already mounted -- nothing will re-render, so the pending scroll would
      // never be applied. Do it now instead.
      if (moveReader) applyPendingScroll()
      return
    }
    pendingCommitRef.current = true
    rangeRef.current = next
    if (moveReader) {
      flushSync(() => setRange(next))
      return
    }
    setRange(next)
  // applyPendingScroll is declared below and reached through the ref pattern
  // this file uses for the same reason the rest of the codebase does: a direct
  // reference here is a temporal dead zone error.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const applyPendingScroll = useCallback(() => {
    const pending = pendingScrollRef.current
    const scroller = previewScrollRef.current
    if (!pending || !scroller) return
    const measurement = measurementsRef.current.find((entry) => entry.index === pending.blockIndex)
    if (!measurement) return
    pendingScrollRef.current = null
    const target = measurement.start + (measurement.size * pending.fraction)
    tracePreviewWindow(`land    block=${pending.blockIndex} frac=${pending.fraction.toFixed(3)}`
      + ` top=${Math.round(scroller.scrollTop)} -> ${Math.round(target)}`)
    // A landing is a deliberate move to somewhere else in the document, so the
    // texture is entitled to jump with it -- what it must not do is drift on
    // an ordinary shift. Re-basing here keeps the offset finite over a long
    // session rather than accumulating every jump ever made.
    originPxRef.current = 0
    const previousBehavior = scroller.style.scrollBehavior
    scroller.style.scrollBehavior = 'auto'
    scroller.scrollTop = target
    scroller.style.scrollBehavior = previousBehavior
  }, [previewScrollRef])

  // Everything that must happen between React's commit and the browser's
  // paint: learn the new geometry, then either carry the reader across the
  // change or land them where they asked to be.
  useLayoutEffect(() => {
    if (!enabled) return
    rebuildMeasurements()
    pendingCommitRef.current = false
    // Now that the new geometry is known, ask again -- on a frame of its own,
    // not inside this commit. Two reasons it cannot be skipped: one pass may
    // not have grown far enough (the step size comes from a mean block
    // height, so it under-reaches on a run of tall blocks), and a STALLED
    // reader produces no further scroll events to trigger a pass with, so
    // without this the window would never grow back out from under them.
    scheduleAdjust()

    if (pendingScrollRef.current) {
      applyPendingScroll()
      pendingAnchorRef.current = null
      return
    }

    const anchor = pendingAnchorRef.current
    if (!anchor) return
    pendingAnchorRef.current = null
    const scroller = previewScrollRef.current
    if (!scroller) return
    const measurement = measurementsRef.current.find((entry) => entry.index === anchor.blockIndex)
    // The anchor block was itself trimmed away -- only possible if a window
    // moved further in one step than the reader's own block, which the
    // adjustment never asks for. Leaving scrollTop alone is the safe answer:
    // the reader is somewhere plausible rather than somewhere computed.
    if (!measurement) return

    // ABSOLUTE, not `scrollTop += delta`.
    //
    // The incremental form was correct exactly once. Applied a second time --
    // and it was, because the browser's own clamp on a shrinking scroller and
    // this correction are two separate writes to the same number -- it moved
    // the reader by the removed height twice. Measured live at 6x: a 33-block
    // trim that removed 1,422px threw the reader 2,741px, from block 124 back
    // to 93, and the window then spent the next frames growing back out to
    // where it had been. Restating the anchor's position outright cannot do
    // that: run it twice and the second run is a no-op.
    const target = measurement.start + (anchor.scrollTopPx - anchor.startPx)
    tracePreviewWindow(`carry   block=${anchor.blockIndex} was=${Math.round(anchor.startPx)}@${Math.round(anchor.scrollTopPx)}`
      + ` now=${Math.round(measurement.start)} top=${Math.round(scroller.scrollTop)} -> ${Math.round(target)}`)
    if (Math.abs(scroller.scrollTop - target) < 0.5) return
    // Whatever this correction takes out of scrollTop, the continuous offset
    // puts back -- the reader did not move, the window did.
    originPxRef.current += anchor.scrollTopPx - target
    const previousBehavior = scroller.style.scrollBehavior
    scroller.style.scrollBehavior = 'auto'
    scroller.scrollTop = target
    scroller.style.scrollBehavior = previousBehavior
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, range, rebuildMeasurements, applyPendingScroll, previewScrollRef])

  const readLastScreenChars = useCallback(() => lastScreenCharsRef.current, [])

  const restartTailProbe = useCallback(() => {
    lastScreenCharsRef.current = null
    setTailProbeBlocks(previewBlocksRef.current.length > 0
      ? Math.min(PREVIEW_TAIL_PROBE_INITIAL_BLOCKS, previewBlocksRef.current.length)
      : 0)
  }, [])

  // A new document is the obvious trigger.
  useEffect(() => {
    if (!enabled) return
    restartTailProbe()
  }, [enabled, previewBlocks, renderedDisplayText, activeNoteId, restartTailProbe])

  // A change of typography or pane width is the subtle one, and it was missed
  // on the first pass: the answer is a count of characters in one SCREEN, so it
  // is only true for the geometry it was taken at. Without this a font-size
  // change left the scrollbar's span describing the old one until the note was
  // reopened.
  useEffect(() => {
    if (!enabled) return undefined
    const probe = geometryProbeRef?.current
    if (!probe) return undefined
    let last = `${probe.offsetWidth}x${probe.offsetHeight}`
    const observer = new ResizeObserver(() => {
      const next = `${probe.offsetWidth}x${probe.offsetHeight}`
      if (next === last) return
      last = next
      restartTailProbe()
    })
    observer.observe(probe)
    return () => observer.disconnect()
  }, [enabled, geometryProbeRef, restartTailProbe, overlay])

  // Measure whatever the probe just rendered, and either widen the search or
  // finish. useLayoutEffect so the read happens in the same frame the blocks
  // were committed -- the host is hidden, so there is nothing to see, but
  // measuring after a paint would let a style change land in between.
  useLayoutEffect(() => {
    if (!enabled || tailProbeBlocks === 0) return
    const host = tailProbeRef.current
    const scroller = previewScrollRef.current
    const blockCount = previewBlocksRef.current.length
    if (!host || !scroller || blockCount === 0) return

    const nodes = host.querySelectorAll<HTMLElement>(':scope > [data-tail-index]')
    const measurements: PreviewBlockMeasurement[] = []
    let heightPx = 0
    nodes.forEach((node) => {
      const index = Number(node.getAttribute('data-tail-index'))
      if (!Number.isFinite(index)) return
      const size = node.offsetHeight
      measurements.push({ index, start: heightPx, size })
      heightPx += size
    })

    // Not enough tail to cover a screen yet, and more of the document to try.
    if (heightPx < scroller.clientHeight && tailProbeBlocks < blockCount) {
      setTailProbeBlocks(Math.min(blockCount, PREVIEW_TAIL_PROBE_MAX_BLOCKS, tailProbeBlocks * 2))
      return
    }

    lastScreenCharsRef.current = resolveLastScreenChars({
      offsets: blockCharOffsetsRef.current,
      measurements,
      blockCount,
      clientHeightPx: scroller.clientHeight,
    })
    // Unmount it. These are real rendered markdown blocks; left in the DOM they
    // would cost layout on every frame the reader scrolls, which is the exact
    // cost the design this replaced was built to avoid.
    setTailProbeBlocks(0)
  }, [enabled, tailProbeBlocks, previewScrollRef, blockCharOffsetsRef])

  /**
   * One adjustment pass. Cheap by construction: pure arithmetic over the
   * cached measurements, no DOM reads, safe to call on every scroll frame.
   */
  const adjust = useCallback(() => {
    if (!enabled) return
    const scroller = previewScrollRef.current
    if (!scroller) return

    // Never move the window while a travel animation owns the scroller.
    //
    // Such an animation recomputes `scrollTop` from its own plan on every
    // frame, so any correction made underneath it is overwritten before it can
    // be seen -- including the front-edge compensation that keeps the reader
    // still when the window grows. The two together do not merely cancel out,
    // they leave the reader somewhere neither intended: measured on a track
    // click aimed at character 301,375, the landing was exact and then the
    // ramp-down's own scroll writes let the window adjust and be stomped
    // repeatedly, ending at character 231,146 -- a sixth of the document short.
    //
    // Deferring costs nothing. A journey is a few hundred milliseconds inside a
    // runway measured in screenfuls, and the pass is re-queued for the frame
    // after it ends. The one caller that must not be deferred is the cut's own
    // settle, which runs DURING the animation on purpose and is exempt.
    if (!settlingRef.current && isNonQuantizedSmoothScrollActive(scroller)) {
      scheduleAdjustRef.current?.()
      return
    }
    tracePreviewWindow(`adjust  top=${Math.round(scroller.scrollTop)} h=${Math.round(contentHeightRef.current)} win=${rangeRef.current.startIndex}..${rangeRef.current.endIndex} avg=${Math.round(averageBlockHeightRef.current)}`)
    const blockCount = previewBlocksRef.current.length
    const next = resolvePreviewWindowAdjustment(rangeRef.current, blockCount, {
      scrollTopPx: scroller.scrollTop,
      clientHeightPx: scroller.clientHeight,
      contentHeightPx: contentHeightRef.current,
      averageBlockHeightPx: averageBlockHeightRef.current,
    })
    if (next) moveWindow(next, { synchronous: settlingRef.current })
  }, [enabled, previewScrollRef, moveWindow])

  const adjustRef = useRef(adjust)
  adjustRef.current = adjust
  // adjust() needs to re-queue itself while a journey owns the scroller, and
  // scheduleAdjust is declared below it -- a direct reference is a temporal
  // dead zone error, the same reason readLineMetricsRef exists next door.
  const scheduleAdjustRef = useRef<(() => void) | null>(null)

  /** At most one queued pass, on the next frame. */
  const scheduleAdjust = useCallback(() => {
    if (scheduledAdjustRef.current !== null) return
    scheduledAdjustRef.current = window.requestAnimationFrame(() => {
      scheduledAdjustRef.current = null
      adjustRef.current()
    })
  }, [])
  scheduleAdjustRef.current = scheduleAdjust

  useEffect(() => () => {
    if (scheduledAdjustRef.current !== null) window.cancelAnimationFrame(scheduledAdjustRef.current)
  }, [])

  // The window has to keep up with a reader who is moving, so this listens on
  // the scroller itself rather than waiting for React. `passive`, because it
  // never prevents the scroll -- it only decides what to mount next.
  useEffect(() => {
    if (!enabled) return undefined
    const scroller = previewScrollRef.current
    if (!scroller) return undefined
    const onScroll = () => adjust()
    scroller.addEventListener('scroll', onScroll, { passive: true })
    return () => scroller.removeEventListener('scroll', onScroll)
  }, [enabled, previewScrollRef, adjust, range])

  // Content that changes height after it mounts (a font finishing loading, an
  // image, a details element opening) invalidates every offset below it.
  useEffect(() => {
    if (!enabled) return undefined
    const container = containerRef.current
    if (!container) return undefined
    const observer = new ResizeObserver(() => {
      rebuildMeasurements()
      adjust()
    })
    observer.observe(container)
    return () => observer.disconnect()
  }, [enabled, rebuildMeasurements, adjust, range])

  // A new document -- or the same one re-rendered -- starts a new window. The
  // reader's position is restored by whoever owns it (the source-anchor
  // restore in useEditorSectionMount), so this only has to open somewhere
  // sane and let the adjustment pass size it from real geometry.
  useEffect(() => {
    if (!enabled) return
    const blockCount = previewBlocks.length
    const next = planPreviewWindowAround(0, blockCount)
    rangeRef.current = next
    pendingAnchorRef.current = null
    pendingScrollRef.current = null
    setRange(next)
  }, [enabled, activeNoteId, renderedDisplayText, previewBlocks])

  // ---------------------------------------------------------------------
  // Position, in the character space everything outside this module speaks.
  // ---------------------------------------------------------------------

  const readCharViewport = useCallback((): PreviewCharViewport | null => {
    const scroller = previewScrollRef.current
    if (!scroller) return null
    return resolvePreviewCharViewport({
      offsets: blockCharOffsetsRef.current,
      measurements: measurementsRef.current,
      scrollTop: scroller.scrollTop,
      clientHeight: scroller.clientHeight,
    })
  }, [previewScrollRef, blockCharOffsetsRef])

  const resolveCharTarget = useCallback((charOffset: number): { blockIndex: number; fraction: number } | null => {
    const offsets = blockCharOffsetsRef.current
    if (!offsets || offsets.length < 2) return null
    const blockIndex = findBlockAtChar(offsets, charOffset)
    const blockChars = offsets[blockIndex + 1] - offsets[blockIndex]
    const fraction = blockChars > 0
      ? Math.min(1, Math.max(0, (charOffset - offsets[blockIndex]) / blockChars))
      : 0
    return { blockIndex, fraction }
  }, [blockCharOffsetsRef])

  const resolveCharOffsetPx = useCallback((charOffset: number): number | null => {
    const target = resolveCharTarget(charOffset)
    if (!target) return null
    const measurement = measurementsRef.current.find((entry) => entry.index === target.blockIndex)
    if (!measurement) return null
    return measurement.start + (measurement.size * target.fraction)
  }, [resolveCharTarget])

  const scrollToChar = useCallback((charOffset: number) => {
    const target = resolveCharTarget(charOffset)
    if (!target) return
    const scroller = previewScrollRef.current
    if (!scroller) return

    // Already mounted: this is an ordinary scroll within the window, and the
    // pixel it lands on is a measured one.
    if (isWithinPreviewWindow(rangeRef.current, target.blockIndex)) {
      const px = resolveCharOffsetPx(charOffset)
      if (px !== null) {
        const previousBehavior = scroller.style.scrollBehavior
        scroller.style.scrollBehavior = 'auto'
        scroller.scrollTop = px
        scroller.style.scrollBehavior = previousBehavior
        adjust()
        return
      }
    }
    anchorWindowOn(target.blockIndex, target.fraction, true)
  }, [resolveCharTarget, resolveCharOffsetPx, previewScrollRef, adjust, anchorWindowOn])

  /**
   * Runs adjustment passes until the window stops changing.
   *
   * Bounded: each pass either grows or trims by a step, and the thresholds have
   * hysteresis, so a handful converges. The cap is there because a loop that
   * cannot converge must not become an infinite one -- if it is ever hit, the
   * window is merely not yet at its full runway, which the next scroll event
   * fixes.
   */
  const settleWindow = useCallback(() => {
    settlingRef.current = true
    try {
      settleWindowPasses()
    } finally {
      settlingRef.current = false
    }
  }, [])

  const settleWindowPasses = () => {
    for (let pass = 0; pass < 4; pass += 1) {
      const before = rangeRef.current
      adjustRef.current()
      const after = rangeRef.current
      if (after.startIndex === before.startIndex && after.endIndex === before.endIndex) return
    }
  }

  const landOnChar = useCallback((charOffset: number): number | null => {
    scrollToChar(charOffset)
    settleWindow()
    // Re-read the target's own offset rather than trusting the scrollTop the
    // landing wrote: the settle passes above may have compensated it, which is
    // exactly the movement this exists to get ahead of.
    return resolveCharOffsetPx(charOffset) ?? previewScrollRef.current?.scrollTop ?? null
  }, [scrollToChar, settleWindow, resolveCharOffsetPx, previewScrollRef])

  const api = useMemo<PreviewWindowApi>(() => ({
    readCharViewport,
    readMeasurements,
    scrollToChar,
    landOnChar,
    resolveCharOffsetPx,
    readLastScreenChars,
    readContinuousScrollOffsetPx,
    isAtDocumentEdge,
  }), [readCharViewport, readMeasurements, scrollToChar, landOnChar, resolveCharOffsetPx, readLastScreenChars, readContinuousScrollOffsetPx, isAtDocumentEdge])

  const element = useMemo(() => {
    if (!enabled) return null
    const blocks: ReactNode[] = []
    for (let index = range.startIndex; index <= range.endIndex; index += 1) {
      const block = previewBlocks[index]
      if (!block) continue
      blocks.push(
        <div
          key={index}
          data-index={index}
          // Marks the document's first block for the leading-margin reset in
          // markdown.css -- by class rather than by DOM position, because the
          // window's first child is whichever block is mounted, not block 0.
          className={index === 0 ? 'preview-first-block' : undefined}
          style={{ display: 'flow-root' }}
        >
          {renderBlock(block, index)}
        </div>,
      )
    }
    // The tail probe sits in its own hidden, zero-height host INSIDE the
    // window, so its blocks wrap at exactly the width the real ones do.
    const tail: ReactNode[] = []
    if (tailProbeBlocks > 0) {
      const from = Math.max(0, previewBlocks.length - tailProbeBlocks)
      for (let index = from; index < previewBlocks.length; index += 1) {
        const block = previewBlocks[index]
        if (!block) continue
        tail.push(
          <div key={`tail-${index}`} data-tail-index={index} style={{ display: 'flow-root' }}>
            {renderBlock(block, index)}
          </div>,
        )
      }
    }

    return (
      <div ref={containerRef} className="preview-window">
        {overlay}
        {tail.length > 0 ? (
          <div
            ref={tailProbeRef}
            aria-hidden="true"
            style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: 0, overflow: 'hidden', visibility: 'hidden', pointerEvents: 'none', zIndex: -1 }}
          >
            {tail}
          </div>
        ) : null}
        {blocks}
      </div>
    )
  }, [enabled, range, previewBlocks, renderBlock, overlay, tailProbeBlocks])

  return { element, api }
}
