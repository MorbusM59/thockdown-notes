#!/usr/bin/env node
// Where a click on the scrollbar track actually lands, and whether it stays
// there.
//
// Two reported symptoms on a large (windowed) note, both of which would show up
// here: the thumb readjusting AFTER a bridged jump has landed, and a click near
// the top of the track needing several repeats to reach the document's start
// instead of getting there once.
//
// Clicks the track at a fixed fraction several times over and records, for each
// one, where the reader ended up and where the thumb sat -- immediately after
// the journey, and again half a second later. A landing that is correct and
// final looks like the same numbers twice, and the same numbers on every repeat:
// the second click has nowhere left to travel. Then one more click at the very
// top of the track, which is the only click that means "the start".
//
// Run: node scripts/perf/verifyPreviewTrackLanding.mjs [--chars=400000] [--at=0.02]

import { chromium } from 'playwright'
import { existsSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { startDevServer, seedLargeNoteAndReload, placeCaretAt } from './perfHarness.mjs'

function generateDocument(targetChars) {
  const out = []
  let total = 0
  let i = 0
  while (total < targetChars) {
    const text = i % 12 === 0
      ? `## Section ${i}`
      : `Paragraph ${i}: plain uniform content for this preview block, short enough not to wrap awkwardly in a normal preview column width.`
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
  const args = { chars: 400_000, port: 5199, at: 0.02, repeats: 4, headed: false }
  for (const raw of argv) {
    const [key, value] = raw.replace(/^--/, '').split('=')
    if (key === 'headed') args.headed = true
    else if (key in args) args[key] = Number(value)
  }
  return args
}

const READ = () => {
  const scroller = document.querySelector('.markdown-preview')
  const nodes = Array.from(document.querySelectorAll('.markdown-preview [data-index]'))
  const indices = nodes.map((n) => Number(n.getAttribute('data-index')))
  const track = document.querySelector('.thockdown-scroll-track')
  const thumb = Array.from(document.querySelectorAll('.thockdown-scroll-thumb'))
    .find((n) => !n.classList.contains('is-inactive') && n.getBoundingClientRect().height > 0)
  // The block covering the top edge: what the reader is actually looking at.
  const top = scroller.getBoundingClientRect().top
  let anchor = null
  for (const node of nodes) {
    if (node.getBoundingClientRect().bottom > top) { anchor = Number(node.getAttribute('data-index')); break }
  }
  return {
    anchor,
    first: indices.length ? Math.min(...indices) : null,
    last: indices.length ? Math.max(...indices) : null,
    scrollTop: Math.round(scroller.scrollTop),
    thumbTop: thumb && track
      ? Math.round((thumb.getBoundingClientRect().top - track.getBoundingClientRect().top) * 100) / 100
      : null,
  }
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

    // Start well down the document so a click near the top is a long journey.
    await page.mouse.click(box.x + (box.width / 2), box.y + (box.height * 0.7))
    await page.waitForTimeout(2500)
    console.log(`  start:            ${JSON.stringify(await page.evaluate(READ))}`)

    const settled = []
    for (let i = 0; i < args.repeats; i += 1) {
      await page.mouse.click(box.x + (box.width / 2), box.y + (box.height * args.at))
      await page.waitForTimeout(1800)
      const landed = await page.evaluate(READ)
      await page.waitForTimeout(700)
      const after = await page.evaluate(READ)
      settled.push({ landed, after })
      console.log(`  click ${i + 1} landed:   ${JSON.stringify(landed)}`)
      console.log(`  click ${i + 1} +700ms:   ${JSON.stringify(after)}`)
    }

    // Sample the thumb every frame across a whole bridged journey. The band
    // stretches one edge to the destination, holds while the curtain covers the
    // cut, then brings the other edge up -- so its height rises and falls once
    // and must END at the resting size the sync settles on. A band drawn
    // against a different height than the sync's shows up here as a last frame
    // that disagrees with the one after it.
    //
    // The sampler is ARMED FIRST and the click comes after: starting it
    // afterwards catches only the aftermath, which is how this check first
    // reported a perfectly flat band.
    await page.evaluate(() => {
      const track = document.querySelector('.thockdown-scroll-track')
      window.__band = []
      window.__banding = true
      const tick = () => {
        const th = Array.from(document.querySelectorAll('.thockdown-scroll-thumb'))
          .find((n) => !n.classList.contains('is-inactive') && n.getBoundingClientRect().height > 0)
        if (th && track) {
          const r = th.getBoundingClientRect()
          const t = track.getBoundingClientRect()
          window.__band.push({
            top: Math.round((r.top - t.top) * 10) / 10,
            h: Math.round(r.height * 10) / 10,
          })
        }
        if (window.__banding) requestAnimationFrame(tick)
      }
      requestAnimationFrame(tick)
    })
    await page.mouse.click(box.x + (box.width / 2), box.y + (box.height * 0.75))
    await page.waitForTimeout(2200)
    await page.evaluate(() => { window.__banding = false })
    const band = await page.evaluate(() => window.__band)
    const heights = band.map((b) => b.h)
    const tops = band.map((b) => b.top)
    const resting = heights.length ? heights[heights.length - 1] : null
    console.log(`  band: ${band.length} frames, height ${Math.min(...heights)}..${Math.max(...heights)}px (resting ${resting}), top ${Math.min(...tops)}..${Math.max(...tops)}`)
    console.log(`  band peak frame: ${JSON.stringify(band[heights.indexOf(Math.max(...heights))])}`)
    console.log(`  band tail: ${JSON.stringify(band.slice(-4))}`)

    // The band stretches toward the thumb top the CLICK asked for, and the sync
    // then places the thumb where the reader actually ended up. If those two
    // disagree, the band visibly overshoots and snaps back -- which is exactly
    // what a reader reported. The click's own arithmetic is
    // `clickY - thumbHeight / 2`, clamped to the track.
    const geom = await page.evaluate(() => {
      const track = document.querySelector('.thockdown-scroll-track')
      const thumb = Array.from(document.querySelectorAll('.thockdown-scroll-thumb'))
        .find((n) => !n.classList.contains('is-inactive') && n.getBoundingClientRect().height > 0)
      return {
        trackHeight: track.clientHeight,
        thumbHeight: thumb.getBoundingClientRect().height,
        thumbTop: Math.round((thumb.getBoundingClientRect().top - track.getBoundingClientRect().top) * 10) / 10,
      }
    })
    const EDGE_GAP = 3
    const usable = geom.trackHeight - (EDGE_GAP * 2)
    const maxThumbTop = EDGE_GAP + Math.max(0, usable - geom.thumbHeight)
    const askedTop = Math.min(maxThumbTop, Math.max(EDGE_GAP, (band.length ? geom.trackHeight * 0.75 : 0) - (geom.thumbHeight / 2)))
    note(Math.abs(geom.thumbTop - askedTop) <= 3,
      'the thumb rests where the click asked, so the band does not snap back',
      `asked ${Math.round(askedTop)}px, rests at ${geom.thumbTop}px`)
    note(resting !== null && Math.abs(resting - geom.thumbHeight) <= 1,
      'the band ends at the thumb\'s resting size',
      `${resting}px`)

    // 1. A landing is final: nothing moves once the journey is over.
    const drifted = settled.filter((s) => s.landed.thumbTop !== null && s.after.thumbTop !== null
      && Math.abs(s.after.thumbTop - s.landed.thumbTop) > 1)
    note(drifted.length === 0, 'the thumb does not readjust after a journey lands',
      `${drifted.length} of ${settled.length} clicks drifted`)

    // 2. One click is enough: the second must not travel further than the first.
    const first = settled[0].after
    const last = settled[settled.length - 1].after
    note(first.anchor !== null && last.anchor !== null && Math.abs(first.anchor - last.anchor) <= 2,
      'one click reaches the destination, repeats do not creep further',
      `after click 1 at block ${first.anchor}, after click ${settled.length} at block ${last.anchor}`)

    // 3. The extreme, asked separately -- a click at `at` means `at` of the
    // document, which is NOT the top unless `at` is zero. Getting that wrong is
    // how this check first reported a correct landing as a failure.
    await page.mouse.click(box.x + (box.width / 2), box.y + 2)
    await page.waitForTimeout(2000)
    const atTop = await page.evaluate(READ)
    console.log(`  top of track:     ${JSON.stringify(atTop)}`)
    note(atTop.anchor !== null && atTop.anchor <= 2,
      'a click at the very top of the track reaches the start of the document',
      `block ${atTop.anchor}, scrollTop ${atTop.scrollTop}`)

    console.log(`\n${failures.length === 0 ? 'ALL CHECKS PASSED' : `${failures.length} FAILED: ${failures.join(', ')}`}`)
    process.exitCode = failures.length === 0 ? 0 : 1
  } finally {
    server.stop()
    if (browser) await browser.close()
  }
}

main().catch((err) => { console.error(err); process.exit(1) })
