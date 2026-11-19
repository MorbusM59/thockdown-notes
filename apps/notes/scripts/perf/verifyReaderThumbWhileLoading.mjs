// The Reader's scrollbar while a large note is still being split: a right
// hold on the track pages down while instalments arrive, and the thumb must
// only move forward and never change size after its first answer. Before the
// character space divided by the whole document, every instalment pulled the
// thumb back and every window move resized it.
//
//   node scripts/perf/verifyReaderThumbWhileLoading.mjs   (CHARS=2000000 default)
import { chromium } from 'playwright'
import { startDevServer, waitForAppReady, ensurePreviewMode } from './perfHarness.mjs'
const PORT = 5262
const server = await startDevServer(PORT)
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' })
  await waitForAppReady(page).catch(() => {})
  await page.waitForTimeout(1500)
  const noteId = await page.evaluate(async (chars) => {
    let text = '# Imported Report\n\n'
    while (text.length < chars) text += `## Section ${text.length}\n\nA paragraph of prose long enough to wrap in a real editor window, and then some more words.\n\n- alpha\n- beta\n\n`
    const note = await window.thockdownNotes.createNote({ title: 'Imported Report' })
    await window.thockdownNotes.saveNote({ id: note.id, text })
    return note.id
  }, Number(process.env.CHARS ?? 2000000))
  await page.reload(); await waitForAppReady(page).catch(() => {}); await page.waitForTimeout(2000)
  await ensurePreviewMode(page)
  const row = page.locator(`.note-list-item[data-note-id="${noteId}"]`)
  await row.waitFor({ timeout: 30000 })
  await page.evaluate(() => {
    const w = window; w.__log = []; const t0 = performance.now()
    const tick = () => {
      const pane = document.querySelector('.markdown-preview')
      const track = [...document.querySelectorAll('.thockdown-scroll-track')].find((el) => el.closest('.markdown-preview, [class*="preview"]') || el.parentElement?.parentElement?.querySelector?.('.markdown-preview'))
      const thumb = track?.querySelector('.thockdown-scroll-thumb')
      w.__log.push([Math.round(performance.now() - t0), document.querySelectorAll('.markdown-preview div[data-index]').length, pane?.scrollTop ?? -1, thumb?.style.top ?? '', thumb?.style.height ?? '', track ? Math.round(track.getBoundingClientRect().height) : -1])
      if (performance.now() - t0 < 20000) requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  })
  await row.click()
  await page.waitForTimeout(Number(process.env.DELAY ?? 150))
  const box = await page.evaluate(() => {
    const tracks = [...document.querySelectorAll('.thockdown-scroll-track')].map((el) => el.getBoundingClientRect()).filter((r) => r.height > 200)
    return tracks.map((r) => ({ x: r.x + r.width / 2, y: r.y, h: r.height }))
  })
  console.log('tracks', JSON.stringify(box))
  const tr = box[box.length - 1]
  await page.mouse.move(tr.x, tr.y + tr.h * 0.7)
  await page.mouse.down({ button: 'right' })
  await page.waitForTimeout(4000)
  await page.mouse.up({ button: 'right' })
  await page.waitForTimeout(14000)
  const log = await page.evaluate(() => window.__log)
  const sized = log.filter((r) => r[1] > 0 && r[3] !== '' && r[4] !== `${Math.round(r[5]) - 6}px`)
  let back = 0; let resized = 0
  for (let i = 1; i < sized.length; i += 1) {
    if (parseFloat(sized[i][3]) < parseFloat(sized[i - 1][3])) back += 1
    if (sized[i][4] !== sized[i - 1][4]) resized += 1
  }
  console.log(`frames ${log.length}, thumb steps back ${back}, thumb size changes ${resized}`)
  if (back > 0 || resized > 0) process.exitCode = 1
} finally { await browser.close(); server.stop?.() }
process.exit(process.exitCode ?? 0)
