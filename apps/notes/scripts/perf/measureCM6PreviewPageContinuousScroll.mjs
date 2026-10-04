#!/usr/bin/env node
// Same methodology as measureCM6PageContinuousScroll.mjs, applied to the
// PREVIEW/render-view pane instead of the CM6 edit pane. The preview pane
// has its own, structurally near-identical PageUp/PageDown continuous-scroll
// implementation (usePreviewScrollbar.ts's startPreviewContinuousScroll/
// startPreviewReleaseRampDown) writing scrollTop raw every animation frame,
// and virtualizes its content via @tanstack/react-virtual with a fixed
// estimateSize (56px) corrected by measureElement on real render -- the
// react-virtual-native version of the same "estimate vs. measured" pattern
// that causes CM6's own scroll-anchor compensation. This checks whether the
// preview pane shows the same class of live reversal/implausible-jump
// artifact the edit pane's held-PageUp/PageDown was confirmed to have, i.e.
// whether the earlier-observed scrollbar-thumb jitter reflects genuine
// viewport misplacement (not just cosmetic thumb lag, since the thumb is
// driven directly off this same scrollTop).
//
// Run: node scripts/perf/measureCM6PreviewPageContinuousScroll.mjs --chars=500000 --holdMs=4000 [--port=N]

import { chromium } from 'playwright'
import { existsSync, readdirSync } from 'node:fs'
import path from 'node:path'
import {
  startDevServer,
  seedLargeNoteAndReload,
  placeCaretAt,
} from './perfHarness.mjs'

// Blank-line-separated paragraphs, not consecutive lines -- markdown merges
// consecutive non-blank lines into a single paragraph block, which would
// leave the preview virtualizer with almost nothing to virtualize (confirmed
// live: a single giant block, not the many-small-blocks case this test
// exists to exercise).
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
  const candidates = [
    path.join(browsersRoot, chromiumDir, 'chrome-linux', 'chrome'),
    path.join(browsersRoot, chromiumDir, 'chrome-win', 'chrome.exe'),
  ]
  return candidates.find((c) => existsSync(c))
}

function parseArgs(argv) {
  const args = { chars: 500_000, holdMs: 4000, port: 5187, direction: 'PageDown' }
  for (const raw of argv) {
    const [key, value] = raw.replace(/^--/, '').split('=')
    if (key === 'chars') args.chars = Number(value)
    else if (key === 'holdMs') args.holdMs = Number(value)
    else if (key === 'port') args.port = Number(value)
    else if (key === 'direction') args.direction = value
  }
  return args
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  console.error(`[preview-continuous] starting dev server on port ${args.port}...`)
  const server = await startDevServer(args.port)

  let browser
  try {
    browser = await chromium.launch({ headless: true, executablePath: resolveChromiumExecutablePath() })
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
    await page.goto(`http://localhost:${args.port}/`)

    console.error(`[preview-continuous] generating uniform document (~${args.chars} chars)...`)
    const text = generateUniformParagraphDocument(args.chars)
    console.error('[preview-continuous] seeding note and reloading...')
    await seedLargeNoteAndReload(page, text)

    console.error('[preview-continuous] placing caret at start (so PageDown has room)...')
    await placeCaretAt(page, 'start')

    console.error('[preview-continuous] switching to preview/render mode (Escape)...')
    await page.keyboard.press('Escape')
    await page.waitForSelector('.markdown-preview', { timeout: 10000 })
    await page.waitForTimeout(500)

    await page.evaluate(() => {
      window.__thockdownScrollSamples = []
      const scroller = document.querySelector('.markdown-preview')
      const tick = () => {
        window.__thockdownScrollSamples.push({ t: performance.now(), scrollTop: scroller ? scroller.scrollTop : null })
        if (window.__thockdownScrollSamplingActive) requestAnimationFrame(tick)
      }
      window.__thockdownScrollSamplingActive = true
      requestAnimationFrame(tick)
    })

    console.error(`[preview-continuous] holding ${args.direction} for ${args.holdMs}ms...`)
    await page.keyboard.down(args.direction)
    await page.waitForTimeout(args.holdMs)
    await page.keyboard.up(args.direction)
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
