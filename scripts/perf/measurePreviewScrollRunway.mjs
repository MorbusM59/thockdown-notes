#!/usr/bin/env node
// Step 1 of the windowed-preview investigation: measure the two numbers that
// decide whether a bounded runway can replace the whole-document height model.
//
//   DRAIN  -- how fast a held PageDown actually consumes content, in px/s and
//             in blocks/s, at the continuous-scroll speed the app really uses
//             (usePreviewScrollbar.ts's startPreviewContinuousScroll, which is
//             1.5x the apex speed of a one-page journey -- NOT the 80,000px/s
//             peak, which only a bridged journey ever reaches).
//   REFILL -- how long it takes, cold, for a fresh screenful of blocks to be
//             mounted and settled after the scroller lands somewhere new.
//             This is the window-swap cost under another name.
//
// Runway depth is then DRAIN x REFILL: how much already-mounted content has to
// sit ahead of the reader for the next window to be ready before they reach
// the edge of the current one. Both terms are constants; neither scales with
// the document, which is the whole claim being tested.
//
// Which strategy the document under test gets follows from its length alone:
// over CONTINUOUS_DOCUMENT_MAX_CHARS (50,000) it is windowed, under it the
// whole document is measured and scrolled as one piece. These numbers were
// what sized the runway in the first place, taken while the old chunked
// virtualizer still existed to compare against; re-running them now measures
// the windowed path itself.
//
// Run:
//   node scripts/perf/measurePreviewScrollRunway.mjs --chars=500000 --throttle=6

