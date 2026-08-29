// The two answers to "where am I", and the promises each one makes.
//
// A document below the size threshold is measured outright, so the scrollbar
// can use the plain pixel identity and be EXACT. Above it, blocks are modelled
// rather than surveyed, and position becomes a character offset -- which
// cannot be exact against pixels, but must be STABLE while the app is still
// working out what the document looks like. That is the whole reason for it.
//
// So the two halves assert deliberately different things. Asserting exactness
// on the chunked path would be asserting the thing that was given up on
// purpose; asserting mere stability on the continuous path would be settling
// for less than it can deliver.
//
// Note what stability does NOT claim. A character offset is immune to the app
// LEARNING something -- a height estimate replaced by a measurement -- and
// that is what is checked here. It is not immune to the reader changing the
// typography: a bigger font means one screen holds less of the document, so
// the same character genuinely sits at a different fraction of what can be
// reached, and the thumb moving then is right rather than wrong.
//
// See src/editor/documentPosition.ts.
//
// Usage: node scripts/perf/verifyScrollbarSemantics.mjs

import { chromium } from 'playwright'
import { startDevServer, waitForAppReady, ensurePreviewMode } from './perfHarness.mjs'

const PORT = 5203

/**
 * The track keeps a small gap at each end (usePreviewScrollbar), so the thumb
 * at its furthest is flush with the USABLE track, not with the element.
 */
const TRACK_EDGE_GAP_PX = 3
const EXECUTABLE_PATH = process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined

const failures = []
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` -- ${detail}` : ''}`)
  if (!ok) failures.push(label)
}

/** Roughly `targetChars` of prose in ordinary paragraphs and headings. */
function buildDocument(targetChars) {
  const parts = ['# The Opening Title']
  let total = parts[0].length
  let i = 0
  while (total < targetChars) {
    i += 1
    if (i % 12 === 0) parts.push(`## Section ${i}`)
    const line = `Paragraph ${i} - lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua, which is long enough to wrap.`
    parts.push(line)
    total += line.length + 2
  }
  return parts.join('\n\n')
}

const readScrollbar = () => {
  const scroller = document.querySelector('.markdown-preview')
  const track = document.querySelector('.thockdown-scroll-track')
  const thumb = document.querySelector('.thockdown-scroll-thumb')
  if (!scroller || !track || !thumb) return null
  const trackRect = track.getBoundingClientRect()
  const thumbRect = thumb.getBoundingClientRect()
  return {
    scrollTop: scroller.scrollTop,
    clientHeight: scroller.clientHeight,
    scrollHeight: scroller.scrollHeight,
    maxScrollTop: Math.max(0, scroller.scrollHeight - scroller.clientHeight),
    trackTop: trackRect.top,
    trackHeight: trackRect.height,
    thumbTop: thumbRect.top,
    thumbHeight: thumbRect.height,
  }
}

async function seed(page, text) {
  await page.evaluate(async (initialText) => {
    const note = await window.thockdownNotes.createNote({ initialText })
    await window.thockdownSections.setActiveNote('default', note.id)
  }, text)
  await page.reload()
  await ensurePreviewMode(page)
  // Long enough for the sweep to finish on either path.
  await page.waitForTimeout(5000)
}

/** Clicks the track at `ratio` of its height and waits for the travel to land. */
async function clickTrackAt(page, ratio) {
  const track = page.locator('.thockdown-scroll-track')
  const box = await track.boundingBox()
  await page.mouse.click(box.x + box.width / 2, box.y + box.height * ratio)
  await page.waitForTimeout(2500)
}

