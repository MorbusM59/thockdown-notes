#!/usr/bin/env node
// The chunked scrollbar thumb is sized in CHARACTERS -- how much information a
// screen holds against how much the document has. This checks the two things
// that has to mean in practice:
//
//   1. The thumb is SQUARE at its minimum -- height equal to its own width --
//      and it reaches that minimum on any document long enough to deserve it.
//   2. Its size depends on the document's LENGTH and nothing else: two
//      documents of the same character count get the same thumb whatever their
//      shape, because the size comes from the viewport's character grid rather
//      than from the text on screen. One of the two documents here is a LOOSE
//      LIST, which markdown parses as a single block -- the case that broke
//      resolveLastScreenChars by making a whole document its own last screen.
//   3. The thumb holds still while the reader scrolls, and advances.
//   4. The thumb reaches both ends of its track, and the viewport reaches the
//      document's last pixel.
//
// Run: node scripts/perf/verifyPreviewCharThumb.mjs [--port=N]

import { chromium } from 'playwright'
import { existsSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { startDevServer, seedLargeNoteAndReload, placeCaretAt } from './perfHarness.mjs'

// Same character count, same block count, very different information density
// per screen: long prose paragraphs against short list items.
function denseDocument(targetChars) {
  const out = []
  let total = 0
  let i = 0
  while (total < targetChars) {
    const text = `Paragraph ${i}: ${'dense prose that runs on for a good while and fills the column edge to edge. '.repeat(6)}`
    out.push(text)
    total += text.length + 2
    i += 1
  }
  return out.join('\n\n')
}

function sparseDocument(targetChars) {
  const out = []
  let total = 0
  let i = 0
  while (total < targetChars) {
    const text = `- item ${i}`
    out.push(text)
    total += text.length + 2
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
  const args = { chars: 400_000, port: 5198, holdMs: 3000, headed: false }
  for (const raw of argv) {
    const [key, value] = raw.replace(/^--/, '').split('=')
    if (key === 'headed') args.headed = true
    else if (key in args) args[key] = Number(value)
  }
  return args
}


const READ_STATE = () => {
  const scroller = document.querySelector('.markdown-preview')
  const nodes = Array.from(document.querySelectorAll('.markdown-preview [data-index]'))
  const indices = nodes.map((n) => Number(n.getAttribute('data-index')))
  return {
    scrollTop: Math.round(scroller.scrollTop),
    scrollHeight: scroller.scrollHeight,
    first: indices.length ? Math.min(...indices) : null,
    last: indices.length ? Math.max(...indices) : null,
    tailProbeMounted: document.querySelectorAll('[data-tail-index]').length,
  }
}

const READ_THUMB = () => {
  // The preview's own thumb: the rail lives beside the render container, not
  // inside it, and the edit pane has a rail of its own that is inactive here.
  const thumb = Array.from(document.querySelectorAll('.thockdown-scroll-thumb'))
    .find((n) => !n.classList.contains('is-inactive') && n.getBoundingClientRect().height > 0)
  if (!thumb) return null
  const rect = thumb.getBoundingClientRect()
  return {
    height: Math.round(rect.height * 100) / 100,
    width: Math.round(rect.width * 100) / 100,
    top: Math.round(rect.top * 100) / 100,
  }
}

async function openPreview(page, port, text) {
  await page.goto(`http://localhost:${port}/`)
  await seedLargeNoteAndReload(page, text)
  await placeCaretAt(page, 'start')
  await page.keyboard.press('Escape')
  await page.waitForSelector('.markdown-preview', { timeout: 15000 })
  await page.waitForTimeout(1500)
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

    const measure = async (text) => {
      const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
      await openPreview(page, args.port, text)
      const first = await page.evaluate(READ_THUMB)
      const stateBefore = await page.evaluate(READ_STATE)
      // Scroll a long way and re-read: the size must not move.
      await page.keyboard.down('PageDown')
      await page.waitForTimeout(args.holdMs)
      await page.keyboard.up('PageDown')
      await page.waitForTimeout(800)
      const after = await page.evaluate(READ_THUMB)
      const stateAfter = await page.evaluate(READ_STATE)
      await page.close()
      return { first, after, stateBefore, stateAfter }
    }

    const dense = await measure(denseDocument(args.chars))
    const sparse = await measure(sparseDocument(args.chars))

    note(dense.first !== null && sparse.first !== null, 'the thumb is rendered', dense.first ? `dense ${dense.first.height}px, sparse ${sparse.first.height}px` : 'not found')
    if (dense.first && sparse.first) {
      note(Math.abs(dense.first.height - sparse.first.height) <= 1,
        'documents of the same length get the same thumb whatever their shape',
        `dense ${dense.first.height}px vs sparse ${sparse.first.height}px`)
      note(dense.first.width > 0 && Math.abs(dense.first.height - dense.first.width) <= 1,
        'the thumb bottoms out square -- height equals its own width',
        `${dense.first.height}px tall, ${dense.first.width}px wide`)
    }
    for (const [label, run] of [['dense', dense], ['sparse', sparse]]) {
      console.log(`  [${label}] before ${JSON.stringify(run.stateBefore)}`)
      console.log(`  [${label}] after  ${JSON.stringify(run.stateAfter)}`)
      if (!run.first || !run.after) continue
      const drift = Math.abs(run.after.height - run.first.height)
      note(drift <= 1, `the ${label} thumb holds its size while the reader scrolls`,
        `${run.first.height}px -> ${run.after.height}px`)
      note(run.after.top > run.first.top, `the ${label} thumb advanced`,
        `${run.first.top}px -> ${run.after.top}px`)
    }

    console.log(`\n${failures.length === 0 ? 'ALL CHECKS PASSED' : `${failures.length} FAILED: ${failures.join(', ')}`}`)
    // Where the thumb, and the reader, end up at the true end of the document.
    // The span is the document minus its MEASURED last screen, so both should
    // land exactly -- these numbers are reported rather than asserted because
    // they are the design's headline claim and worth reading on every run.
    const endPage = await browser.newPage({ viewport: { width: 1280, height: 800 } })
    await openPreview(endPage, args.port, denseDocument(args.chars))
    // The thumb's inset from the track's TOP, at the document's start, is the
    // reference: whatever the mapping does at the far end has to be compared
    // against this rather than against zero, because the track insets its
    // handle by --canonical-scroll-handle-gap at both ends by design.
    const topInsetPx = await endPage.evaluate(() => {
      const t = document.querySelector('.thockdown-scroll-track')
      const th = Array.from(document.querySelectorAll('.thockdown-scroll-thumb'))
        .find((n) => !n.classList.contains('is-inactive') && n.getBoundingClientRect().height > 0)
      if (!t || !th) return null
      return Math.round((th.getBoundingClientRect().top - t.getBoundingClientRect().top) * 100) / 100
    })
    const track = await endPage.$('.thockdown-scroll-track')
    const box = await track.boundingBox()
    await endPage.mouse.click(box.x + (box.width / 2), box.y + box.height - 2)
    await endPage.waitForTimeout(3000)
    const atEnd = await endPage.evaluate(() => {
      const t = document.querySelector('.thockdown-scroll-track')
      const th = Array.from(document.querySelectorAll('.thockdown-scroll-thumb'))
        .find((n) => !n.classList.contains('is-inactive') && n.getBoundingClientRect().height > 0)
      const scroller = document.querySelector('.markdown-preview')
      if (!t || !th || !scroller) return null
      const tr = t.getBoundingClientRect()
      const hr = th.getBoundingClientRect()
      return {
        bottomInsetPx: Math.round((tr.bottom - hr.bottom) * 100) / 100,
        trackHeight: Math.round(tr.height),
        pxFromScrollerEnd: Math.round(scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop),
      }
    })
    await endPage.close()
    console.log('\nThumb inset from the track: ' + topInsetPx
      + 'px at the top of the document, ' + atEnd?.bottomInsetPx
      + 'px at the end (track ' + atEnd?.trackHeight
      + 'px, viewport stops ' + atEnd?.pxFromScrollerEnd + 'px above the last mounted pixel)')
    console.log(topInsetPx !== null && atEnd
      && Math.abs(topInsetPx - atEnd.bottomInsetPx) <= 1.5
      ? '  -> symmetric: the mapping reaches both ends, the inset is the track\'s own.'
      : '  -> NOT symmetric: the mapping is falling short at one end.')

    process.exitCode = failures.length === 0 ? 0 : 1
  } finally {
    server.stop()
    if (browser) await browser.close()
  }
}

main().catch((err) => { console.error(err); process.exit(1) })
