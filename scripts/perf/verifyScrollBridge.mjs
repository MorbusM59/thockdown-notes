// Does a long journey cut its middle out without the reader seeing the cut?
//
// A journey across a large document ramps up to peak speed, jumps while a
// curtain of spoof text covers the pane, and ramps down onto the target (see
// src/editor/scrollJourney.ts and src/editor/scrollBridge.ts). The thing that
// makes it honest rather than a trick is that the jump happens ONLY while the
// viewport is covered -- so this samples every frame and checks exactly that,
// rather than checking that a curtain appeared at some point and hoping.
//
// Usage: node scripts/perf/verifyScrollBridge.mjs

import { chromium } from 'playwright'
import { startDevServer, waitForAppReady, ensurePreviewMode, generateSyntheticDocument } from './perfHarness.mjs'

const PORT = 5213
const EXECUTABLE_PATH = process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined

const failures = []
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` -- ${detail}` : ''}`)
  if (!ok) failures.push(label)
}

/**
 * Records, every frame for `ms`, where the scroller is and whether the curtain
 * is covering the pane.
 */
const WATCH = (ms) => `(async () => {
  const scroller = document.querySelector('.markdown-preview')
  const host = document.querySelector('.render-container')
  const frames = []
  const t0 = performance.now()
  while (performance.now() - t0 < ${ms}) {
    await new Promise((r) => requestAnimationFrame(r))
    const band = document.querySelector('.scroll-bridge-band')
    let covering = false
    if (band) {
      const top = parseFloat(band.style.top)
      const height = parseFloat(band.style.height)
      covering = top <= 0 && (top + height) >= host.clientHeight
    }
    frames.push({ scrollTop: scroller.scrollTop, hasBand: !!band, covering })
  }
  return frames
})()`

async function seed(page, text) {
  await page.evaluate(async (initialText) => {
    const note = await window.thockdownNotes.createNote({ initialText })
    await window.thockdownSections.setActiveNote('default', note.id)
  }, text)
  await page.reload()
  await ensurePreviewMode(page)
  await page.waitForTimeout(6000)
}

/** Back to the top, without the pane animating its way there. */
async function goToTop(page) {
  await page.evaluate(async () => {
    const scroller = document.querySelector('.markdown-preview')
    const previous = scroller.style.scrollBehavior
    scroller.style.scrollBehavior = 'auto'
    scroller.scrollTop = 0
    await new Promise((r) => setTimeout(r, 400))
    scroller.style.scrollBehavior = previous
  })
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
    await seed(page, generateSyntheticDocument(400000))

    // ── a long journey ────────────────────────────────────────────────────
    const watching = page.evaluate(WATCH(2500))
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
    const geometry = await page.evaluate(() => {
      const scroller = document.querySelector('.markdown-preview')
      return { maxScrollTop: scroller.scrollHeight - scroller.clientHeight }
    })
    check('the journey ends somewhere near the bottom, where it was aimed',
      settled > geometry.maxScrollTop * 0.5,
      `landed at ${Math.round((settled / geometry.maxScrollTop) * 100)}% of the document`)

    check('no curtain is left behind', await page.evaluate(() => document.querySelectorAll('.scroll-bridge').length) === 0)

    // ── a short journey needs no curtain ──────────────────────────────────
    //
    // scroll-behavior on the preview is `smooth`, so a bare scrollTop write
    // animates -- it has to be forced to `auto` or the next click sets off
    // from somewhere other than where this asked for, which is exactly how
    // this check first "failed".
    await goToTop(page)
    const shortWatch = page.evaluate(WATCH(1500))
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

    // ── an interrupted journey must not leave its curtain up ──────────────
    await goToTop(page)
    await clickTrackAt(page, 0.9)
    await page.waitForTimeout(120)
    await page.evaluate(() => {
      // Whatever the reader does next cancels the journey; a wheel is the
      // most ordinary version of it.
      document.querySelector('.markdown-preview').dispatchEvent(
        new WheelEvent('wheel', { deltaY: 200, bubbles: true, cancelable: true }),
      )
    })
    await page.mouse.click(box.x + box.width / 2, box.y + 24, { delay: 0 })
    await page.waitForTimeout(2500)
    check('an interrupted journey takes its curtain with it',
      await page.evaluate(() => document.querySelectorAll('.scroll-bridge').length) === 0)

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
