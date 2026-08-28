import { chromium } from 'playwright'
import { startDevServer } from './scripts/perf/perfHarness.mjs'
const PORT = 5223
const server = await startDevServer(PORT)
const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined })
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } })
try {
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load' })
  await page.waitForTimeout(1500)
  const lines = []
  for (let i = 0; i < 3000; i++) lines.push(`Line ${i} of a document long enough to page through comfortably.`)
  await page.evaluate(async (t) => {
    const notes = []
    for (let i = 0; i < 3; i++) notes.push(await window.thockdownNotes.createNote({ initialText: t }))
    let sections = await window.thockdownSections.createSection(null, 1)
    sections = await window.thockdownSections.createSection(null, 2)
    for (let i = 0; i < sections.length; i++) {
      await window.thockdownSections.setActiveNote(sections[i].id, notes[i % notes.length].id)
    }
  }, lines.join('\n'))
  await page.reload()
  await page.waitForSelector('.editor-stage', { timeout: 60000 })
  await page.waitForTimeout(2500)

  const snap = () => page.evaluate(() => ({
    modes: [...document.querySelectorAll('.editor-stage')].map((s) => s.classList.contains('is-preview-mode') ? 'R' : 'E'),
    active: [...document.querySelectorAll('.editor-section-column')].findIndex((c) => c.classList.contains('is-active')),
    previews: [...document.querySelectorAll('.markdown-preview')].map((p) => Math.round(p.scrollTop)),
    edits: [...document.querySelectorAll('.cm-scroller')].map((e) => Math.round(e.scrollTop)),
  }))
  const cols = await page.$$('.editor-section-column')
  console.log(`columns: ${cols.length}`)

  const setMode = async (idx, want) => {
    for (let i = 0; i < 3; i++) {
      const s = await snap()
      if (s.modes[idx] === want) return
      await cols[idx].click({ position: { x: 150, y: 400 } })
      await page.waitForTimeout(500)
      await page.keyboard.press('Escape')
      await page.waitForTimeout(1200)
    }
  }
  const test = async (label) => {
    await page.evaluate(() => {
      document.querySelectorAll('.markdown-preview').forEach((p) => { p.scrollTop = 0 })
      document.querySelectorAll('.cm-scroller').forEach((e) => { e.scrollTop = 0 })
    })
    await page.waitForTimeout(400)
    await page.keyboard.press('PageDown')
    await page.waitForTimeout(1100)
    const s = await snap()
    console.log(`  ${label}: modes=${s.modes.join('')} active=${s.active} previews=${JSON.stringify(s.previews)} edits=${JSON.stringify(s.edits)}`)
  }

  await setMode(0, 'R'); await setMode(1, 'E'); await setMode(2, 'R')
  console.log('config:', JSON.stringify(await snap()))
  await cols[0].click({ position: { x: 150, y: 400 } }); await page.waitForTimeout(600)
  await test('active=0 (render), others E,R')
  await cols[1].click({ position: { x: 150, y: 400 } }); await page.waitForTimeout(600)
  await test('active=1 (edit)')
  await cols[2].click({ position: { x: 150, y: 400 } }); await page.waitForTimeout(600)
  await test('active=2 (render)')
  await setMode(1, 'R')
  console.log('all render:', JSON.stringify(await snap()))
  await cols[1].click({ position: { x: 150, y: 400 } }); await page.waitForTimeout(600)
  await test('active=1, all three render')
} finally { await browser.close(); await server.stop() }