import { chromium } from 'playwright'
import { existsSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { startDevServer, seedLargeNoteAndReload, placeCaretAt } from './perfHarness.mjs'

// Blank-line separated, so remark yields many small top-level blocks rather
// than one giant paragraph -- the many-blocks case is what virtualization and
// therefore refill cost is actually about.
function generateUniformParagraphDocument(targetChars) {
  const paragraphs = []
  let total = 0
  let i = 0
  while (total < targetChars) {
    const paragraph = `Paragraph ${i}: plain uniform content for this preview block, short enough not to wrap awkwardly in a normal preview column width.`
    paragraphs.push(paragraph)
    total += paragraph.length + 2
    i += 1
  }
  return paragraphs.join('\n\n')
}

function resolveChromiumExecutablePath() {
  const browsersRoot = process.env.PLAYWRIGHT_BROWSERS_PATH
  if (!browsersRoot || !existsSync(browsersRoot)) return undefined
  const chromiumDir = readdirSync(browsersRoot).find((name) => name.startsWith('chromium-'))
  if (!chromiumDir) return undefined
  return [
    path.join(browsersRoot, chromiumDir, 'chrome-linux', 'chrome'),
    path.join(browsersRoot, chromiumDir, 'chrome-win', 'chrome.exe'),
  ].find((c) => existsSync(c))
}

function parseArgs(argv) {
  const args = { chars: 500_000, holdMs: 4000, throttle: 1, port: 5191, probes: 8, json: false, headed: false }
  for (const raw of argv) {
    const [key, value] = raw.replace(/^--/, '').split('=')
    if (key === 'json') args.json = true
    else if (key === 'headed') args.headed = true
    else if (key in args) args[key] = Number(value)
  }
  return args
}

const quantile = (sorted, q) => {
  if (sorted.length === 0) return null
  const pos = (sorted.length - 1) * q
  const lo = Math.floor(pos)
  const hi = Math.ceil(pos)
  return lo === hi ? sorted[lo] : sorted[lo] + ((sorted[hi] - sorted[lo]) * (pos - lo))
}
const summarize = (values) => {
  const sorted = [...values].sort((a, b) => a - b)
  return {
    n: sorted.length,
    min: sorted[0] ?? null,
    median: quantile(sorted, 0.5),
    p95: quantile(sorted, 0.95),
    max: sorted[sorted.length - 1] ?? null,
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  console.error(`[runway] dev server on :${args.port}`)
  const server = await startDevServer(args.port)

  let browser
  try {
    browser = await chromium.launch({ headless: !args.headed, executablePath: resolveChromiumExecutablePath() })
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })

    await page.goto(`http://localhost:${args.port}/`)
    console.error(`[runway] seeding ~${args.chars} chars`)
    await seedLargeNoteAndReload(page, generateUniformParagraphDocument(args.chars))
    await placeCaretAt(page, 'start')
    await page.keyboard.press('Escape')
    await page.waitForSelector('.markdown-preview', { timeout: 10000 })
    await page.waitForTimeout(800)

    const cdp = await page.context().newCDPSession(page)
    if (args.throttle > 1) {
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: args.throttle })
      console.error(`[runway] CPU throttled ${args.throttle}x`)
    }

    // Shared in-page helpers.
    await page.evaluate(() => {
      window.__runway = {
        scroller: () => document.querySelector('.markdown-preview'),
        mounted: () => {
          const nodes = document.querySelectorAll('.markdown-preview [data-index]')
          if (nodes.length === 0) return { first: null, last: null, count: 0 }
          let first = Infinity
          let last = -Infinity
          nodes.forEach((n) => {
            const i = Number(n.getAttribute('data-index'))
            if (i < first) first = i
            if (i > last) last = i
          })
          return { first, last, count: nodes.length }
        },
      }
    })

    // ---- Phase A: drain -------------------------------------------------
    console.error(`[runway] phase A: holding PageDown for ${args.holdMs}ms`)
    await page.evaluate(() => {
      window.__runwaySamples = []
      window.__runwaySampling = true
      const tick = () => {
        const s = window.__runway.scroller()
        const m = window.__runway.mounted()
        window.__runwaySamples.push({ t: performance.now(), scrollTop: s ? s.scrollTop : null, first: m.first, last: m.last, count: m.count })
        if (window.__runwaySampling) requestAnimationFrame(tick)
      }
      requestAnimationFrame(tick)
    })
    await page.keyboard.down('PageDown')
    await page.waitForTimeout(args.holdMs)
    await page.keyboard.up('PageDown')
    await page.waitForTimeout(600)
    await page.evaluate(() => { window.__runwaySampling = false })
    await page.waitForTimeout(80)

    const geometry = await page.evaluate(() => {
      const s = window.__runway.scroller()
      return { clientHeight: s.clientHeight, scrollHeight: s.scrollHeight, mountedNow: document.querySelectorAll('.markdown-preview [data-index]').length }
    })
    const samples = await page.evaluate(() => window.__runwaySamples)

    // Steady state only: drop the ramp-up at the head and the release ramp at
    // the tail, which are not the sustained rate this is measuring.
    const moving = samples.filter((s) => s.scrollTop !== null)
    const head = Math.floor(moving.length * 0.25)
    const tail = Math.floor(moving.length * 0.8)
    const steady = moving.slice(head, tail)
    const framePx = []
    const frameMs = []
    const blockAdvance = []
    for (let i = 1; i < steady.length; i += 1) {
      framePx.push(Math.abs(steady[i].scrollTop - steady[i - 1].scrollTop))
      frameMs.push(steady[i].t - steady[i - 1].t)
      if (steady[i].last !== null && steady[i - 1].last !== null) blockAdvance.push(Math.abs(steady[i].last - steady[i - 1].last))
    }
    const spanMs = steady.length > 1 ? steady[steady.length - 1].t - steady[0].t : 0
    const spanPx = steady.length > 1 ? Math.abs(steady[steady.length - 1].scrollTop - steady[0].scrollTop) : 0
    const spanBlocks = steady.length > 1 && steady[0].last !== null ? Math.abs(steady[steady.length - 1].last - steady[0].last) : 0
    const drainPxPerSec = spanMs > 0 ? (spanPx / spanMs) * 1000 : 0
    const drainBlocksPerSec = spanMs > 0 ? (spanBlocks / spanMs) * 1000 : 0

    // ---- Phase B: cold refill -------------------------------------------
    console.error(`[runway] phase B: ${args.probes} cold-mount probes`)
    const refills = await page.evaluate(async (probes) => {
      const scroller = window.__runway.scroller()
      const results = []
      const settleAfterJump = () => new Promise((resolve) => {
        const startedAt = performance.now()
        let stableFrames = 0
        let previous = null
        let frames = 0
        // The answer is when the mounted set LAST CHANGED, not when three
        // further frames confirmed it had stopped. Confirmation costs three
        // frame intervals, which is ~50ms unthrottled and ~300ms at 6x -- big
        // enough to swamp the quantity being measured if it were counted in.
        let lastChangeAt = startedAt
        const step = () => {
          frames += 1
          const m = window.__runway.mounted()
          const signature = `${m.first}|${m.last}|${m.count}`
          if (previous !== null && signature === previous) stableFrames += 1
          else { stableFrames = 0; lastChangeAt = performance.now() }
          previous = signature
          if (stableFrames >= 3) { resolve({ ms: lastChangeAt - startedAt, confirmedMs: performance.now() - startedAt, frames, mounted: m.count }); return }
          if (performance.now() - startedAt > 5000) { resolve({ ms: lastChangeAt - startedAt, confirmedMs: performance.now() - startedAt, frames, mounted: m.count, timedOut: true }); return }
          requestAnimationFrame(step)
        }
        requestAnimationFrame(step)
      })

      for (let i = 0; i < probes; i += 1) {
        // Somewhere nobody has been: spread across the document, never
        // repeating a position, so nothing is served from a warm mount.
        const fraction = 0.08 + ((i / probes) * 0.84)
        const target = Math.round((scroller.scrollHeight - scroller.clientHeight) * fraction)
        const previousBehavior = scroller.style.scrollBehavior
        scroller.style.scrollBehavior = 'auto'
        scroller.scrollTop = target
        scroller.style.scrollBehavior = previousBehavior
        results.push(await settleAfterJump())
        await new Promise((r) => setTimeout(r, 250))
      }
      return results
    }, args.probes)

    if (args.throttle > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 })

    const refillMs = refills.map((r) => r.ms)
    const refill = summarize(refillMs)
    const runwayPx = drainPxPerSec * ((refill.p95 ?? 0) / 1000)

    const report = {
      config: { chars: args.chars, holdMs: args.holdMs, throttle: args.throttle, probes: args.probes },
      geometry,
      drain: {
        framesSampled: steady.length,
        fps: spanMs > 0 ? (steady.length / spanMs) * 1000 : 0,
        pxPerSec: drainPxPerSec,
        screenfulsPerSec: geometry.clientHeight > 0 ? drainPxPerSec / geometry.clientHeight : 0,
        blocksPerSec: drainBlocksPerSec,
        framePx: summarize(framePx),
        frameMs: summarize(frameMs),
        blockAdvancePerFrame: summarize(blockAdvance),
      },
      refill: { ...refill, timedOut: refills.filter((r) => r.timedOut).length, mountedPerScreenful: summarize(refills.map((r) => r.mounted)) },
      derived: {
        runwayPxAtP95Refill: runwayPx,
        runwayScreenfuls: geometry.clientHeight > 0 ? runwayPx / geometry.clientHeight : 0,
      },
    }

    if (args.json) { console.log(JSON.stringify(report, null, 2)); return }
    const f = (v, d = 1) => (v === null || v === undefined ? 'n/a' : Number(v).toFixed(d))
    console.log(`
=== preview scroll runway (throttle ${args.throttle}x, ${args.chars} chars) ===
document        ${args.chars} chars, viewport ${geometry.clientHeight}px, spacer ${geometry.scrollHeight}px

DRAIN (held PageDown, steady state)
  frame rate      ${f(report.drain.fps)} fps   (frame ${f(report.drain.frameMs.median)}ms median, ${f(report.drain.frameMs.p95)}ms p95)
  speed           ${f(report.drain.pxPerSec, 0)} px/s = ${f(report.drain.screenfulsPerSec, 2)} screenfuls/s
  per frame       ${f(report.drain.framePx.median)}px median, ${f(report.drain.framePx.p95)}px p95
  blocks          ${f(report.drain.blocksPerSec, 1)} blocks/s (${f(report.drain.blockAdvancePerFrame.median, 1)} median, ${f(report.drain.blockAdvancePerFrame.max, 0)} max per frame)

REFILL (cold jump -> mounted set stable)
  ${f(refill.median)}ms median, ${f(refill.p95)}ms p95, ${f(refill.max)}ms max  (n=${refill.n}, timeouts ${report.refill.timedOut})
  blocks mounted per screenful: ${f(report.refill.mountedPerScreenful.median, 0)}

RUNWAY REQUIRED = drain x refill(p95)
  ${f(runwayPx, 0)}px = ${f(report.derived.runwayScreenfuls, 2)} screenfuls ahead of the reader
`)
  } finally {
    server.stop()
    if (browser) await browser.close()
  }
}

main().catch((err) => { console.error(err); process.exit(1) })
