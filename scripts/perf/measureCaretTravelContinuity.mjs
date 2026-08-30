// Is caret travel continuous when an arrow key is held down?
//
// Holding an arrow key should walk the caret to the viewport's edge and then
// move the text by exactly one row per keypress, with the caret pinned to that
// edge. The reported defect is that at chunk boundaries the text shifts by
// several rows at once and the caret snaps back toward the middle, so travel
// comes in lurches; and that travelling into an area the editor has not
// measured yet (resize, then jump) makes the text vibrate and flicker.
//
// A MEASUREMENT TOOL, NOT A GATE. It does not reproduce the defect, and is
// committed so the next attempt starts from a working instrument rather than
// rebuilding one. On dev:browser, 1.5M chars of prose, four ten-second holds:
//
//   settled document, ArrowDown      every scroll step exactly one row
//   settled document, ArrowUp        every scroll step exactly one row
//   resize + jump, ArrowDown         every scroll step exactly one row
//   resize + jump, ArrowUp           every scroll step exactly one row
//
// 222-243 moving frames per run, zero steps larger than 1.4 rows, zero
// against the direction of travel. Both directions were tested because a
// heightmap correction for newly-measured lines ABOVE the viewport moves what
// is on screen where the same correction below it does not, so up-travel into
// unmeasured text was the strongest suspicion. It is clean too.
//
// Three things were needed to make those numbers mean anything, and each one
// was wrong in an earlier version of this file:
//
//   1. REAL auto-repeat. Playwright's keyboard.press never sets the repeat
//      flag, and this app branches on it. These are CDP rawKeyDown events
//      with autoRepeat set on everything after the first.
//   2. Sampling from INSIDE the page, every animation frame. Reading the
//      scroll position over the wire between keypresses adds ~20ms of pause
//      each time, which lets the app settle -- exactly what holding a key
//      does not do, and enough to hide any glitch completely.
//   3. Prose that wraps. The usual synthetic document is headings, lists and
//      blockquotes; a document of long paragraphs wraps the way the reported
//      one does, and wrapping is what makes rows and source lines disagree.
//
// So if this still shows nothing, the difference is somewhere else: real
// Electron, the reader's own typography, or a document whose block shapes
// differ from prose. Worth trying those before writing any code.
//
// Usage:
//   node scripts/perf/measureCaretTravelContinuity.mjs
//   node scripts/perf/measureCaretTravelContinuity.mjs --file="C:\path\to\ulysses.md"
//   ... --font=28 --width=900 --height=600 --hold=20000
//
// Flags:
//   --file=PATH   read a real document instead of generating prose. This is
//                 the one most likely to matter: generated paragraphs are all
//                 the same shape, and a real book is not.
//   --chars=N     size of the generated document when --file is not given
//                 (default 1500000)
//   --font=N      editor font size in px. Fewer rows per screen means more
//                 frequent chunk boundaries, so a large font is worth trying.
//   --width=N --height=N   window size (default 1280x900)
//   --hold=MS     how long to hold the arrow key each run (default 14000)
import { chromium } from 'playwright'
import fs from 'node:fs'
import { startDevServer, waitForAppReady, ensureEditMode } from './perfHarness.mjs'

const PORT = 5249

const args = Object.fromEntries(process.argv.slice(2)
  .filter((a) => a.startsWith('--'))
  .map((a) => {
    const [key, ...rest] = a.replace(/^--/, '').split('=')
    return [key, rest.join('=')]
  }))
const numeric = (key, fallback) => (args[key] !== undefined && Number.isFinite(Number(args[key])) ? Number(args[key]) : fallback)

const WORDS = ('stately plump buck mulligan came from the stairhead bearing a bowl of lather on which a mirror '
  + 'and a razor lay crossed the mild morning air held them gently behind him as he went about his business '
  + 'and the sea was a great sweet mother scrotumtightening and grey beneath the bowl of the sky ').split(/\s+/)

const proseDocument = (targetChars) => {
  const paragraphs = []
  let total = 0
  let seed = 7
  const next = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648 }
  let index = 0
  while (total < targetChars) {
    const words = []
    const length = 90 + Math.floor(next() * 130)
    for (let i = 0; i < length; i += 1) words.push(WORDS[Math.floor(next() * WORDS.length)])
    const paragraph = words.join(' ')
    if (index % 12 === 0) paragraphs.push(`## Episode ${Math.floor(index / 12) + 1}`)
    paragraphs.push(paragraph)
    total += paragraph.length + 2
    index += 1
  }
  return `# Ulysses\n\n${paragraphs.join('\n\n')}\n`
}

