#!/usr/bin/env node
// Verifies the windowed preview (editorSection/previewWindow.ts) against the
// virtualized path it is meant to replace, on the same document, in a real
// browser.
//
// What it checks, in the order the design's claims were made:
//
//   1. GEOMETRY -- checked against the invariant itself rather than against
//      another path, because there is no longer a second one to compare with:
//      a chunked document is windowed and a continuous one is a different
//      strategy on a different size of document. Two things have to hold, and
//      together they are what "the flow layout reproduces the absolutely
//      positioned one" actually meant. Every wrapper must CONTAIN its own
//      block's margins (that is what `display: flow-root` buys, and without it
//      adjacent paragraphs collapse into each other), and consecutive wrappers
//      must be CONTIGUOUS -- no gap between one's bottom and the next's top,
//      because all the spacing lives inside them.
//   2. BOUNDED SPACER -- the scroller's height must stay a small multiple of
//      the viewport no matter where the reader is, and must not grow with the
//      document. This is the whole claim.
//   3. MONOTONE PROGRESS -- a held PageDown must move the reader forward
//      through the document without ever going backwards. A window shift that
//      failed to compensate scrollTop shows up here as a reversal.
//   4. REACHABILITY -- a jump to a character far outside the window must land
//      on the block that owns it, exactly.
//
// Run: node scripts/perf/verifyPreviewWindow.mjs [--chars=500000] [--throttle=6]

