// Does edit-mode text ever sit between rows?
//
// The editor's whole visual identity is a fixed character grid: every row of
// text sits on a line of it. That only holds if `scrollTop` is always an exact
// multiple of the row height. Every deliberate scroll write in CM6Editor.tsx
// quantizes -- the wheel handler rounds, the curve engine rounds each frame,
// the cage rounds its target, the thumb drag rounds -- but "every write we
// wrote" is not the same claim as "every write", and the ones we did not write
// (CM6's own scrollIntoView on a keystroke, native keyboard scrolling, restore
// paths, the browser's own scroll anchoring) are exactly the ones nobody
// checked.
//
// This script does not reason about which writes exist. It watches the real
// number through a battery of ordinary interactions and reports the worst
// distance to the nearest row boundary.
//
// It samples on ANIMATION FRAMES, not on scroll events, and the distinction
// is the whole point of the measurement. The invariant is about what the
// reader SEES. Scroll events fire during the rendering steps, before paint,
// so a position that is corrected in the same turn it was observed is a value
// that briefly existed and was never displayed -- asserting on those would be
// holding a reactive guard to a standard no reactive guard can meet. A value
// still present when the frame callback runs is a value that is about to be
// painted, and that is the one that counts.
//
// Scroll-event values are counted but deliberately NOT asserted on: the
// guard's own listener is registered before this one, so by the time this
// sees a scroll event the correction has already happened. That number
// measures listener order, not behaviour.
//
// The last check is for the failure mode the guard could plausibly introduce
// rather than fix: trading writes with CM6's own scroll-into-view during
// ordinary typing. A fight would show as the correction counter climbing
// without bound while the reader types, which is why CM6Editor exposes it.
//
// Usage: node scripts/perf/verifyEditRowGrid.mjs

import { chromium } from 'playwright'
import { startDevServer, waitForAppReady, ensureEditMode, generateSyntheticDocument } from './perfHarness.mjs'

const PORT = 5202
const EXECUTABLE_PATH = process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined

/**
 * How far off the grid counts as a real defect.
 *
 * Not zero: a browser stores `scrollTop` as a float and, on a fractional
 * device pixel ratio, can report a value a hair off what was written. Half a
 * CSS pixel is below the threshold of anything visible and safely above that
 * noise.
 */
const TOLERANCE_PX = 0.5

