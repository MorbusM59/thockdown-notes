// Regression check: after a programmatic note switch, does the caret land
// where the text is?
//
// The block caret is drawn from the geometry of the browser's DOM selection,
// and CM6 writes that selection into the DOM in its own measure phase --
// without a state update, a focus event, or anything else the caret was
// listening to. So a switch that replaces the document and sets a selection
// used to measure the caret one beat too early, against a selection still
// anchored on the scroller's content container, whose collapsed rect sits at
// the RIGHT-HAND EDGE of the content box. Nothing asked again afterwards, so
// the caret stayed there -- most visibly after creating a chapter, which
// lands the caret at the end of a freshly written "## " and is the case this
// was reported for ("the letters appear in the right place, but the caret
// does not show up until I start typing").
//
// The check is self-calibrating rather than absolute: type one character and
// the caret must move by exactly one cell. A caret parked at the edge of the
// content box fails that by hundreds of pixels, and no assumption about font
// metrics, padding or window size has to be baked in.
//
// Usage: node scripts/perf/verifyProgrammaticSwitchCaret.mjs

import { chromium } from 'playwright'
import { startDevServer } from './perfHarness.mjs'

const PORT = 5198
const EXECUTABLE_PATH = process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined

const failures = []
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` -- ${detail}` : ''}`)
  if (!ok) failures.push(label)
}

const readCaretX = () => {
  const caret = document.querySelector('.thockdown-block-caret')
  if (!caret) return null
  const match = /translate\(([-\d.]+)px/.exec(caret.style.transform || '')
  return match ? Number(match[1]) : null
}

/** The editor's own cell width, so "one column" is not a guess. */
const readCellWidth = () => {
  const content = document.querySelector('.cm-content')
  const line = content?.querySelector('.cm-line')
  const text = line?.firstChild
  if (!text || text.nodeType !== Node.TEXT_NODE || text.data.length === 0) return null
  const range = document.createRange()
  range.setStart(text, 0)
  range.setEnd(text, 1)
  return range.getBoundingClientRect().width
}

async function enterEditMode(page) {
  await page.waitForSelector('.cm-content', { state: 'attached', timeout: 60000 })
  await page.waitForTimeout(2000)
  if (!(await page.locator('.cm-content').isVisible())) {
    await page.keyboard.press('Escape')
    await page.waitForSelector('.cm-content', { state: 'visible', timeout: 30000 })
    await page.waitForTimeout(1200)
  }
}

/**
 * Creates something via `open`, then asserts the caret it lands on is real:
 * present, and exactly one cell to the left of where it sits after one
 * keystroke.
 */
async function checkCaretAfter(page, label, open) {
  await open()
  await page.waitForTimeout(2000)

  const before = await page.evaluate(readCaretX)
  check(`${label}: the caret is on screen straight away`, before !== null,
    before === null ? 'no caret element' : `x = ${Math.round(before)}px`)
  if (before === null) return

  await page.keyboard.type('Z')
  await page.waitForTimeout(600)
  const after = await page.evaluate(readCaretX)
  const cell = await page.evaluate(readCellWidth)
  if (after === null || !cell) {
    check(`${label}: the caret is at the typing position`, false, 'could not measure after the keystroke')
    return
  }
  const moved = after - before
  // One cell, within the caret's own half-cell quantization.
  check(`${label}: the caret is at the typing position`, Math.abs(moved - cell) <= cell,
    `moved ${Math.round(moved)}px on one keystroke, one cell is ${Math.round(cell)}px`)
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
    await page.waitForTimeout(2000)
    await page.evaluate(async () => {
      const note = await window.thockdownNotes.createNote({ initialText: '# A Host Note\n\nSome body text here so the note is not empty, and long enough to put the caret a long way from the left margin when clicked.\n' })
      await window.thockdownSections.setActiveNote('default', note.id)
    })
    await page.reload()
    await enterEditMode(page)

    // Park the caret far from the left margin first: the failure this guards
    // against is the NEW note's caret still being drawn at the OLD one's
    // position, which is invisible if both are at column zero.
    await page.locator('.cm-content').click()
    await page.waitForTimeout(600)

    const chapterToggle = page.locator('[aria-label="Show chapters"]')
    if (await chapterToggle.count()) {
      await chapterToggle.first().click()
      await page.waitForTimeout(800)
    }

    await checkCaretAfter(page, 'new chapter', async () => {
      await page.locator('.chapter-pill.create-pill').first().click()
    })

    await checkCaretAfter(page, 'new note', async () => {
      await page.locator('.note-tab-pill.create-pill').first().click()
    })

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
