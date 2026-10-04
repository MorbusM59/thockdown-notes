#!/usr/bin/env node
// Does the text hold still when nobody is touching it?
//
// A reported symptom on a large note: with no input at all, the text settles
// into TWO states about a line apart and flips between them. Not pixel
// vibration -- a genuine bistable oscillation, which is the signature of two
// mechanisms each undoing the other's correction.
//
// Parks the reader at several depths and, at each, samples every frame for a
// couple of seconds with no input whatsoever. A pane at rest produces exactly
// one distinct state. Anything more is reported with the states themselves, so
// the two ends of the oscillation can be read off directly.
//
// Run: node scripts/perf/verifyPreviewRestStability.mjs [--chars=400000]

import { chromium } from 'playwright'
import { existsSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { startDevServer, seedLargeNoteAndReload, placeCaretAt } from './perfHarness.mjs'

// Deliberately HETEROGENEOUS. The window sizes each of its growth and trim
// steps by dividing a pixel shortfall by the MEAN height of the blocks it has
// mounted -- so on a document whose blocks are all the same size that mean is
// exact and every step lands where it intended. A real note is not like that,
// and a mean taken over a run of one-line paragraphs is wildly wrong for the
// code fence that follows. Uniform prose could not reproduce the reported
// jitter; this is a model of a document that can.
const FENCE = '```'

function generateDocument(targetChars) {
  const out = []
  let total = 0
  let i = 0
  const push = (text) => { out.push(text); total += text.length + 2 }
  while (total < targetChars) {
    const shape = i % 9
    if (shape === 0) push(`## Section ${i}`)
    else if (shape === 1) {
      const code = Array.from({ length: 18 }, (_, k) => `const line${k} = ${k} // a line inside a tall fenced block`).join('\n')
      push(`${FENCE}\n${code}\n${FENCE}`)
    } else if (shape === 2) push('- one\n- two\n- three\n- four')
    else if (shape === 3) push('> A short quotation.')
    else if (shape === 4) push('Tiny.')
    else if (shape === 5) push(`Paragraph ${i}: ${'a much longer paragraph that wraps across several lines of the column and then keeps going for a while. '.repeat(4)}`)
    else push(`Paragraph ${i}: an ordinary line of prose in this document.`)
    i += 1
  }
  return out.join('\n\n')
}

function resolveChromiumExecutablePath() {
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH
  if (!root || !existsSync(root)) return undefined
  const dir = readdirSync(root).find((n) => n.startsWith('chromium-'))
  if (!dir) return undefined
  return [
    path.join(root, dir, 'chrome-linux', 'chrome'),
    path.join(root, dir, 'chrome-win', 'chrome.exe'),
  ].find((c) => existsSync(c))
}

function parseArgs(argv) {
  const args = { chars: 400_000, port: 5195, watchMs: 2000, headed: false }
  for (const raw of argv) {
    const [key, value] = raw.replace(/^--/, '').split('=')
    if (key === 'headed') args.headed = true
    else if (key in args) args[key] = Number(value)
  }
  return args
}

const WATCH = async (ms) => {
  const scroller = document.querySelector('.markdown-preview')
  const samples = []
  let running = true
  const tick = () => {
    const nodes = document.querySelectorAll('.markdown-preview [data-index]')
    let first = null
    let last = null
    nodes.forEach((n) => {
      const i = Number(n.getAttribute('data-index'))
      if (first === null || i < first) first = i
      if (last === null || i > last) last = i
    })
    // The text's own position on screen, which is what a reader sees move --
    // scrollTop alone is window-local and legitimately jumps when the window
    // shifts, so it cannot tell a real wobble from a bookkeeping one.
    const marker = document.querySelector('.markdown-preview [data-index]')
    samples.push({
      scrollTop: Math.round(scroller.scrollTop),
      first,
      last,
      markerIndex: marker ? Number(marker.getAttribute('data-index')) : null,
      markerTop: marker ? Math.round(marker.getBoundingClientRect().top * 10) / 10 : null,
    })
    if (running) requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
  await new Promise((r) => setTimeout(r, ms))
  running = false
  return samples
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const server = await startDevServer(args.port)
  const failures = []
  const note = (ok, label, detail) => {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` -- ${detail}` : ''}`)
    if (!ok) failures.push(label)
  }

  let browser
  try {
    browser = await chromium.launch({ headless: !args.headed, executablePath: resolveChromiumExecutablePath() })
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
    await page.goto(`http://localhost:${args.port}/`)
    await seedLargeNoteAndReload(page, generateDocument(args.chars))
    await placeCaretAt(page, 'start')
    await page.keyboard.press('Escape')
    await page.waitForSelector('.markdown-preview', { timeout: 15000 })
    await page.waitForTimeout(1500)

    const track = await page.$('.thockdown-scroll-track')
    const box = await track.boundingBox()

    // Wheel scrolling first: it mounts and unmounts blocks ABOVE the reader,
    // which is the case a track click never exercises -- the click re-anchors
    // to a fresh window instead of walking through one.
    await page.mouse.move(640, 400)
    for (const phase of ['wheel-down', 'wheel-up']) {
      const dy = phase === 'wheel-down' ? 400 : -400
      for (let i = 0; i < 12; i += 1) {
        await page.mouse.wheel(0, dy)
        await page.waitForTimeout(60)
      }
      await page.waitForTimeout(1200)
      const samples = await page.evaluate(WATCH, args.watchMs)
      const states = new Map()
      for (const s of samples) {
        const key = `${s.markerIndex}@${s.markerTop}`
        states.set(key, (states.get(key) ?? 0) + 1)
      }
      const distinct = [...states.entries()].sort((a, b) => b[1] - a[1])
      const windowStates = new Set(samples.map((s) => `${s.first}..${s.last}`))
      const ok = distinct.length === 1
      note(ok, `the text holds still after ${phase}`,
        `${distinct.length} distinct position(s) over ${samples.length} frames, ${windowStates.size} window state(s)`)
      if (!ok) {
        distinct.slice(0, 4).forEach(([key, count]) => console.log(`      ${key}  x${count}`))
        console.log(`      windows: ${[...windowStates].slice(0, 4).join(' | ')}`)
        console.log(`      scrollTops: ${[...new Set(samples.map((s) => s.scrollTop))].slice(0, 6).join(', ')}`)
      }
    }

    for (const at of [0.25, 0.5, 0.75]) {
      await page.mouse.click(box.x + (box.width / 2), box.y + (box.height * at))
      // Well past the journey and its settle, so nothing here is the landing.
      await page.waitForTimeout(2500)
      const samples = await page.evaluate(WATCH, args.watchMs)

      // The text's position on screen, keyed by which block is where. Two
      // distinct values alternating is the reported symptom.
      const states = new Map()
      for (const s of samples) {
        const key = `${s.markerIndex}@${s.markerTop}`
        states.set(key, (states.get(key) ?? 0) + 1)
      }
      const distinct = [...states.entries()].sort((a, b) => b[1] - a[1])
      const windowStates = new Set(samples.map((s) => `${s.first}..${s.last}`))

      const ok = distinct.length === 1
      note(ok, `the text holds still at ${Math.round(at * 100)}% with no input`,
        `${distinct.length} distinct position(s) over ${samples.length} frames, ${windowStates.size} window state(s)`)
      if (!ok) {
        distinct.slice(0, 4).forEach(([key, count]) => console.log(`      ${key}  x${count}`))
        console.log(`      windows: ${[...windowStates].slice(0, 4).join(' | ')}`)
      }
    }

    console.log(`\n${failures.length === 0 ? 'ALL CHECKS PASSED' : `${failures.length} FAILED: ${failures.join(', ')}`}`)
    process.exitCode = failures.length === 0 ? 0 : 1
  } finally {
    server.stop()
    if (browser) await browser.close()
  }
}

main().catch((err) => { console.error(err); process.exit(1) })
