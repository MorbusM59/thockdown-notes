// Does the preview's scrollbar tell the truth, and how soon?
//
// Both halves matter and they trade against each other. Measuring every block
// gives a perfect answer eventually; a flat estimate gives a wrong answer
// instantly. This measures the two together:
//
//   * time to a settled scrollbar -- how long the reader spends with a
//     scrollbar that is still moving under them;
//   * the error of that settled scrollbar against ground truth, where ground
//     truth is the document's height once every block has really been
//     rendered and measured (walked here, a viewport at a time).
//
// Run it before and after a change to the height model or the survey. It is a
// measurement tool, not a test -- per docs/document-scale-performance-
// philosophy.md, live-browser numbers, not code reading.
//
// Usage: node scripts/perf/measurePreviewHeightModel.mjs [--chars=1500000] [--shape=dense|harness]

import { chromium } from 'playwright'
import { startDevServer, generateSyntheticDocument } from './perfHarness.mjs'

const PORT = 5205
const EXECUTABLE_PATH = process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined
const arg = (name, fallback) => Number((process.argv.find((a) => a.startsWith(`--${name}=`)) ?? `--${name}=${fallback}`).split('=')[1])
const chars = arg('chars', 1500000)
const shape = (process.argv.find((a) => a.startsWith('--shape=')) ?? '--shape=dense').split('=')[1]
// Slow hardware is where this feature is judged: the reporter's own machine
// took minutes where this container took seconds. 1 = no throttling.
const throttle = arg('throttle', 1)

/**
 * Blank-line-separated blocks of VARYING length -- the shape real prose has.
 *
 * The variation is the point. A generator that emits the same paragraph over
 * and over is a document the model can fit exactly, which flatters it: every
 * block lands at the same wrap point. Real paragraphs land anywhere between
 * two wrap points, and the error that leaves is what this is meant to expose.
 */
const generateDenseDocument = (targetChars) => {
  const words = 'the quick brown fox jumps over a lazy dog while several remarkably patient onlookers consider whether any of this was strictly necessary given how late it had become and how far they still had to walk'.split(' ')
  // Deterministic pseudo-random so runs are comparable.
  let seed = 1234567
  const random = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff
    return seed / 0x7fffffff
  }
  const sentence = (wordCount) => {
    const out = []
    for (let i = 0; i < wordCount; i += 1) out.push(words[Math.floor(random() * words.length)])
    return `${out.join(' ')}.`
  }

  const out = []
  let total = 0
  let i = 0
  while (total < targetChars) {
    const roll = random()
    let block
    if (roll < 0.08) block = `${'#'.repeat(1 + Math.floor(random() * 3))} ${sentence(2 + Math.floor(random() * 6))}`
    else if (roll < 0.18) {
      const items = 2 + Math.floor(random() * 5)
      block = Array.from({ length: items }, () => `- ${sentence(3 + Math.floor(random() * 14))}`).join('\n')
    } else if (roll < 0.24) block = `> ${sentence(5 + Math.floor(random() * 30))}`
    else block = sentence(8 + Math.floor(random() * 90))
    out.push(block, '')
    total += block.length + 2
    i += 1
  }
  return out.join('\n')
}

