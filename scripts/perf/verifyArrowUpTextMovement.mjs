// THE invariant, measured directly: one ArrowUp must move the TEXT by
// exactly zero rows or exactly one row -- never more -- even when CM6
// revises its height map underneath the press.
//
// Why not measure scrollTop. Because scrollTop conflates two different
// things. When CM6 learns the real heights of text that was only estimated,
// it shifts scrollTop by the revision's cost specifically so the text does
// NOT move. A press that reports a scrollTop delta of -208px may have moved
// the reader by one row (-26) while absorbing a -182px revision, which is
// correct, or it may have moved them by eight rows, which is the bug. The
// number alone cannot tell you, and verifyCM6ArrowUpChunkBoundary.mjs
// reports exactly that number.
//
// So this tracks the text. Before each press it records every rendered line's
// content and screen position; after the press it finds those same lines
// again and takes the median shift. That is what the reader sees, and it is
// the only thing the invariant is about.
//
// Run: node scripts/perf/verifyArrowUpTextMovement.mjs [--presses=N] [--chars=N]
import { chromium } from 'playwright'
import { startDevServer, waitForAppReady, ensureEditMode, generateSyntheticDocument } from './perfHarness.mjs'

const args = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => {
  const [k, ...rest] = a.replace(/^--/, '').split('=')
  return [k, rest.join('=')]
}))
const numeric = (key, fallback) => (args[key] !== undefined && Number.isFinite(Number(args[key])) ? Number(args[key]) : fallback)

const PORT = 5251

const snapshotLines = (page) => page.evaluate(() => {
  const out = []
  for (const el of document.querySelectorAll('.cm-line')) {
    const text = (el.textContent ?? '').trim()
    if (!text) continue
    out.push([text, Math.round(el.getBoundingClientRect().top)])
  }
  return out
})

const main = async () => {
  const presses = numeric('presses', 400)
  const server = await startDevServer(PORT)
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1100, height: 700 } })
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)))
  try {
    await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load' })
    await waitForAppReady(page)
    await page.evaluate(async (text) => {
      const n = await window.thockdownNotes.createNote({ initialText: text })
      await window.thockdownSections.setActiveNote('default', n.id)
    }, generateSyntheticDocument(numeric('chars', 1500000)))
    await page.reload()
    await waitForAppReady(page)
    await ensureEditMode(page)
    await page.waitForTimeout(8000)

    // Start near the end, so ArrowUp walks back through text the editor has
    // never rendered -- which is where revisions happen.
    const track = await page.locator('.thockdown-scroll-track').boundingBox()
    await page.mouse.click(track.x + track.width / 2, track.y + track.height * 0.93, { delay: 0 })
    await page.waitForTimeout(6000)
    const textPoint = await page.evaluate(() => {
      const el = document.querySelector('.cm-scroller')
      const r = el.getBoundingClientRect()
      return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height * 0.5) }
    })
    await page.mouse.click(textPoint.x, textPoint.y, { delay: 80 })
    await page.waitForTimeout(1000)

    const lineHeightPx = await page.evaluate(() => Math.round(
      parseFloat(getComputedStyle(document.querySelector('.cm-line')).lineHeight) || 26))

    const violations = []
    let measured = 0
    let before = await snapshotLines(page)

    for (let i = 0; i < presses; i += 1) {
      await page.keyboard.press('ArrowUp')
      const after = await snapshotLines(page)

      const beforeMap = new Map(before)
      const shifts = []
      for (const [text, top] of after) {
        const wasAt = beforeMap.get(text)
        if (wasAt !== undefined) shifts.push(top - wasAt)
      }
      if (shifts.length >= 3) {
        shifts.sort((a, b) => a - b)
        const median = shifts[Math.floor(shifts.length / 2)]
        const rows = median / lineHeightPx
        measured += 1
        // ArrowUp moves the text DOWN by one row, or not at all.
        if (Math.abs(rows) > 1.25) {
          violations.push({ press: i, movedPx: median, movedRows: Number(rows.toFixed(2)), sharedLines: shifts.length })
        }
      }
      before = after
    }

    console.log(`line height ${lineHeightPx}px, ${presses} presses, ${measured} comparable`)
    console.log(`TEXT MOVED MORE THAN ONE ROW ON ${violations.length} PRESSES`)
    for (const v of violations.slice(0, 12)) {
      console.log(`   press ${v.press}: text moved ${v.movedPx}px = ${v.movedRows} rows (${v.sharedLines} lines matched)`)
    }
    console.log(`page errors: ${errors.length ? errors.join(' | ') : 'none'}`)
    if (violations.length > 0) process.exitCode = 1
  } finally { await browser.close(); server.stop() }
}
main().catch((e) => { console.error(e); process.exit(1) })
