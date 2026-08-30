// Does a long journey cut its middle out without the reader seeing the cut?
//
// A journey across a large document ramps up to peak speed, jumps while a
// curtain of spoof text covers the pane, and ramps down onto the target (see
// src/editor/scrollJourney.ts and src/editor/scrollBridge.ts). The thing that
// makes it honest rather than a trick is that the jump happens ONLY while the
// viewport is covered -- so this samples every frame and checks exactly that,
// rather than checking that a curtain appeared at some point and hoping.
//
// Both panes get the same suite, because both run the same design from the
// same modules: the render view (NonQuantizedSmoothScroll) and the edit view
// (QuantizedSmoothScroll, which additionally may never leave the row grid --
// checked here for every frame of a journey, curtain included).
//
// Usage: node scripts/perf/verifyScrollBridge.mjs
//        node scripts/perf/verifyScrollBridge.mjs edit

import { chromium } from 'playwright'
import {
  startDevServer, waitForAppReady, ensureEditMode, ensurePreviewMode, generateSyntheticDocument,
} from './perfHarness.mjs'

const PORT = 5213
const EXECUTABLE_PATH = process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined

const failures = []
let paneLabel = ''
const check = (label, ok, detail = '') => {
  const full = `${paneLabel}: ${label}`
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${full}${detail ? ` -- ${detail}` : ''}`)
  if (!ok) failures.push(full)
}

const PANES = {
  preview: {
    label: 'render view',
    scroller: '.markdown-preview',
    host: '.render-container',
    // The render view's blocks are of every height; there is no grid to hold.
    rowGrid: false,
    enter: ensurePreviewMode,
  },
  edit: {
    label: 'edit view',
    scroller: '.cm-scroller',
    // The non-scrolling frame the caret is positioned against, which is also
    // the bridge's host -- it has no class of its own, so it is reached
    // through the one child that does.
    host: '.cm6-editor-root',
    hostIsParent: true,
    rowGrid: true,
    enter: ensureEditMode,
  },
}

/**
 * Records, every frame for `ms`, where the scroller is and whether the curtain
 * is covering the pane.
 */
const WATCH = (pane, ms) => `(async () => {
  const scroller = document.querySelector(${JSON.stringify(pane.scroller)})
  const hostAnchor = document.querySelector(${JSON.stringify(pane.host)})
  const host = ${pane.hostIsParent ? 'hostAnchor.parentElement' : 'hostAnchor'}
  const thumb = document.querySelector('.thockdown-scroll-thumb')
  const frames = []
  const t0 = performance.now()
  while (performance.now() - t0 < ${ms}) {
    await new Promise((r) => requestAnimationFrame(r))
    const band = document.querySelector('.scroll-bridge-band')
    let covering = false
    let overlapping = false
    let bandTop = null
    if (band) {
      const top = parseFloat(band.style.top)
      bandTop = top
      const height = parseFloat(band.style.height)
      covering = top <= 0 && (top + height) >= host.clientHeight
      // Distinct from covering: during the ramp-up the band exists but is
      // parked just outside the pane, hiding nothing and needing no clip.
      overlapping = top < host.clientHeight && (top + height) > 0
    }
    frames.push({
      scrollTop: scroller.scrollTop,
      hasBand: !!band,
      bandTop,
      covering,
      overlapping,
      bandBackground: band ? getComputedStyle(band).backgroundColor : null,
      textClip: scroller.style.clipPath || '',
      lineBoxTop: (() => {
        const line = document.querySelector('.cm-line')
        if (!line || !hostAnchor) return null
        return line.getBoundingClientRect().top - host.getBoundingClientRect().top
      })(),
      thumbTop: Math.round(parseFloat(thumb.style.top) || 0),
      thumbHeight: Math.round(parseFloat(thumb.style.height) || 0),
    })
  }
  return frames
})()`

async function seed(page, pane, text) {
  await page.evaluate(async (initialText) => {
    const note = await window.thockdownNotes.createNote({ initialText })
    await window.thockdownSections.setActiveNote('default', note.id)
  }, text)
  await page.reload()
  await pane.enter(page)
  await page.waitForTimeout(6000)
}

/** Back to the top, without the pane animating its way there. */
async function goToTop(page, pane) {
  await page.evaluate(async (selector) => {
    const scroller = document.querySelector(selector)
    const previous = scroller.style.scrollBehavior
    scroller.style.scrollBehavior = 'auto'
    scroller.scrollTop = 0
    await new Promise((r) => setTimeout(r, 400))
    scroller.style.scrollBehavior = previous
  }, pane.scroller)
  await page.waitForTimeout(500)
}

async function clickTrackAt(page, ratio) {
  const box = await page.locator('.thockdown-scroll-track').boundingBox()
  await page.mouse.click(box.x + box.width / 2, box.y + box.height * ratio, { delay: 0 })
}

/** The largest single-frame move, and whether the pane was covered for it. */
function biggestJump(frames) {
  let worst = { deltaPx: 0, covering: true, index: -1 }
  for (let i = 1; i < frames.length; i += 1) {
    const deltaPx = Math.abs(frames[i].scrollTop - frames[i - 1].scrollTop)
    if (deltaPx > worst.deltaPx) {
      worst = { deltaPx, covering: frames[i].covering || frames[i - 1].covering, index: i }
    }
  }
  return worst
}

async function runPane(page, pane) {
  paneLabel = pane.label
  await seed(page, pane, generateSyntheticDocument(400000))

  // -- a long journey ---------------------------------------------------
  const watching = page.evaluate(WATCH(pane, 2500))
  await page.waitForTimeout(60)
  await clickTrackAt(page, 0.85)
  const frames = await watching

  const bridged = frames.filter((frame) => frame.hasBand).length
  check('a long journey raises a curtain', bridged > 0, `${bridged} of ${frames.length} frames`)

  const covered = frames.filter((frame) => frame.covering).length
  check('the curtain fully covers the pane for part of the journey', covered > 0,
    `${covered} frames fully covered`)

  // The whole point. The cut is a single enormous move, and it must land
  // inside the covered window -- otherwise the reader watched it happen.
  const jump = biggestJump(frames)
  check('the cut happens only while the pane is covered', jump.covering,
    `biggest single-frame move was ${Math.round(jump.deltaPx)}px`)

  const settled = frames[frames.length - 1].scrollTop
  const geometry = await page.evaluate((selector) => {
    const scroller = document.querySelector(selector)
    return { maxScrollTop: scroller.scrollHeight - scroller.clientHeight }
  }, pane.scroller)
  check('the journey ends somewhere near the bottom, where it was aimed',
    settled > geometry.maxScrollTop * 0.5,
    `landed at ${Math.round((settled / geometry.maxScrollTop) * 100)}% of the document`)

  check('no curtain is left behind',
    await page.evaluate(() => document.querySelectorAll('.scroll-bridge').length) === 0)

  // -- the row grid survives the journey --------------------------------
  //
  // Edit view only, and the one invariant a bridge could plausibly break: a
  // journey writes scrollTop from three separate places (ramp up, sweep, ramp
  // down), and text sitting half a row off its box would be visible the
  // instant the curtain lifted.
  if (pane.rowGrid) {
    const lineHeightPx = await page.evaluate(() => {
      const content = document.querySelector('.cm-content')
      return parseFloat(getComputedStyle(content).lineHeight)
    })
    const offGrid = frames
      .map((frame) => Math.abs(frame.scrollTop - (Math.round(frame.scrollTop / lineHeightPx) * lineHeightPx)))
      .filter((offsetPx) => offsetPx > 0.5)
    check('every frame of the journey lands on the row grid', offGrid.length === 0,
      `${offGrid.length} of ${frames.length} off grid (line height ${lineHeightPx}px, worst ${
        offGrid.length ? Math.max(...offGrid).toFixed(2) : 0}px)`)

    // The curtain has its own position, and drawing its glyphs on a grid does
    // nothing if the band they are painted on slides continuously underneath
    // them. Before this was fixed the document's phase was 0 on all 34 frames
    // while the curtain's ran through 1, 5, 7, 9, 15, 19, 21, 23 and 25 -- so
    // the spoof matched the real rows only on the frames where it happened to.
    const phaseOf = (px) => Math.round(((((px % lineHeightPx) + lineHeightPx) % lineHeightPx)) * 100) / 100
    // Against the real LINE BOX, not against scrollTop -- scrollTop's phase is
    // always zero by construction, so comparing to it proves nothing. The
    // editor folds a half-cell shift into the content's padding, and reading
    // the wrong box put the curtain exactly half a row high.
    const rowPhases = [...new Set(frames
      .filter((frame) => frame.lineBoxTop !== null)
      .map((frame) => phaseOf(frame.lineBoxTop)))]
    const bandPhases = [...new Set(frames
      .filter((frame) => frame.bandTop !== null)
      .map((frame) => phaseOf(frame.bandTop)))]
    check('the curtain itself sits on the same rows the document does',
      bandPhases.length === 1 && rowPhases.length === 1
        && Math.abs(bandPhases[0] - rowPhases[0]) < 0.5,
      `curtain at ${bandPhases.join('/')}, document rows at ${rowPhases.join('/')}`)
  }

  // -- the bridge borrows the pane's background rather than painting one --
  //
  // It paints NO background, and hides the real text underneath itself
  // instead. That is the only way to be certain the paper matches: nothing
  // is reproduced, so nothing can fail to match. Reconstructing it was tried
  // and showed a visibly different paper in the real app -- the backdrop is
  // a gradient and a tint on ancestors rather than a flat colour anywhere,
  // so reading a background-color up the tree just returns white.
  const bridgeFrames = frames.filter((frame) => frame.hasBand)
  const backgrounds = [...new Set(bridgeFrames.map((frame) => frame.bandBackground))]
  check('the bridge paints no background of its own',
    backgrounds.every((color) => color === 'rgba(0, 0, 0, 0)' || color === 'transparent'),
    backgrounds.join(', '))
  // Only where the band actually overlaps the pane. During the ramp-up it
  // exists but sits just outside, hiding nothing and needing no clip.
  const overlapFrames = frames.filter((frame) => frame.overlapping)
  const unclipped = overlapFrames.filter((frame) => frame.textClip === '').length
  check('the real text is clipped away wherever the bridge covers it',
    overlapFrames.length > 0 && unclipped === 0,
    `${unclipped} of ${overlapFrames.length} overlapping frames left the text unclipped`)
  check('the clip is released when the journey ends',
    frames[frames.length - 1].textClip === '',
    `ended as ${frames[frames.length - 1].textClip || '(none)'}`)

  // -- the thumb stretches rather than slides ----------------------------
  //
  // The document's middle is being cut out, so a thumb that slid smoothly
  // would be describing a journey that did not happen. It stretches instead:
  // the leading edge runs the span, both edges hold while the bridge covers
  // the cut, then the trailing edge catches up.
  const heights = frames.map((frame) => frame.thumbHeight)
  const restingHeight = heights[0]
  const peakHeight = Math.max(...heights)
  check('the thumb stretches across the journey', peakHeight > restingHeight * 3,
    `${restingHeight}px at rest, ${peakHeight}px stretched`)
  // Exact equality, deliberately. This used to allow a few pixels of slack on
  // the reasoning that CM6's wrapped-line count firms up as more of the
  // document is measured (28px -> 32px, measured). Two things were wrong with
  // that. The size is not allowed to depend on how much of the document has
  // been looked at -- it is committed against the document and the type
  // geometry and held (src/editor/scrollThumbMetrics.ts). And the drift was
  // not the line count at all: the rubber band writes the thumb's style
  // directly, so its last frame stayed on screen whenever the ordinary sync's
  // React state came back unchanged and skipped its re-render. The slack in
  // this check is what let that sit here unnoticed.
  const endHeight = heights[heights.length - 1]
  check('the thumb returns to exactly its resting height, not merely near it',
    endHeight === restingHeight,
    `${restingHeight}px before, ${peakHeight}px stretched, ${endHeight}px after`)

  const peakAt = heights.indexOf(peakHeight)
  const held = frames.filter((frame, i) =>
    i > 0 && frame.thumbHeight === peakHeight && frames[i - 1].thumbHeight === peakHeight).length
  check('the thumb holds still, stretched, while the bridge covers the cut', held >= 1,
    `${held} frames at full stretch`)

  // The subtle half of the design: each edge follows the POSITION curve of
  // its own ramp, so the leading edge eases IN (covering more ground in the
  // second half of its run than the first) and the trailing edge eases OUT.
  const growth = heights.slice(0, peakAt + 1)
  const midGrowth = growth[Math.floor(growth.length / 2)]
  check('the leading edge eases in',
    (peakHeight - midGrowth) > (midGrowth - restingHeight),
    `first half ${midGrowth - restingHeight}px, second half ${peakHeight - midGrowth}px`)

  const contraction = heights.slice(peakAt).filter((h, i, all) => i === 0 || h !== all[i - 1])
  const midContraction = contraction[Math.floor(contraction.length / 2)]
  check('the trailing edge eases out',
    (peakHeight - midContraction) > (midContraction - restingHeight),
    `first half ${peakHeight - midContraction}px, second half ${midContraction - restingHeight}px`)

  // -- a short journey needs no curtain ----------------------------------
  //
  // scroll-behavior on the preview is smooth, so a bare scrollTop write
  // animates -- it has to be forced to auto or the next click sets off
  // from somewhere other than where this asked for, which is exactly how
  // this check first "failed".
  await goToTop(page, pane)
  const shortWatch = page.evaluate(WATCH(pane, 1500))
  await page.waitForTimeout(60)
  const box = await page.locator('.thockdown-scroll-track').boundingBox()
  await page.mouse.click(box.x + box.width / 2, box.y + (box.height * 0.05), { delay: 0 })
  const shortFrames = await shortWatch
  const shortDistance = Math.abs(shortFrames[shortFrames.length - 1].scrollTop - shortFrames[0].scrollTop)
  // Asserted rather than assumed: a "short" journey that turned out to be
  // long would otherwise pass this by being bridged for a good reason.
  check('the short-journey case really is short', shortDistance < 11000,
    `travelled ${Math.round(shortDistance)}px`)
  check('a short journey does not raise one',
    shortFrames.every((frame) => !frame.hasBand),
    `${shortFrames.filter((f) => f.hasBand).length} frames had a curtain`)
  const shortHeights = shortFrames.map((frame) => frame.thumbHeight)
  check('a short journey does not stretch the thumb either',
    Math.max(...shortHeights) - Math.min(...shortHeights) <= 2,
    `thumb varied by ${Math.max(...shortHeights) - Math.min(...shortHeights)}px`)

  // -- an interrupted journey must not leave its curtain up --------------
  await goToTop(page, pane)
  await clickTrackAt(page, 0.9)
  await page.waitForTimeout(120)
  await page.evaluate((selector) => {
    // Whatever the reader does next cancels the journey; a wheel is the
    // most ordinary version of it.
    document.querySelector(selector).dispatchEvent(
      new WheelEvent('wheel', { deltaY: 200, bubbles: true, cancelable: true }),
    )
  }, pane.scroller)
  await page.mouse.click(box.x + box.width / 2, box.y + 24, { delay: 0 })
  await page.waitForTimeout(2500)
  check('an interrupted journey takes its curtain with it',
    await page.evaluate(() => document.querySelectorAll('.scroll-bridge').length) === 0)
  check('an interrupted journey lets the thumb go too',
    await page.evaluate(() => {
      const thumb = document.querySelector('.thockdown-scroll-thumb')
      const track = document.querySelector('.thockdown-scroll-track')
      return parseFloat(thumb.style.height) < track.clientHeight * 0.9
    }),
    'thumb left stretched across the track')

  // -- snapping out of a journey ----------------------------------------
  //
  // A held click snaps to the target, and it is the ONLY input honored while
  // a journey is in flight -- an ordinary click is ignored, because a second
  // journey would take the stretched thumb for its own base size and set off
  // from that, which is how a thumb ends up longer than its own rail.
  // Snapping has to end the journey outright and hand the thumb back at its
  // resting size, which it did not: it left the band running, so the thumb
  // stayed extended and kept stretching toward a target nobody was going to.
  await goToTop(page, pane)
  const restingBeforeSnap = await page.evaluate(() => Math.round(
    parseFloat(document.querySelector('.thockdown-scroll-thumb').style.height) || 0))
  await clickTrackAt(page, 0.9)
  await page.waitForTimeout(140)
  // Held, not clicked -- scrollTrackHold resolves a hold to a snap.
  await page.mouse.move(box.x + box.width / 2, box.y + (box.height * 0.35))
  await page.mouse.down()
  await page.waitForTimeout(400)
  await page.mouse.up()
  await page.waitForTimeout(2500)

  const afterSnap = await page.evaluate(() => {
    const thumb = document.querySelector('.thockdown-scroll-thumb')
    const track = document.querySelector('.thockdown-scroll-track')
    return {
      heightPx: Math.round(parseFloat(thumb.style.height) || 0),
      topPx: Math.round(parseFloat(thumb.style.top) || 0),
      trackHeightPx: track.clientHeight,
      bands: document.querySelectorAll('.scroll-bridge').length,
    }
  })
  check('a snap out of a journey puts the thumb back at its resting size',
    afterSnap.heightPx === restingBeforeSnap,
    `${restingBeforeSnap}px before, ${afterSnap.heightPx}px after`)
  check('a snap out of a journey leaves the thumb inside its rail',
    afterSnap.topPx + afterSnap.heightPx <= afterSnap.trackHeightPx,
    `thumb ends at ${afterSnap.topPx + afterSnap.heightPx}px of a ${afterSnap.trackHeightPx}px track`)
  check('a snap out of a journey takes the curtain with it', afterSnap.bands === 0)
}

async function main() {
  const requested = process.argv[2]
  const panes = requested ? [PANES[requested]] : [PANES.preview, PANES.edit]
  if (panes.some((pane) => !pane)) {
    console.error(`unknown pane "${requested}" -- expected preview or edit`)
    process.exit(1)
  }

  const server = await startDevServer(PORT)
  const browser = await chromium.launch({ executablePath: EXECUTABLE_PATH })
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  const errors = []
  page.on('pageerror', (err) => errors.push(String(err).slice(0, 200)))
  page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text().slice(0, 200)) })

  try {
    await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load' })
    await waitForAppReady(page)
    for (const pane of panes) {
      await runPane(page, pane)
    }
    paneLabel = 'both'
    check('no page errors', errors.length === 0, errors.slice(0, 2).join(' | '))
  } finally {
    await browser.close()
    server.stop()
  }

  if (failures.length > 0) {
    console.log(`\n${failures.length} check(s) failed`)
    process.exit(1)
  }
  console.log('\nall checks passed')
}

main().catch((err) => { console.error(err); process.exit(1) })
