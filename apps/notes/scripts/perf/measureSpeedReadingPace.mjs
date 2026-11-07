#!/usr/bin/env node
// Measures speed reading's TRUE pace in the running app against the figure it
// shows, in both views, plus the time left it shows.
//
// - Render view: words that cross the top of the pane per minute. Ground
//   truth is independent of the session's own density estimate: every block's
//   words (split from innerText) and its box, the gaps between blocks holding
//   none, with a block's words spread evenly over its height.
// - Edit view: Space held, every row change recorded with its time; words
//   shown per minute over the steady part of the hold.
//
// Run: node scripts/perf/measureSpeedReadingPace.mjs [--port=N] [--seconds=12]

import { chromium } from 'playwright'
import { startDevServer, seedLargeNoteAndReload, placeCaretAt } from './perfHarness.mjs'

function syntheticNote(paragraphs) {
  const words = ['the', 'reader', 'follows', 'a', 'line', 'of', 'text', 'across', 'the', 'page', 'and', 'back',
    'considerably', 'interesting', 'notes', 'keep', 'their', 'shape', 'while', 'we', 'read', 'them', 'quickly']
  let seed = 7
  const rand = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648 }
  const sentence = () => {
    const n = 3 + Math.floor(rand() * 14)
    const out = []
    for (let i = 0; i < n; i += 1) {
      let w = words[Math.floor(rand() * words.length)]
      const r = rand()
      if (r < 0.05) w = `**${w}**`
      else if (r < 0.15 && i < n - 1) w = `${w},`
      out.push(w)
    }
    return out.join(' ') + (rand() < 0.8 ? '.' : '?')
  }
  const blocks = []
  for (let p = 0; p < paragraphs; p += 1) {
    const kind = rand()
    if (kind < 0.1) blocks.push(`## ${sentence().replace(/[.?]/g, '')}`)
    else if (kind < 0.25) blocks.push(Array.from({ length: 3 }, () => `- ${sentence()}`).join('\n'))
    else blocks.push(Array.from({ length: 1 + Math.floor(rand() * 6) }, sentence).join(' '))
  }
  return blocks.join('\n\n')
}

const args = { port: 5191, seconds: 12 }
for (const raw of process.argv.slice(2)) {
  const [k, v] = raw.replace(/^--/, '').split('=')
  args[k] = Number(v)
}

const readPanel = (page) => page.evaluate(() => {
  const span = document.querySelector('.wordcount-panel [data-tooltip^="Speed reading"]')
  return span && !span.hidden ? span.textContent.replace(/\s+/g, ' ').trim() : null
})
const clockSec = (text) => {
  const m = /(\d+):(\d\d):(\d\d)/.exec(text ?? '')
  return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : NaN
}

const server = await startDevServer(args.port)
const browser = await chromium.launch()
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
  await page.goto(`http://localhost:${args.port}/`)
  await seedLargeNoteAndReload(page, syntheticNote(400))
  await placeCaretAt(page, 'start')

  if (!process.env.SKIP_EDIT) {
  // ---- Edit view ----
  await page.keyboard.press('F9')
  await page.waitForTimeout(300)
  const editPanel = await readPanel(page)
  await page.evaluate(() => {
    window.__rows = []
    const rec = () => {
      const t = document.querySelector('.speed-reading-text')?.textContent ?? ''
      const last = window.__rows[window.__rows.length - 1]
      if (!last || last.text !== t) window.__rows.push({ t: performance.now(), text: t })
      if (window.__recording) requestAnimationFrame(rec)
    }
    window.__recording = true
    requestAnimationFrame(rec)
  })
  await page.keyboard.down('Space')
  await page.waitForTimeout(args.seconds * 1000)
  const editPanelLate = await readPanel(page)
  await page.keyboard.up('Space')
  const rows = await page.evaluate(() => { window.__recording = false; return window.__rows })
  const steadyFrom = rows[0].t + 3000 // past the ease in
  const steady = rows.filter((r) => r.t >= steadyFrom)
  let words = 0
  for (let i = 0; i < steady.length - 1; i += 1) words += steady[i].text.split(/\s+/).filter(Boolean).length
  const editWpm = (words / ((steady[steady.length - 1].t - steady[0].t) / 1000)) * 60
  const shownEditWpm = Number(editPanel.split('|')[0])
  console.log(`edit   shown ${shownEditWpm} wpm  measured ${editWpm.toFixed(1)} wpm  (${(editWpm / shownEditWpm * 100).toFixed(1)}%)  time left ${editPanel.split('|')[1]?.trim()} -> ${editPanelLate.split('|')[1]?.trim()} after ${args.seconds}s held`)
  await page.keyboard.press('F9')
  }

  if (!process.env.SKIP_RENDER) {
  // ---- Render view ----
  await page.keyboard.press('Escape')
  await page.waitForSelector('.markdown-preview', { timeout: 10000 })
  await page.evaluate(() => { document.querySelector('.markdown-preview').scrollTop = 0 })
  await page.waitForTimeout(800)
  await page.keyboard.press('F9')
  // Faster than the default so the run crosses several screens: the pace is
  // set from a screen's average, so only a run of several screens can be
  // compared with words crossing one edge.
  for (let i = 0; i < (args.renderTaps ?? 0); i += 1) await page.keyboard.press('ArrowRight')
  await page.waitForTimeout(3000) // ease in and density settle
  const measure = () => page.evaluate(() => {
    const scroller = document.querySelector('.markdown-preview')
    const top = scroller.getBoundingClientRect().top
    // Words above the pane's top edge: whole blocks above it, and the share of the block it cuts.
    let above = 0
    for (const block of scroller.querySelectorAll('[data-index], [data-tail-index]')) {
      const r = block.getBoundingClientRect()
      const n = block.innerText.split(/\s+/).filter(Boolean).length
      if (r.bottom <= top) above += n
      else if (r.top < top) above += n * ((top - r.top) / r.height)
    }
    const idx = [...scroller.querySelectorAll('[data-index]')].map((e) => Number(e.dataset.index))
    return { first: idx[0], last: idx[idx.length - 1], count: idx.length, t: performance.now(), scrollTop: scroller.scrollTop, max: scroller.scrollHeight - scroller.clientHeight, above }
  })
  const a = await measure()
  const panelA = await readPanel(page)
  await page.waitForTimeout(args.seconds * 1000)
  const b = await measure()
  console.log('mounted', JSON.stringify({ a: [a.first, a.last, a.count, a.scrollTop, a.above], b: [b.first, b.last, b.count, b.scrollTop, b.above] }))
  const renderWpm = ((b.above - a.above) / ((b.t - a.t) / 1000)) * 60
  const shownRenderWpm = Number(panelA.split('|')[0])
  const pxPerSec = (b.scrollTop - a.scrollTop) / ((b.t - a.t) / 1000)
  const panelB = await readPanel(page)
  console.log(`render shown ${shownRenderWpm} wpm  measured ${renderWpm.toFixed(1)} wpm  (${(renderWpm / shownRenderWpm * 100).toFixed(1)}%)  time left shown ${panelB.split('|')[1]?.trim()}  measured ${((b.max - b.scrollTop) / pxPerSec).toFixed(0)}s`)
  console.log(`check ${clockSec(panelA)} - ${args.seconds} ≈ ${clockSec(panelB)}`)
  }
} finally {
  await browser.close()
  server.stop()
}
