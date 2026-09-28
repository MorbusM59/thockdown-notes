#!/usr/bin/env node
// Live-browser gate for the press-or-drag decision (src/shared/pointerDrag.ts).
//
// The property: a press whose pointer travels LESS than DRAG_THRESHOLD_PX is
// a click, however it wobbled, and one that travels at least that far is a
// drag whose drop lands where the pointer is released. Asserted on the two
// most-used drag sources (a section tab, a sidebar note row) and a tag pill:
//
//   1. A 4px nudge on a tab opens that tab's note (the click survives) and
//      does not reorder.
//   2. A drag of a tab onto another tab reorders them, and the release does
//      not ALSO click (the dragged tab's note is not opened).
//   3. A 4px nudge on a sidebar row opens the note.
//   3b. Dragging a sidebar row into the editor opens it there.
//   4. A 4px nudge on a tag primes it for deletion (its click), and a drag of
//      one tag onto another reorders the note's tags.
//
// Under the browser's own drag-and-drop (`draggable="true"`) check 1, 3 and
// 4's nudge fail on any platform whose drag distance is under 4px -- Chromium
// on Linux among them -- which is what makes this script able to tell the
// two implementations apart. It needs real Chromium, not the Claude Code
// browser pane: pointer capture and elementFromPoint need a laid-out page.
import { chromium } from 'playwright'
import { existsSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { startDevServer, waitForAppReady } from './perfHarness.mjs'

function resolveChromiumExecutablePath() {
  const browsersRoot = process.env.PLAYWRIGHT_BROWSERS_PATH
  if (!browsersRoot || !existsSync(browsersRoot)) return undefined
  const chromiumDir = readdirSync(browsersRoot).find((name) => name.startsWith('chromium-'))
  if (!chromiumDir) return undefined
  const candidate = path.join(browsersRoot, chromiumDir, 'chrome-linux', 'chrome')
  return existsSync(candidate) ? candidate : undefined
}

let failures = 0
function check(cond, msg) {
  console.log(`  ${cond ? 'ok' : 'FAIL'}: ${msg}`)
  if (!cond) failures += 1
}

const PORT = 5191
const server = await startDevServer(PORT)
const browser = await chromium.launch({ executablePath: resolveChromiumExecutablePath() })
try {
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })
  await page.goto(`http://localhost:${PORT}/`)
  await waitForAppReady(page)

  // Three notes pinned as tabs in the first section; the first is given two
  // tags through the tag field further down.
  await page.evaluate(async () => {
    const sectionId = document.querySelector('.editor-section-slot[data-section-id]').dataset.sectionId
    const make = async (text, tags) => (await window.thockdownNotes.createNote({ initialText: text, initialTags: tags })).id
    const ids = [await make('# Drag one', []), await make('# Drag two', []), await make('# Drag three', [])]
    for (const id of [...ids].reverse()) await window.thockdownTabs.addTab(sectionId, id)
    localStorage.setItem('__dragIds', JSON.stringify(ids))
  })
  await page.reload()
  await waitForAppReady(page)
  await page.waitForSelector('.tabbar-tabs-display .note-tab-pill[data-drag-source]')

  const tabLabels = () => page.$$eval('.tabbar-tabs-display .note-tab-pill[data-drag-source]', (pills) => pills.map((pill) => pill.textContent.trim()))
  const activeTab = () => page.$eval('.tabbar-tabs-display .note-tab-pill.is-active', (pill) => pill.textContent.trim()).catch(() => null)
  const centre = async (locator) => {
    const box = await locator.boundingBox()
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
  }
  // A press, a walk of `dx` over `steps` moves, a release -- the hand's path.
  const gesture = async (from, dx, dy, steps = 6) => {
    await page.mouse.move(from.x, from.y)
    await page.mouse.down()
    for (let i = 1; i <= steps; i += 1) await page.mouse.move(from.x + (dx * i) / steps, from.y + (dy * i) / steps)
    await page.mouse.up()
    await page.waitForTimeout(250)
  }

  const tabs = page.locator('.tabbar-tabs-display .note-tab-pill[data-drag-source]')
  const before = await tabLabels()
  console.log('tabs:', before, 'active:', await activeTab())

  // 1. Nudge the second tab.
  await gesture(await centre(tabs.nth(1)), 4, 0)
  check(JSON.stringify(await tabLabels()) === JSON.stringify(before), 'a 4px nudge on a tab does not reorder')
  check((await activeTab()) === before[1], `a 4px nudge on a tab opens it (active: ${await activeTab()})`)

  // 2. Drag the third tab onto the first.
  const activeBeforeDrag = await activeTab()
  const third = await centre(tabs.nth(2))
  const first = await centre(tabs.nth(0))
  await gesture(third, first.x - third.x, 0, 12)
  const after = await tabLabels()
  check(after[0] === before[2], `dragging a tab onto the first moves it there (${JSON.stringify(after)})`)
  check((await activeTab()) === activeBeforeDrag, 'the drag\'s release does not also click the dragged tab')
  check(await page.$('.note-tab-pill[aria-hidden="true"]') === null, 'the drag picture is gone after the drop')

  // 3. Nudge a sidebar row.
  const rows = page.locator('.note-list-item[data-note-id]')
  const rowCount = await rows.count()
  let target = null
  for (let i = 0; i < rowCount; i += 1) {
    if (!(await rows.nth(i).evaluate((row) => row.classList.contains('is-active')))) { target = rows.nth(i); break }
  }
  if (target) {
    const id = await target.getAttribute('data-note-id')
    await gesture(await centre(target), 0, 4)
    check(await page.$eval(`.note-list-item[data-note-id="${id}"]`, (row) => row.classList.contains('is-active')), 'a 4px nudge on a sidebar row opens the note')
  } else {
    check(false, 'found an inactive sidebar row to nudge')
  }

  // 3b. Drag a different sidebar row into the editor: the section's own drop
  //     handler (a capture-phase listener, reached by DOM routing) opens it.
  const other = page.locator('.note-list-item[data-note-id]:not(.is-active)').first()
  const otherId = await other.getAttribute('data-note-id')
  const editorBox = await page.locator('.editor-section-slot').first().boundingBox()
  const from = await centre(other)
  await gesture(from, editorBox.x + editorBox.width / 2 - from.x, editorBox.y + editorBox.height / 2 - from.y, 15)
  check(await page.$eval(`.note-list-item[data-note-id="${otherId}"]`, (row) => row.classList.contains('is-active')), 'dragging a sidebar row into the editor opens it there')

  // 4. Tags: open the tagged note, nudge a tag, then drag one onto the other.
  await page.locator('.tabbar-tabs-display .note-tab-pill[data-drag-source]', { hasText: 'Drag one' }).click()
  await page.waitForTimeout(250)
  for (const name of ['alpha', 'beta']) {
    await page.locator('.tabbar-tag-input-field').fill(name)
    await page.keyboard.press('Enter')
    await page.waitForTimeout(200)
  }
  const tags = page.locator('.tabbar-tags-display .tag-pill.is-active:not(.protected)')
  const tagNames = () => tags.evaluateAll((pills) => pills.map((pill) => pill.textContent.trim()))
  const tagsBefore = await tagNames()
  console.log('tags:', tagsBefore)
  if (tagsBefore.length >= 2) {
    await gesture(await centre(tags.nth(0)), 4, 0)
    check(await tags.nth(0).evaluate((pill) => pill.classList.contains('primed')), 'a 4px nudge on a tag clicks it (primes it)')
    await page.mouse.move(5, 5)
    await page.waitForTimeout(150)
    const a = await centre(tags.nth(1))
    const b = await centre(tags.nth(0))
    await gesture(a, b.x - a.x, 0, 12)
    check((await tagNames())[0] === tagsBefore[1], `dragging a tag onto the first reorders (${JSON.stringify(await tagNames())})`)
  } else {
    check(false, 'the seeded note shows its two tags')
  }
} finally {
  await browser.close()
  await server.stop()
}
if (failures) {
  console.error(`${failures} check(s) failed`)
  process.exit(1)
}
console.log('all checks passed')
