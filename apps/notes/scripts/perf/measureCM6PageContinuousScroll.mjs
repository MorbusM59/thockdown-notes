#!/usr/bin/env node
// Monitors CM6's PageUp/PageDown *held/continuous* scroll (runPageContinuousScroll
// in CM6Editor.tsx) for anomalies while the key is held down. Unlike a single
// discrete PageDown press (verified elsewhere to land with exact,
// zero-variance precision, because scrollToQuantizedSmooth's animation
// always forces an exact final write on its last frame), the held/continuous
// path writes scrollTop raw, every animation frame, computed as
// `scroller.scrollTop + direction*speed*deltaSec` -- i.e. each frame's
// target is based on whatever scrollTop currently reads, with no
// independent absolute reference and no forced-exact-final-step. That's the
// same risk shape as this investigation's failed ArrowUp fix attempts, just
// pre-existing in shipped code and firing far more often (every frame of a
// multi-second hold, not once per keystroke).
//
// Since PageUp/PageDown doesn't move the caret (pure viewport scroll, no
// analytical lineBlockAt reference available), this uses the same detection
// principle as the very first ArrowUp repro
// (verifyCM6ArrowUpChunkBoundary.mjs): sample scrollTop at a fine interval
// during a continuous, monotonic hold and flag any sample-to-sample delta
// that either reverses sign (impossible during a real, physically continuous
// hold in one direction) or exceeds a generous, empirically-calibrated
// per-sample-interval speed ceiling.
//
// Run: node scripts/perf/measureCM6PageContinuousScroll.mjs --chars=500000 --holdMs=4000 [--port=N]

import { chromium } from 'playwright'
import { existsSync, readdirSync } from 'node:fs'
import path from 'node:path'
import {
  startDevServer,
  seedLargeNoteAndReload,
  placeCaretAt,
} from './perfHarness.mjs'

function generateUniformDocument(targetChars) {
  const lines = []
  let total = 0
  let i = 0
  while (total < targetChars) {
    const line = `Line ${i}: plain uniform content, short enough not to wrap in an 1280px-wide editor.`
    lines.push(line)
    total += line.length + 1
    i += 1
  }
  return lines.join('\n')
}

function resolveChromiumExecutablePath() {
  const browsersRoot = process.env.PLAYWRIGHT_BROWSERS_PATH
  if (!browsersRoot || !existsSync(browsersRoot)) return undefined
  const chromiumDir = readdirSync(browsersRoot).find((name) => name.startsWith('chromium-'))
  if (!chromiumDir) return undefined
  const candidates = [
    path.join(browsersRoot, chromiumDir, 'chrome-linux', 'chrome'),
    path.join(browsersRoot, chromiumDir, 'chrome-win', 'chrome.exe'),
  ]
  return candidates.find((c) => existsSync(c))
}

function parseArgs(argv) {
  const args = { chars: 500_000, holdMs: 4000, port: 5187, sampleMs: 30, direction: 'PageUp', mode: 'key' }
  for (const raw of argv) {
    const [key, value] = raw.replace(/^--/, '').split('=')
    if (key === 'chars') args.chars = Number(value)
    else if (key === 'holdMs') args.holdMs = Number(value)
    else if (key === 'port') args.port = Number(value)
    else if (key === 'sampleMs') args.sampleMs = Number(value)
    else if (key === 'direction') args.direction = value
    else if (key === 'mode') args.mode = value
  }
  return args
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  console.error(`[page-continuous] starting dev server on port ${args.port}...`)
  const server = await startDevServer(args.port)

  let browser
  try {
    browser = await chromium.launch({ headless: true, executablePath: resolveChromiumExecutablePath() })
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
    await page.goto(`http://localhost:${args.port}/`)

    console.error(`[page-continuous] generating uniform document (~${args.chars} chars)...`)
    const text = generateUniformDocument(args.chars)
    console.error('[page-continuous] seeding note and reloading...')
    await seedLargeNoteAndReload(page, text)

    console.error('[page-continuous] placing caret at end...')
    await placeCaretAt(page, 'end')

    // Sample continuously in the page context via rAF, buffered to an array,
    // read back after the hold -- far tighter sampling than round-tripping
    // through Playwright's evaluate() per sample would allow.
    await page.evaluate(() => {
      window.__thockdownScrollSamples = []
      const scroller = document.querySelector('.cm-scroller')
      const tick = () => {
        window.__thockdownScrollSamples.push({ t: performance.now(), scrollTop: scroller.scrollTop })
        if (window.__thockdownScrollSamplingActive) requestAnimationFrame(tick)
      }
      window.__thockdownScrollSamplingActive = true
      requestAnimationFrame(tick)
    })

    if (args.mode === 'wheel') {
      console.error(`[page-continuous] sending sustained wheel events for ${args.holdMs}ms...`)
      const scroller = await page.$('.cm-scroller')
      const box = await scroller.boundingBox()
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
      const wheelDirection = args.direction === 'PageUp' ? -1 : 1
      const startTs = Date.now()
      // Trackpad-like: many small deltaY events in quick succession, not
      // DOM_DELTA_LINE/PAGE -- matches handleWheel's pendingWheelPx
      // accumulation branch, the realistic continuous-scroll case.
      while (Date.now() - startTs < args.holdMs) {
        await page.mouse.wheel(0, wheelDirection * 400)
        await page.waitForTimeout(16)
      }
    } else {
      console.error(`[page-continuous] holding ${args.direction} for ${args.holdMs}ms...`)
      await page.keyboard.down(args.direction)
      await page.waitForTimeout(args.holdMs)
      await page.keyboard.up(args.direction)
    }
    // Keep sampling through release ramp-down settle.
    await page.waitForTimeout(1200)
    await page.evaluate(() => { window.__thockdownScrollSamplingActive = false })
    await page.waitForTimeout(50)

    const samples = await page.evaluate(() => window.__thockdownScrollSamples)
    console.log(JSON.stringify({ chars: args.chars, holdMs: args.holdMs, direction: args.direction, samples }))
  } finally {
    server.stop()
    if (browser) await browser.close()
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
