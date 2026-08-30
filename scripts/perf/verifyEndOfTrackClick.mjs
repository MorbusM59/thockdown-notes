// Does clicking the very bottom of the scrollbar track reach the END of the
// document -- on the FIRST click, before anything has been measured?
//
// The end of the track is a statement about the text: "take me to the end".
// Everything that carries it there is geometry, and on a document nobody has
// read yet that geometry is an estimate which keeps changing WHILE the journey
// is travelling to it. So a target fixed at click time stops being the end
// before it is reached.
//
// Measured before this was fixed, on 1.5M characters:
//   edit view   26px short, every time (CM6 revises scrollHeight as it
//               measures real lines; scrollHeight itself moved 26px between
//               the first click and a later one)
//   render view intermittent, and much worse -- 4px short on one run and
//               197,900px on the next, landing at 19% of the document
//               instead of at its end
//
// Both are corrected once the journey is over and the geometry has stopped
// moving, which is why this clicks EARLY and deliberately does not wait.
//
// Usage: node scripts/perf/verifyEndOfTrackClick.mjs
import { chromium } from 'playwright'
import {
  startDevServer, waitForAppReady, ensurePreviewMode, ensureEditMode, generateSyntheticDocument,
} from './perfHarness.mjs'

const PORT = 5221

const failures = []
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` -- ${detail}` : ''}`)
  if (!ok) failures.push(label)
}

// A couple of pixels of slack, and no more: the scroller's own rounding is
// worth about one, and anything past that is the defect this exists to catch.
const TOLERANCE_PX = 3

const readEnd = (page, selector) => page.evaluate((sel) => {
  const scroller = document.querySelector(sel)
  return {
    scrollTop: Math.round(scroller.scrollTop),
    maxScrollTop: Math.round(scroller.scrollHeight - scroller.clientHeight),
    shortByPx: Math.round((scroller.scrollHeight - scroller.clientHeight) - scroller.scrollTop),
  }
}, selector)

const clickBottomOfTrack = async (page) => {
  const box = await page.locator('.thockdown-scroll-track').boundingBox()
  await page.mouse.click(box.x + box.width / 2, box.y + box.height - 2, { delay: 0 })
}

async function runCase(page, { chars, mode, label }) {
  await page.evaluate(async (initialText) => {
    const note = await window.thockdownNotes.createNote({ initialText })
    await window.thockdownSections.setActiveNote('default', note.id)
  }, generateSyntheticDocument(chars))
  await page.reload()
  await (mode === 'edit' ? ensureEditMode(page) : ensurePreviewMode(page))
  const selector = mode === 'edit' ? '.cm-scroller' : '.markdown-preview'

  // Deliberately early. Waiting for the document to be measured would test
  // the one case that never failed.
  await page.waitForTimeout(250)
  await clickBottomOfTrack(page)
  await page.waitForTimeout(3500)
  const first = await readEnd(page, selector)
  check(`${label}: the first click at the bottom of the track reaches the end`,
    Math.abs(first.shortByPx) <= TOLERANCE_PX,
    `${first.scrollTop} of ${first.maxScrollTop}, short by ${first.shortByPx}px`)

  await page.waitForTimeout(9000)
  await page.evaluate((sel) => { document.querySelector(sel).scrollTop = 0 }, selector)
  await page.waitForTimeout(600)
  await clickBottomOfTrack(page)
  await page.waitForTimeout(3500)
  const second = await readEnd(page, selector)
  check(`${label}: and so does one made after the document has settled`,
    Math.abs(second.shortByPx) <= TOLERANCE_PX,
    `${second.scrollTop} of ${second.maxScrollTop}, short by ${second.shortByPx}px`)
}

/**
 * The exact boundary of the mapping: 0%-100% runs from the centre of the thumb
 * at rest to the centre of the thumb at the end of its travel, so a click one
 * half-thumb up from the bottom of the track is the FIRST position that means
 * "the end". Everything below it is inside the bottom offset and means the
 * same thing. This is where the miss was still visible after the end of the
 * track itself had been fixed -- measured at 99.7% of the document, one row
 * short, because the height was still settling when the correction landed.
 */
async function runBoundaryCase(page, { chars, mode, label }) {
  const selector = mode === 'edit' ? '.cm-scroller' : '.markdown-preview'
  await page.evaluate(async (initialText) => {
    const note = await window.thockdownNotes.createNote({ initialText })
    await window.thockdownSections.setActiveNote('default', note.id)
  }, generateSyntheticDocument(chars))
  await page.reload()
  await (mode === 'edit' ? ensureEditMode(page) : ensurePreviewMode(page))
  await page.waitForTimeout(250)

  const box = await page.locator('.thockdown-scroll-track').boundingBox()
  const halfThumbPx = await page.evaluate(() => (
    (parseFloat(document.querySelector('.thockdown-scroll-thumb').style.height) || 0) / 2
  ))

  // A HOLD, which snaps. Deliberately, and this is the part that makes the
  // check discriminating: a travelling click takes long enough that the
  // document's height has usually stopped moving by the time it lands, so it
  // passes with or without the correction. A snap arrives immediately, while
  // the height is still settling, which is the condition the miss needs.
  // Verified: without the correction this reads 99.7% of the document.
  await page.mouse.move(box.x + box.width / 2, box.y + box.height - halfThumbPx)
  await page.mouse.down()
  await page.waitForTimeout(380)
  await page.mouse.up()
  await page.waitForTimeout(1200)
  const landed = await readEnd(page, selector)
  check(`${label}: a first snap at the thumb-centre-at-end boundary reaches the end`,
    Math.abs(landed.shortByPx) <= TOLERANCE_PX,
    `${landed.scrollTop} of ${landed.maxScrollTop}, short by ${landed.shortByPx}px`)
}

async function main() {
  const server = await startDevServer(PORT)
  const browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined,
  })
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  const errors = []
  page.on('pageerror', (err) => errors.push(String(err).slice(0, 200)))
  page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text().slice(0, 200)) })

  try {
    await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load' })
    await waitForAppReady(page)
    await runCase(page, { chars: 400000, mode: 'edit', label: 'edit view, 400k' })
    await runCase(page, { chars: 1500000, mode: 'edit', label: 'edit view, 1.5M' })
    await runCase(page, { chars: 1500000, mode: 'preview', label: 'render view, 1.5M' })
    await runBoundaryCase(page, { chars: 45000, mode: 'edit', label: 'edit view, 45k' })
    await runBoundaryCase(page, { chars: 45000, mode: 'preview', label: 'render view, 45k' })
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