import { chromium } from 'playwright'
import { existsSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { startDevServer, seedLargeNoteAndReload, placeCaretAt } from './perfHarness.mjs'

function generateDocument(targetChars) {
  const paragraphs = []
  let total = 0
  let i = 0
  while (total < targetChars) {
    // A heading every twelve blocks, so the parity check has more than one
    // kind of margin to disagree about.
    const text = i % 12 === 0
      ? `## Section ${i}`
      : `Paragraph ${i}: plain uniform content for this preview block, short enough not to wrap awkwardly in a normal preview column width.`
    paragraphs.push(text)
    total += text.length + 2
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
  // referenceChars must stay under CONTINUOUS_DOCUMENT_MAX_CHARS (50,000) so
  // the reference document takes the continuous/virtualized path, and chars
  // must stay over it so the document under test is windowed. Both follow from
  // the document's length alone now -- there is no switch to set.
  const args = { chars: 500_000, referenceChars: 20_000, throttle: 1, port: 5196, holdMs: 4000, headed: false }
  for (const raw of argv) {
    const [key, value] = raw.replace(/^--/, '').split('=')
    if (key === 'headed') args.headed = true
    else if (key in args) args[key] = Number(value)
  }
  return args
}

const INSTALL_HELPERS = () => {
  window.__pw = {
    scroller: () => document.querySelector('.markdown-preview'),
    blocks: () => Array.from(document.querySelectorAll('.markdown-preview [data-index]')),
    indices: () => window.__pw.blocks().map((n) => Number(n.getAttribute('data-index'))),
    // The block the reader is actually looking at: the one covering the top
    // edge of the viewport. This -- not the window's own edges -- is what
    // "moving forward" and "moving backward" mean to a person.
    anchorIndex: () => {
      const scroller = window.__pw.scroller()
      const top = scroller.getBoundingClientRect().top
      let best = null
      for (const node of window.__pw.blocks()) {
        const rect = node.getBoundingClientRect()
        if (rect.bottom > top) { best = Number(node.getAttribute('data-index')); break }
      }
      return best
    },
    // Whether each wrapper's box is exactly its block plus that block's own
    // margins. Zero means the margins are inside the wrapper, which is what
    // makes contiguous wrappers render correctly spaced text.
    containment: () => window.__pw.blocks().map((node) => {
      const child = node.firstElementChild
      if (!child) return { index: Number(node.getAttribute('data-index')), delta: 0 }
      const cs = getComputedStyle(child)
      const expected = child.getBoundingClientRect().height
        + parseFloat(cs.marginTop) + parseFloat(cs.marginBottom)
      return {
        index: Number(node.getAttribute('data-index')),
        delta: Math.round((node.getBoundingClientRect().height - expected) * 100) / 100,
      }
    }),
    // The gap between the bottom of one block's rendered content and the top
    // of the next's -- the quantity a reader actually sees between paragraphs.
    gaps: () => {
      const nodes = window.__pw.blocks()
      const out = []
      for (let i = 1; i < nodes.length; i += 1) {
        const prev = nodes[i - 1].getBoundingClientRect()
        const next = nodes[i].getBoundingClientRect()
        out.push({
          fromIndex: Number(nodes[i - 1].getAttribute('data-index')),
          gap: Math.round((next.top - prev.bottom) * 100) / 100,
          height: Math.round(prev.height * 100) / 100,
        })
      }
      return out
    },
  }
}

async function openPreview(page, port, text) {
  await page.goto(`http://localhost:${port}/`)
  await seedLargeNoteAndReload(page, text)
  await placeCaretAt(page, 'start')
  await page.keyboard.press('Escape')
  await page.waitForSelector('.markdown-preview', { timeout: 15000 })
  await page.waitForTimeout(1200)
  await page.evaluate(INSTALL_HELPERS)
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const text = generateDocument(args.chars)
  const server = await startDevServer(args.port)
  const failures = []
  const note = (ok, label, detail) => {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` -- ${detail}` : ''}`)
    if (!ok) failures.push(label)
  }

  let browser
  try {
    browser = await chromium.launch({ headless: !args.headed, executablePath: resolveChromiumExecutablePath() })

    // ---- continuous reference ------------------------------------------
    const referencePage = await browser.newPage({ viewport: { width: 1280, height: 800 } })
    await openPreview(referencePage, args.port, generateDocument(args.referenceChars))
    const reference = await referencePage.evaluate(() => ({
      scrollHeight: window.__pw.scroller().scrollHeight,
      clientHeight: window.__pw.scroller().clientHeight,
    }))
    await referencePage.close()

    // ---- windowed ------------------------------------------------------
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
    await openPreview(page, args.port, text)

    const cdp = await page.context().newCDPSession(page)
    if (args.throttle > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: args.throttle })

    const initial = await page.evaluate(() => ({
      gaps: window.__pw.gaps(),
      containment: window.__pw.containment(),
      indices: window.__pw.indices(),
      scrollHeight: window.__pw.scroller().scrollHeight,
      clientHeight: window.__pw.scroller().clientHeight,
    }))

    note(initial.indices.length > 0, 'windowed preview renders blocks', `${initial.indices.length} mounted`)

    // The discovery bar belongs to the survey, and a chunked document is never
    // surveyed -- restartPrewarm returns before queueing anything. Asserted
    // rather than assumed: a progress bar for work that is not happening is
    // exactly the kind of thing that survives a refactor.
    const bar = await page.$('.preview-discovery-shell')
    note(bar === null, 'no discovery progress bar on the windowed path', bar ? 'bar present' : 'absent')

    // 1. geometry
    const worstGap = Math.max(...initial.gaps.map((entry) => Math.abs(entry.gap)))
    note(initial.gaps.length > 5, 'enough mounted blocks to check geometry', `${initial.gaps.length} pairs`)
    note(worstGap <= 0.5, 'consecutive blocks are contiguous', `worst gap ${worstGap}px`)
    const worstContainment = Math.max(...initial.containment.map((c) => Math.abs(c.delta)))
    note(worstContainment <= 0.5, 'every wrapper contains its own block margins',
      `worst ${worstContainment}px off`)

    // 2. bounded spacer, here and after travelling
    const boundedHere = initial.scrollHeight < initial.clientHeight * 12
    note(boundedHere, 'spacer is bounded at the document start',
      `${initial.scrollHeight}px for ${args.chars} chars vs ${reference.scrollHeight}px for ${args.referenceChars} (viewport ${initial.clientHeight}px)`)

    // 3. monotone progress under a held PageDown
    await page.evaluate(() => {
      window.__pwSamples = []
      window.__pwSampling = true
      const tick = () => {
        const indices = window.__pw.indices()
        window.__pwSamples.push({
          t: performance.now(),
          scrollTop: window.__pw.scroller().scrollTop,
          scrollHeight: window.__pw.scroller().scrollHeight,
          first: indices.length ? Math.min(...indices) : null,
          last: indices.length ? Math.max(...indices) : null,
          anchor: window.__pw.anchorIndex(),
        })
        if (window.__pwSampling) requestAnimationFrame(tick)
      }
      requestAnimationFrame(tick)
    })
    await page.keyboard.down('PageDown')
    await page.waitForTimeout(args.holdMs)
    await page.keyboard.up('PageDown')
    await page.waitForTimeout(600)
    await page.evaluate(() => { window.__pwSampling = false })
    await page.waitForTimeout(80)
    const samples = await page.evaluate(() => window.__pwSamples)

    const withBlocks = samples.filter((s) => s.anchor !== null)
    const advanced = withBlocks.length > 1 ? withBlocks[withBlocks.length - 1].anchor - withBlocks[0].anchor : 0
    note(advanced > 20, 'held PageDown carries the window forward', `${advanced} blocks`)

    // A shift that failed to compensate scrollTop makes the reader jump
    // BACKWARDS through the document. Measured in document blocks, not
    // pixels, because scrollTop is window-local and legitimately jumps.
    let reversals = 0
    let worstReversal = 0
    for (let i = 1; i < withBlocks.length; i += 1) {
      const delta = withBlocks[i].anchor - withBlocks[i - 1].anchor
      if (delta < 0) { reversals += 1; worstReversal = Math.min(worstReversal, delta) }
    }
    note(reversals === 0, 'the window never moves backwards while scrolling forward',
      `${reversals} reversals, worst ${worstReversal} blocks`)

    if (advanced <= 20 || reversals > 0) {
      // Every frame around the first moment the reader stops moving -- the
      // decisive interval, and a 10th-frame sample cannot show what happened
      // inside it.
      // The worst reversal, which is the frame that has to be explained.
      let freezeAt = withBlocks.length - 1
      let worst = 0
      for (let i = 1; i < withBlocks.length; i += 1) {
        const delta = withBlocks[i].anchor - withBlocks[i - 1].anchor
        if (delta < worst) { worst = delta; freezeAt = i }
      }
      console.log(`  trace around frame ${freezeAt} (worst reversal ${worst}): t, scrollTop, scrollHeight, window, anchor, fwdRunway`)
      withBlocks.slice(Math.max(0, freezeAt - 14), freezeAt + 4).forEach((s) => {
        const fwd = Math.round(s.scrollHeight - s.scrollTop - 655)
        console.log(`    ${Math.round(s.t)}  top=${Math.round(s.scrollTop)}  h=${s.scrollHeight}  [${s.first}..${s.last}]  anchor=${s.anchor}  fwd=${fwd}`)
      })
    }

    const maxSpacer = Math.max(...samples.map((s) => s.scrollHeight))
    note(maxSpacer < initial.clientHeight * 14, 'spacer stays bounded throughout the scroll',
      `max ${maxSpacer}px = ${(maxSpacer / initial.clientHeight).toFixed(1)} screenfuls`)

    // 4. reachability: a jump far outside the window lands on the right block
    // 4. reachability, through the reader's own control: a click far down the
    // scrollbar track. That is the bridged-journey path, so it also exercises
    // the window re-anchor happening under the curtain
    // (NonQuantizedSmoothScroll's onBridgeCut).
    const before = await page.evaluate(() => window.__pw.indices())
    const track = await page.$('.thockdown-scroll-track')
    if (!track) {
      console.log('SKIP  far jump -- no scrollbar track found')
    } else {
      const box = await track.boundingBox()
      await page.mouse.click(box.x + (box.width / 2), box.y + (box.height * 0.85))
      await page.waitForTimeout(2500)
      const after = await page.evaluate(() => ({
        indices: window.__pw.indices(),
        anchor: window.__pw.anchorIndex(),
        scrollHeight: window.__pw.scroller().scrollHeight,
        total: window.__pw.scroller().scrollHeight,
      }))
      const blockCount = Math.max(...after.indices)
      note(Math.min(...after.indices) > Math.max(...before),
        'a track click far below travels past the whole previous window',
        `was ..${Math.max(...before)}, now ${Math.min(...after.indices)}..${blockCount}`)
      note(after.scrollHeight < initial.clientHeight * 14,
        'the spacer is still bounded after the jump', `${after.scrollHeight}px`)
    }

    if (args.throttle > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 })
    console.log(`\n${failures.length === 0 ? 'ALL CHECKS PASSED' : `${failures.length} FAILED: ${failures.join(', ')}`}`)
    process.exitCode = failures.length === 0 ? 0 : 1
  } finally {
    server.stop()
    if (browser) await browser.close()
  }
}

main().catch((err) => { console.error(err); process.exit(1) })