const startSampling = (page) => page.evaluate(() => {
  const scroller = document.querySelector('.cm-scroller')
  window.__samples = []
  window.__sampling = true
  const tick = () => {
    if (!window.__sampling) return
    const caret = document.querySelector('.cm-cursor, .cm6-block-caret, .thockdown-block-caret')
    const sRect = scroller.getBoundingClientRect()
    const cRect = caret ? caret.getBoundingClientRect() : null
    window.__samples.push({
      t: Math.round(performance.now()),
      top: Math.round(scroller.scrollTop),
      caret: cRect && sRect.height ? Number(((cRect.top - sRect.top) / sRect.height).toFixed(3)) : null,
      hasCaret: !!caret,
    })
    requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
})

const stopSampling = (page) => page.evaluate(() => {
  window.__sampling = false
  return window.__samples
})

const KEYS = {
  down: { code: 40, key: 'ArrowDown' },
  // Travelling UP is the interesting direction: a heightmap correction for
  // newly-measured lines ABOVE the viewport moves what is on screen, where the
  // same correction below it does not.
  up: { code: 38, key: 'ArrowUp' },
}

const hold = async (client, ms, gapMs, direction) => {
  const { code, key } = KEYS[direction]
  const until = Date.now() + ms
  let first = true
  while (Date.now() < until) {
    await client.send('Input.dispatchKeyEvent', {
      type: 'rawKeyDown', windowsVirtualKeyCode: code, nativeVirtualKeyCode: code,
      key, code: key, autoRepeat: !first,
    })
    first = false
    await new Promise((r) => setTimeout(r, gapMs))
  }
  await client.send('Input.dispatchKeyEvent', {
    type: 'keyUp', windowsVirtualKeyCode: code, nativeVirtualKeyCode: code, key, code: key,
  })
}

const report = (label, samples, lineHeightPx, direction) => {
  const lh = lineHeightPx || 26
  const deltas = []
  for (let i = 1; i < samples.length; i += 1) deltas.push(samples[i].top - samples[i - 1].top)
  const sign = direction === 'up' ? -1 : 1
  const backwards = deltas.filter((d) => d * sign < -2)
  const bigJumps = deltas.filter((d) => Math.abs(d) > lh * 2)
  const carets = samples.map((s) => s.caret).filter((v) => v !== null)
  // Once travelling, the caret should PIN near one edge. Wandering back
  // toward the middle is the reported "snaps back to mid viewport".
  const settled = carets.slice(Math.floor(carets.length / 3))
  const spread = settled.length ? Math.max(...settled) - Math.min(...settled) : 0
  console.log(`\n${label}`)
  console.log(`   frames=${samples.length}  travelled=${samples.length ? samples[samples.length - 1].top - samples[0].top : 0}px`)
  console.log(`   AGAINST-TRAVEL frames: ${backwards.length}${backwards.length ? ` (worst ${backwards.reduce((a, b) => (Math.abs(b) > Math.abs(a) ? b : a), 0)}px)` : ''}`)
  const worstJump = bigJumps.reduce((a, b) => (Math.abs(b) > Math.abs(a) ? b : a), 0)
  console.log(`   jumps over two rows: ${bigJumps.length}${bigJumps.length ? ` (worst ${worstJump}px = ${(Math.abs(worstJump) / lh).toFixed(1)} rows)` : ''}`)
  const sorted = deltas.map((d, i) => ({ d, i })).filter((x) => x.d !== 0).sort((a, b) => Math.abs(b.d) - Math.abs(a.d))
  console.log(`   largest scroll steps: ${sorted.slice(0, 8).map((x) => `${x.d}px/${(Math.abs(x.d) / lh).toFixed(1)}r`).join(', ')}`)
  const rowsMoved = deltas.filter((d) => d !== 0).map((d) => Math.abs(d) / lh)
  const overOneRow = rowsMoved.filter((r) => r > 1.4).length
  console.log(`   steps larger than 1.4 rows: ${overOneRow} of ${rowsMoved.length} moving frames`)
  const withCaret = samples.filter((x) => x.hasCaret).length
  console.log(`   caret samples: ${withCaret} of ${samples.length} frames had a caret element`)
  // INFORMATIONAL ONLY, and not a defect signal. The caret MOVES within the
  // viewport as it travels -- that is what caret travel is: it walks toward
  // the edge through the text, and only once it reaches the edge does the
  // text scroll instead. So spread here measures the feature, not a fault,
  // and it produced a convincing false positive (0.214 of the viewport, in
  // exactly the scenario under suspicion) while every scroll step below was
  // exactly one row. The scroll-step distribution is the metric that means
  // something; the caret is always correct within the text.
  console.log(`   caret rect drift (informational, lags the text): ${spread.toFixed(3)} of the viewport height`)
  // Only the SETTLED window: the first stretch is the caret legitimately
  // walking to the viewport edge before it pins, which is not the defect.
  const settledStart = Math.floor(carets.length / 3)
  const caretJumps = []
  for (let i = settledStart + 1; i < carets.length; i += 1) {
    const d = carets[i] - carets[i - 1]
    if (Math.abs(d) > 0.03) caretJumps.push({ i, d: Number(d.toFixed(3)), from: carets[i - 1], to: carets[i] })
  }
  console.log(`   caret LURCHES after pinning (>3% of viewport in one frame): ${caretJumps.length}`)
  for (const j of caretJumps.slice(0, 8)) console.log(`      frame ${j.i}: ${j.from} -> ${j.to} (${j.d > 0 ? '+' : ''}${j.d})`)
}

const main = async () => {
  const server = await startDevServer(PORT)
  const browser = await chromium.launch()
  const width = numeric('width', 1280)
  const height = numeric('height', 900)
  const holdMs = numeric('hold', 14000)
  const page = await browser.newPage({ viewport: { width, height } })
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)))
  try {
    const text = args.file
      ? fs.readFileSync(args.file, 'utf8')
      : proseDocument(numeric('chars', 1500000))
    console.log(`document: ${args.file ? args.file : 'generated prose'} -- ${text.length.toLocaleString()} chars`)
    console.log(`window: ${width}x${height}${args.font ? `  editor font: ${numeric('font', 0)}px` : ''}  hold: ${holdMs}ms`)

    await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load' })
    await waitForAppReady(page)
    const client = await page.context().newCDPSession(page)
    await page.evaluate(async ({ initialText, fontSize }) => {
      const n = await window.thockdownNotes.createNote({ initialText })
      await window.thockdownSections.setActiveNote('default', n.id)
      if (fontSize) {
        const state = await window.thockdownState.loadAppState()
        await window.thockdownState.saveAppState({
          ...state,
          menu: { ...(state.menu ?? {}), editorFontSize: fontSize },
        })
      }
    }, { initialText: text, fontSize: args.font ? numeric('font', 0) : 0 })
    await page.reload()
    await waitForAppReady(page)
    await ensureEditMode(page)
    await page.waitForTimeout(9000)

    const lineHeightPx = await page.evaluate(() => Math.round(
      parseFloat(getComputedStyle(document.querySelector('.cm-line') || document.querySelector('.cm-scroller')).lineHeight) || 26))

    console.log(`measured line height: ${lineHeightPx}px`)

    const clickTrack = async (ratio) => {
      const box = await page.locator('.thockdown-scroll-track').boundingBox()
      await page.mouse.click(box.x + box.width / 2, box.y + box.height * ratio, { delay: 0 })
      await page.waitForTimeout(6000)
    }
    const clickText = async () => {
      const p = await page.evaluate(() => {
        const el = document.querySelector('.cm-scroller')
        const r = el.getBoundingClientRect()
        return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height * 0.35) }
      })
      await page.mouse.click(p.x, p.y, { delay: 80 })
      await page.waitForTimeout(900)
    }

    for (const direction of ['down', 'up']) {
      await clickTrack(0.45)
      await clickText()
      await startSampling(page)
      await hold(client, holdMs, 28, direction)
      report(`A. settled document, held Arrow${direction === 'up' ? 'Up' : 'Down'}`, await stopSampling(page), lineHeightPx, direction)
    }

    await page.setViewportSize({ width: Math.max(600, Math.round(width * 0.7)), height: Math.max(420, Math.round(height * 0.7)) })
    await page.waitForTimeout(3000)
    for (const direction of ['down', 'up']) {
      await clickTrack(0.72)
      await clickText()
      await startSampling(page)
      await hold(client, holdMs, 28, direction)
      report(`B. after resize + jump, held Arrow${direction === 'up' ? 'Up' : 'Down'}`, await stopSampling(page), lineHeightPx, direction)
    }

    console.log(`\npage errors: ${errors.length ? errors.join(' | ') : 'none'}`)
  } finally { await browser.close(); server.stop() }
}
main().catch((e) => { console.error(e); process.exit(1) })