const failures = []
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` -- ${detail}` : ''}`)
  if (!ok) failures.push(label)
}

/** Records every position the scroller reports, and every one a frame sees. */
const START_WATCH = `(() => {
  const scroller = document.querySelector('.cm-scroller')
  window.__gridSamples = []
  window.__paintedSamples = []
  if (window.__gridWatch) scroller.removeEventListener('scroll', window.__gridWatch)
  window.__gridWatch = () => { window.__gridSamples.push(scroller.scrollTop) }
  scroller.addEventListener('scroll', window.__gridWatch, { passive: true })
  window.__gridStop = false
  const onFrame = () => {
    if (window.__gridStop) return
    window.__paintedSamples.push(scroller.scrollTop)
    requestAnimationFrame(onFrame)
  }
  requestAnimationFrame(onFrame)
  // The resting position counts too -- an interaction that never fires a
  // scroll event can still have left the previous one off the grid.
  window.__gridSamples.push(scroller.scrollTop)
})()`

/** The worst distance from a row boundary across everything recorded. */
const STOP_WATCH = `(() => {
  const scroller = document.querySelector('.cm-scroller')
  scroller.removeEventListener('scroll', window.__gridWatch)
  window.__gridStop = true
  window.__gridSamples.push(scroller.scrollTop)
  window.__paintedSamples.push(scroller.scrollTop)
  const lineHeight = parseFloat(getComputedStyle(document.querySelector('.cm-content')).lineHeight)
  const offBy = (top) => Math.abs(top - Math.round(top / lineHeight) * lineHeight)
  const summarize = (samples) => {
    let worst = 0
    let worstIndex = -1
    samples.forEach((top, index) => {
      const off = offBy(top)
      if (off > worst) { worst = off; worstIndex = index }
    })
    const from = Math.max(0, worstIndex - 3)
    // Plain concatenation, not a nested template literal: this whole block is
    // itself a template string in the Node process, and an inner backtick ends it.
    const around = samples.slice(from, worstIndex + 4)
      .map((top, i) => (from + i === worstIndex ? '>' : ' ') + top.toFixed(1) + '(' + offBy(top).toFixed(1) + ')')
    return { worst, count: samples.length, around: around.join(' ') }
  }
  const resting = scroller.scrollTop
  return {
    painted: summarize(window.__paintedSamples),
    observed: summarize(window.__gridSamples),
    lineHeight,
    restingOff: offBy(resting),
  }
})()`

async function watch(page, label, interact) {
  await page.evaluate(START_WATCH)
  await interact()
  await page.waitForTimeout(400)
  const result = await page.evaluate(STOP_WATCH)
  const ok = result.painted.worst <= TOLERANCE_PX && result.restingOff <= TOLERANCE_PX
  check(
    `${label}: text stays on the row grid`,
    ok,
    `painted worst ${result.painted.worst.toFixed(1)}px, resting ${result.restingOff.toFixed(1)}px ` +
    `(${result.painted.count} frames sampled)`,
  )
  if (!ok) console.log(`        painted around: ${result.painted.around}`)
  return result
}

async function main() {
  const server = await startDevServer(PORT)
  const browser = await chromium.launch({ executablePath: EXECUTABLE_PATH })
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  const errors = []
  page.on('pageerror', (err) => errors.push(String(err).slice(0, 200)))
  page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text().slice(0, 200)) })

  try {
    // The correction counter rides on CM6Editor's cage-state debug hook,
    // which is opt-in so it costs nothing in normal use.
    await page.addInitScript(() => window.localStorage.setItem('thockdown:debug-cage-state', '1'))
    await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load' })
    await waitForAppReady(page)
    await page.evaluate(async (text) => {
      const note = await window.thockdownNotes.createNote({ initialText: text })
      await window.thockdownSections.setActiveNote('default', note.id)
    }, generateSyntheticDocument(300000))
    await page.reload()
    await ensureEditMode(page)
    await page.waitForTimeout(2500)

    const lineHeight = await page.evaluate(
      () => parseFloat(getComputedStyle(document.querySelector('.cm-content')).lineHeight),
    )
    check('the row height is a whole pixel', Number.isInteger(lineHeight), `${lineHeight}px`)

    const scroller = page.locator('.cm-scroller')
    const box = await scroller.boundingBox()
    await page.locator('.cm-content').click({ position: { x: 40, y: 40 } })
    await page.waitForTimeout(300)

    await watch(page, 'wheel scrolling', async () => {
      for (let i = 0; i < 12; i += 1) {
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
        await page.mouse.wheel(0, 220)
        await page.waitForTimeout(40)
      }
    })

    await watch(page, 'PageDown held', async () => {
      await page.keyboard.down('PageDown')
      await page.waitForTimeout(1200)
      await page.keyboard.up('PageDown')
      await page.waitForTimeout(900)
    })

    await watch(page, 'arrow keys past the cage edge', async () => {
      for (let i = 0; i < 40; i += 1) await page.keyboard.press('ArrowDown')
      await page.waitForTimeout(200)
      for (let i = 0; i < 20; i += 1) await page.keyboard.press('ArrowUp')
    })

    await watch(page, 'typing at the bottom of the cage', async () => {
      for (let i = 0; i < 30; i += 1) await page.keyboard.press('a')
      await page.keyboard.press('Enter')
      for (let i = 0; i < 30; i += 1) await page.keyboard.press('b')
    })

    await watch(page, 'dragging the scrollbar thumb', async () => {
      const thumb = page.locator('.thockdown-scroll-thumb')
      const thumbBox = await thumb.boundingBox()
      await page.mouse.move(thumbBox.x + thumbBox.width / 2, thumbBox.y + thumbBox.height / 2)
      await page.mouse.down()
      for (let i = 1; i <= 10; i += 1) {
        await page.mouse.move(thumbBox.x + thumbBox.width / 2, thumbBox.y + thumbBox.height / 2 + i * 18)
        await page.waitForTimeout(30)
      }
      await page.mouse.up()
    })

    await watch(page, 'a scrollbar track click that travels', async () => {
      const track = page.locator('.thockdown-scroll-track')
      const trackBox = await track.boundingBox()
      await page.mouse.click(trackBox.x + trackBox.width / 2, trackBox.y + trackBox.height * 0.75)
      await page.waitForTimeout(1500)
    })

    await watch(page, 'a scrollbar track hold that snaps', async () => {
      const track = page.locator('.thockdown-scroll-track')
      const trackBox = await track.boundingBox()
      await page.mouse.move(trackBox.x + trackBox.width / 2, trackBox.y + trackBox.height * 0.35)
      await page.mouse.down()
      await page.waitForTimeout(500)
      await page.mouse.up()
      await page.waitForTimeout(600)
    })

    await watch(page, 'a round trip through render view', async () => {
      await page.keyboard.press('Escape')
      await page.waitForTimeout(900)
      await page.keyboard.press('Escape')
      await page.waitForTimeout(1200)
    })

    await watch(page, 'a window resize', async () => {
      await page.setViewportSize({ width: 1000, height: 740 })
      await page.waitForTimeout(900)
      await page.setViewportSize({ width: 1280, height: 900 })
      await page.waitForTimeout(900)
    })

    // The guard corrects by writing scrollTop, and CM6 answers keystrokes by
    // scrolling the caret into view. If those two disagreed about where a row
    // belongs they would trade writes forever -- the exact infinite fight
    // CageMath.ts records having had with the same mechanism. A bounded count
    // over a burst of typing is the evidence that they do not.
    const before = await page.evaluate(() => window.__thockdownDebugCageState().rowGridCorrectionCount)
    await page.locator('.cm-content').click({ position: { x: 40, y: 200 } })
    for (let i = 0; i < 60; i += 1) await page.keyboard.press('x')
    await page.waitForTimeout(600)
    const after = await page.evaluate(() => window.__thockdownDebugCageState().rowGridCorrectionCount)
    check(
      'the guard does not fight CM6 scroll-into-view while typing',
      after - before <= 60,
      `${after - before} corrections over 60 keystrokes`,
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
