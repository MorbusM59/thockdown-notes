#!/usr/bin/env node
// How far the caret trails the keystroke that moved it.
//
// The typing sound is dispatched inside the keydown handler (measured at
// ~+2.4ms via `thockdown:debug-input-lag`), so for the reader the sound IS the
// keystroke. The caret is React state (`caretStyle` in CM6Editor.tsx) written
// from a requestAnimationFrame callback, so it can only ever land a frame or
// more later -- and anything that delays that frame is heard as the caret
// lagging behind the click.
//
// This measures the gap the reader actually perceives:
//
//   * `moved`   -- keydown to the style mutation that repositions
//                  `.thockdown-block-caret`. The caret's new position exists
//                  in the DOM at this point.
//   * `painted` -- keydown to the frame after that mutation was committed.
//                  What the eye can see.
//
// Reported per position, because "especially at the beginning" is a claim
// about where in the document the caret is, and a cost that varies with
// position is a different bug from one that does not.
import { chromium } from 'playwright'
import { existsSync, readdirSync } from 'node:fs'
import path from 'node:path'
import {
  startDevServer,
  generateSyntheticDocument,
  seedLargeNoteAndReload,
  placeCaretAt,
  summarizeMs,
} from './perfHarness.mjs'

function parseArgs(argv) {
  const args = {
    chars: 400000, keystrokes: 15, port: 5193, key: 'Enter',
    positions: 'start,middle,end', throttle: 1, gap: 300, headed: false,
  }
  for (const raw of argv) {
    const [key, value] = raw.replace(/^--/, '').split('=')
    if (key === 'headed') args.headed = true
    else if (key === 'key') args.key = value
    else if (key === 'positions') args.positions = value
    else if (key === 'chars') args.chars = Number(value)
    else if (key === 'keystrokes') args.keystrokes = Number(value)
    else if (key === 'port') args.port = Number(value)
    else if (key === 'throttle') args.throttle = Number(value)
    else if (key === 'gap') args.gap = Number(value)
  }
  return args
}

function resolveChromiumExecutable() {
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH
  if (!root || !existsSync(root)) return undefined
  const dir = readdirSync(root).find((n) => n.startsWith('chromium-') && !n.includes('headless'))
  if (!dir) return undefined
  for (const rel of [['chrome-win', 'chrome.exe'], ['chrome-linux', 'chrome'], ['chrome-mac', 'Chromium.app', 'Contents', 'MacOS', 'Chromium']]) {
    const candidate = path.join(root, dir, ...rel)
    if (existsSync(candidate)) return candidate
  }
  return undefined
}

const INSTRUMENT = () => {
  const state = { samples: [], pending: null }
  window.__caretLatency = state

  // Subtree observer on the whole editor layer rather than on the caret
  // element itself: the caret is conditionally rendered, so it can be
  // replaced outright and an observer bound to one node would go deaf.
  // document.body, deliberately: the caret is conditionally rendered inside a
  // layer this script should not have to know the shape of, and a narrower
  // host that guesses wrong observes nothing at all rather than failing
  // loudly. The filter below is what keeps this cheap.
  const host = document.body
  const observer = new MutationObserver((records) => {
    const pending = state.pending
    if (!pending || pending.moved !== null) return
    for (const record of records) {
      const target = record.target
      const isCaret = target instanceof Element && target.classList?.contains('thockdown-block-caret')
      const addedCaret = [...record.addedNodes].some(
        (node) => node instanceof Element && node.classList?.contains('thockdown-block-caret'),
      )
      if (!isCaret && !addedCaret) continue
      pending.moved = performance.now() - pending.t0
      requestAnimationFrame(() => {
        pending.painted = performance.now() - pending.t0
        state.samples.push(pending)
        if (state.pending === pending) state.pending = null
      })
      return
    }
  })
  observer.observe(host, { attributes: true, attributeFilter: ['style'], childList: true, subtree: true })

  window.addEventListener('keydown', () => {
    state.pending = { t0: performance.now(), moved: null, painted: null }
  }, true)
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const positions = args.positions.split(',').map((p) => p.trim()).filter(Boolean)
  const server = await startDevServer(args.port)
  const browser = await chromium.launch({ headless: !args.headed, executablePath: resolveChromiumExecutable() })
  try {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })
    await page.goto('http://localhost:' + args.port + '/', { waitUntil: 'domcontentloaded' })
    await seedLargeNoteAndReload(page, generateSyntheticDocument(args.chars))

    const client = await page.context().newCDPSession(page)
    if (args.throttle > 1) await client.send('Emulation.setCPUThrottlingRate', { rate: args.throttle })

    console.log('\nkey=' + args.key + ' chars=' + args.chars + ' keystrokes=' + args.keystrokes
      + ' throttle=' + args.throttle + 'x')

    for (const position of positions) {
      await placeCaretAt(page, position)
      await page.evaluate(INSTRUMENT)
      await page.waitForTimeout(300)

      for (let i = 0; i < args.keystrokes; i += 1) {
        await page.keyboard.press(args.key)
        await page.waitForTimeout(args.gap)
      }
      await page.waitForTimeout(400)

      const samples = await page.evaluate(() => window.__caretLatency.samples)
      const moved = samples.map((s) => s.moved).filter((v) => v !== null)
      const painted = samples.map((s) => s.painted).filter((v) => v !== null)
      const fmt = (label, values) => {
        if (!values.length) return '    ' + label + ': no samples'
        const s = summarizeMs(values)
        return '    ' + label + '  mean=' + s.mean.toFixed(1) + 'ms  median=' + s.median.toFixed(1)
          + 'ms  min=' + s.min.toFixed(1) + 'ms  max=' + s.max.toFixed(1) + 'ms'
      }
      console.log('\n  position=' + position + '  (' + samples.length + '/' + args.keystrokes + ' caret moves observed)')
      console.log(fmt('moved  ', moved))
      console.log(fmt('painted', painted))
      console.log('    per-keystroke painted: ' + painted.map((v) => v.toFixed(0)).join(', '))
    }
  } finally {
    await browser.close().catch(() => {})
    await server.stop()
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1 })