async function main() {
  const server = await startDevServer(PORT)
  const browser = await chromium.launch({ executablePath: EXECUTABLE_PATH })
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  try {
    await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load' })
    await page.waitForTimeout(2000)

    const cdp = await page.context().newCDPSession(page)
    if (throttle > 1) {
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: throttle })
      console.log(`CPU throttled ${throttle}x`)
    }

    const text = shape === 'dense' ? generateDenseDocument(chars) : generateSyntheticDocument(chars)
    console.log(`document: ${text.length} chars, shape=${shape}`)
    await page.evaluate(async (initialText) => {
      const note = await window.thockdownNotes.createNote({ initialText })
      await window.thockdownSections.setActiveNote('default', note.id)
    }, text)
    await page.reload()
    await page.waitForSelector('.markdown-preview', { timeout: 120000 })
    await page.waitForTimeout(400)

    const inPreview = await page.evaluate(() => !!document.querySelector('.editor-stage.is-preview-mode'))
    if (!inPreview) {
      await page.keyboard.press('Escape')
      await page.waitForTimeout(1200)
    }

    const settle = await page.evaluate(async () => {
      const scroller = document.querySelector('.markdown-preview')
      const spacer = scroller.querySelector(':scope > div[style*="height"]')
      const readSize = () => Math.round(parseFloat(spacer.style.height) || 0)
      const surveying = () => !!document.querySelector('[role="progressbar"][aria-label^="Measuring document"]')

      const startedAt = performance.now()
      let blocks = 0
      const bar = () => document.querySelector('[role="progressbar"][aria-label^="Measuring document"]')
      while (performance.now() - startedAt < 180000) {
        const el = bar()
        if (el) {
          const m = /(\d+) of (\d+)/.exec(el.getAttribute('aria-label') || '')
          if (m) blocks = Number(m[2])
        } else if (performance.now() - startedAt > 300) {
          break
        }
        await new Promise((r) => setTimeout(r, 50))
      }
      return {
        settledMs: Math.round(performance.now() - startedAt),
        stillSurveying: surveying(),
        blocksReported: blocks,
        settledTotalPx: readSize(),
      }
    })

    // Jump to the bottom on the settled estimate: the defect this whole
    // feature exists for. A scrollbar that is right lands at the end.
    const jump = await page.evaluate(async () => {
      const scroller = document.querySelector('.markdown-preview')
      scroller.style.scrollBehavior = 'auto'
      scroller.scrollTop = scroller.scrollHeight
      await new Promise((r) => setTimeout(r, 1200))
      const missPx = Math.round(scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop)
      scroller.scrollTop = 0
      await new Promise((r) => setTimeout(r, 300))
      return { missPx }
    })

    // Ground truth: walk the whole document so every block is really measured.
    const truth = await page.evaluate(async () => {
      const scroller = document.querySelector('.markdown-preview')
      const spacer = scroller.querySelector(':scope > div[style*="height"]')
      scroller.style.scrollBehavior = 'auto'
      const step = Math.round(scroller.clientHeight * 0.9)
      let hops = 0
      let changes = 0
      let biggestJump = 0
      let previous = Math.round(parseFloat(spacer.style.height) || 0)
      while (hops < 4000) {
        scroller.scrollTop = Math.min(scroller.scrollTop + step, scroller.scrollHeight)
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
        const size = Math.round(parseFloat(spacer.style.height) || 0)
        if (size !== previous) {
          changes += 1
          biggestJump = Math.max(biggestJump, Math.abs(size - previous))
          previous = size
        }
        hops += 1
        if (scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 2) break
      }
      return { hops, truePx: previous, totalSizeChanges: changes, biggestJumpPx: biggestJump }
    })

    const errorPct = truth.truePx > 0
      ? Math.round(((settle.settledTotalPx - truth.truePx) / truth.truePx) * 1000) / 10
      : 0

    console.log('')
    console.log('SUMMARY')
    console.log(`  blocks:                    ${settle.blocksReported}`)
    console.log(`  scrollbar settled after:   ${(settle.settledMs / 1000).toFixed(1)}s${settle.stillSurveying ? ' (STILL SURVEYING)' : ''}`)
    console.log(`  settled total size:        ${settle.settledTotalPx}px`)
    console.log(`  true total size:           ${truth.truePx}px (after walking ${truth.hops} viewports)`)
    console.log(`  settled estimate error:    ${errorPct}%`)
    console.log(`  jump-to-bottom missed by:  ${jump.missPx}px`)
    console.log(`  churn while walking:       ${truth.totalSizeChanges} size changes, biggest ${truth.biggestJumpPx}px`)

    // --- Typography change: everything re-wraps, so every height changes ---
    // The model has to be re-fitted; the point is that re-fitting is a
    // hundred-odd renders and not another full survey.
    const refit = await page.evaluate(async () => {
      const scroller = document.querySelector('.markdown-preview')
      scroller.scrollTop = 0
      await new Promise((r) => setTimeout(r, 400))
      const style = document.createElement('style')
      style.textContent = '.markdown-preview { font-size: 21px !important; line-height: 1.9 !important; }'
      document.head.appendChild(style)

      const startedAt = performance.now()
      const spacer = scroller.querySelector(':scope > div[style*="height"]')
      const before = Math.round(parseFloat(spacer.style.height) || 0)
      // Settled = the size stopped moving AND nothing is being measured.
      let last = before
      let stableSince = performance.now()
      while (performance.now() - startedAt < 120000) {
        await new Promise((r) => setTimeout(r, 100))
        const size = Math.round(parseFloat(spacer.style.height) || 0)
        const busy = !!document.querySelector('[data-prewarm-index]')
        if (size !== last || busy) { last = size; stableSince = performance.now() }
        else if (performance.now() - stableSince > 800) break
      }
      const settledMs = Math.round(stableSince - startedAt)

      scroller.style.scrollBehavior = 'auto'
      scroller.scrollTop = scroller.scrollHeight
      await new Promise((r) => setTimeout(r, 1500))
      const missPx = Math.round(scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop)
      return { settledMs, beforePx: before, afterPx: last, missPx }
    })
    console.log('')
    console.log(`  after a font/line-height change:`)
    console.log(`    re-settled after:        ${(refit.settledMs / 1000).toFixed(1)}s`)
    console.log(`    total size:              ${refit.beforePx}px -> ${refit.afterPx}px`)
    console.log(`    jump-to-bottom missed by: ${refit.missPx}px`)
  } finally {
    await browser.close()
    await server.stop()
  }
}

main().catch((err) => { console.error(err); process.exit(1) })