async function main() {
  const server = await startDevServer(PORT)
  const browser = await chromium.launch({ executablePath: EXECUTABLE_PATH })
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  const errors = []
  page.on('pageerror', (err) => errors.push(String(err).slice(0, 200)))
  page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text().slice(0, 200)) })

  try {
    await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load' })
    await waitForAppReady(page)

    // ── below the threshold: pixels are truth, so be exact ───────────────
    const smallDoc = buildDocument(20000)
    await seed(page, smallDoc)
    console.log(`\nsmall document: ${smallDoc.length} chars`)

    const atTop = await page.evaluate(readScrollbar)
    // The thumb's size is the plain identity, to within the rounding the
    // scrollbar does when it writes a whole pixel.
    const expectedThumbHeight = atTop.trackHeight * (atTop.clientHeight / atTop.scrollHeight)
    check(
      'small document: the thumb is sized by the real pixel ratio',
      Math.abs(atTop.thumbHeight - expectedThumbHeight) <= 3,
      `thumb ${atTop.thumbHeight.toFixed(1)}px, identity says ${expectedThumbHeight.toFixed(1)}px`,
    )

    await clickTrackAt(page, 0.5)
    const atHalf = await page.evaluate(readScrollbar)
    const landedRatio = atHalf.maxScrollTop > 0 ? atHalf.scrollTop / atHalf.maxScrollTop : 0
    check(
      'small document: a click halfway down lands halfway through',
      Math.abs(landedRatio - 0.5) <= 0.03,
      `landed at ${(landedRatio * 100).toFixed(1)}%`,
    )

    await clickTrackAt(page, 0.999)
    const atEnd = await page.evaluate(readScrollbar)
    check(
      'small document: a click at the bottom reaches the end of the document',
      atEnd.maxScrollTop - atEnd.scrollTop <= 2,
      `${(atEnd.maxScrollTop - atEnd.scrollTop).toFixed(1)}px short`,
    )
    const endGap = (atEnd.trackTop + atEnd.trackHeight - TRACK_EDGE_GAP_PX)
      - (atEnd.thumbTop + atEnd.thumbHeight)
    check(
      'small document: the thumb sits flush with the bottom of the track',
      Math.abs(endGap) <= 2,
      `${endGap.toFixed(1)}px past the track's own edge gap`,
    )

    // ── above the threshold: characters are truth, so be stable ──────────
    const bigDoc = buildDocument(400000)
    console.log(`\nchunked document: ${bigDoc.length} chars`)
    await page.evaluate(async (initialText) => {
      const note = await window.thockdownNotes.createNote({ initialText })
      await window.thockdownSections.setActiveNote('default', note.id)
    }, bigDoc)
    await page.reload()
    await ensurePreviewMode(page)

    // Deliberately early: the sweep is still running, so the block heights a
    // pixel-based thumb would be derived from are still estimates. The whole
    // claim of a character-based position is that it does not care.
    await page.waitForTimeout(400)
    const whileLearning = await page.evaluate(readScrollbar)
    await page.waitForTimeout(6000)
    const afterLearning = await page.evaluate(readScrollbar)
    const learningDrift = (afterLearning.thumbTop - afterLearning.trackTop)
      - (whileLearning.thumbTop - whileLearning.trackTop)
    check(
      'chunked document: the thumb does not move as block heights are learned',
      Math.abs(learningDrift) <= 2,
      `moved ${learningDrift.toFixed(1)}px between the sweep starting and finishing`,
    )

    await clickTrackAt(page, 0.6)
    const before = await page.evaluate(readScrollbar)
    const thumbCentreBefore = before.thumbTop + (before.thumbHeight / 2) - before.trackTop
    check(
      'chunked document: the thumb lands centred on the click',
      Math.abs(thumbCentreBefore - (before.trackHeight * 0.6)) <= 6,
      `centre at ${thumbCentreBefore.toFixed(1)}px, clicked ${(before.trackHeight * 0.6).toFixed(1)}px`,
    )


    // The span a position moves through is the document minus the screenful
    // that is always visible, expressed with the same ratio that sizes the
    // thumb -- which is what makes the thumb reach the end of its track
    // exactly when the reader reaches the end of the document.
    await page.evaluate(async () => {
      const scroller = document.querySelector('.markdown-preview')
      scroller.style.scrollBehavior = 'auto'
      scroller.scrollTop = scroller.scrollHeight
      await new Promise((r) => setTimeout(r, 1500))
    })
    await page.waitForTimeout(2000)
    const bottom = await page.evaluate(readScrollbar)
    const bottomGap = (bottom.trackTop + bottom.trackHeight - TRACK_EDGE_GAP_PX)
      - (bottom.thumbTop + bottom.thumbHeight)
    check(
      'chunked document: the thumb reaches the end of the track at the end of the document',
      Math.abs(bottomGap) <= 3,
      `${bottomGap.toFixed(1)}px past the track's own edge gap`,
    )

    // ── a chunked document whose density swings wildly ───────────────────
    //
    // The span a position is measured against has to be a constant of the
    // document. Deriving it from the characters actually on screen makes the
    // denominator move with local text density, so the same position reports
    // differently depending on what happens to be visible -- and the thumb can
    // then run BACKWARDS while the reader scrolls forwards. Uniform prose
    // hides that completely, which is why this document alternates dense
    // paragraphs with runs of near-empty lines.
    // The runs are deliberately far longer than one screen. Density that
    // alternates within a viewport averages out and hides the problem; density
    // that changes over many screens is what actually moves a live count of
    // visible characters, and therefore what would move a denominator derived
    // from one.
    const lumpy = []
    for (let band = 0; band < 8; band += 1) {
      if (band % 2 === 0) {
        for (let j = 0; j < 600; j += 1) lumpy.push(`- ${j}`, '')
      } else {
        for (let j = 0; j < 120; j += 1) {
          lumpy.push(`Paragraph ${j} ${'lorem ipsum dolor sit amet consectetur adipiscing elit '.repeat(14)}`, '')
        }
      }
    }
    const lumpyDoc = lumpy.join('\n')
    console.log(`\nmixed-density document: ${lumpyDoc.length} chars`)
    await seed(page, lumpyDoc)

    const walk = await page.evaluate(async () => {
      const scroller = document.querySelector('.markdown-preview')
      const track = document.querySelector('.thockdown-scroll-track')
      const thumb = document.querySelector('.thockdown-scroll-thumb')
      scroller.style.scrollBehavior = 'auto'
      const tops = []
      const max = scroller.scrollHeight - scroller.clientHeight
      for (let i = 0; i <= 60; i += 1) {
        scroller.scrollTop = (max * i) / 60
        await new Promise((r) => setTimeout(r, 60))
        tops.push(thumb.getBoundingClientRect().top - track.getBoundingClientRect().top)
      }
      let worstBackwards = 0
      for (let i = 1; i < tops.length; i += 1) {
        worstBackwards = Math.min(worstBackwards, tops[i] - tops[i - 1])
      }
      return { worstBackwards, first: tops[0], last: tops[tops.length - 1] }
    })
    check(
      'mixed density: the thumb never runs backwards while scrolling forwards',
      walk.worstBackwards >= -1,
      `worst backwards step ${walk.worstBackwards.toFixed(1)}px, travelled ${walk.first.toFixed(0)} -> ${walk.last.toFixed(0)}`,
    )

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
