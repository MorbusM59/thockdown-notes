#!/usr/bin/env node
// Live-browser regression check for docs/cm6-parity-hardening-plan.md's
// "Bug 8" (1px horizontal shift from click-dragging a selection past the
// editor's left/right edge). Root cause: .editor-text's glyph-centering
// `transform: translateX(...)` (index.css) shifts the entire .cm-content
// box right by a sub-pixel amount that Chromium counts as real scrollable
// overflow, so .cm-scroller's scrollWidth was a genuine 1px more than its
// clientWidth despite the app's own `overflowX: hidden` -- that CSS only
// blocks user-driven wheel/scrollbar scrolling, not native browser
// scrolling, and dragging a text selection past the scroller's edge is
// exactly the kind of native scroll that CSS doesn't stop. Fixed at the
// source in CM6Editor.tsx by giving contentDOM a `maxWidth` (not `width` --
// CM6's own base theme makes .cm-content a flex item with flexGrow: 2,
// which silently re-expands a plain `width` right back to fill the
// container; maxWidth is a hard clamp flex-grow can't exceed) shrunk by
// exactly the same shift amount the transform applies, so the shifted box
// lands flush with the scroller's edge instead of past it -- there's no
// overflow region left for anything (native drag-scroll or otherwise) to
// scroll into.
//
// This verifies both the underlying geometry (scrollWidth === clientWidth,
// the actual fix) and the originally reported symptom via a real simulated
// drag past both edges.
import { chromium } from 'playwright'
import { existsSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { startDevServer } from './perfHarness.mjs'

function resolveChromiumExecutablePath() {
  const browsersRoot = process.env.PLAYWRIGHT_BROWSERS_PATH
  if (!browsersRoot || !existsSync(browsersRoot)) return undefined
  const chromiumDir = readdirSync(browsersRoot).find((name) => name.startsWith('chromium-'))
  if (!chromiumDir) return undefined
  const candidate = path.join(browsersRoot, chromiumDir, 'chrome-linux', 'chrome')
  return existsSync(candidate) ? candidate : undefined
}

function assertTrue(cond, msg) {
  if (!cond) throw new Error(`ASSERTION FAILED: ${msg}`)
  console.log(`  ok: ${msg}`)
}

async function seedAndOpen(page, port, { gutterOn } = {}) {
  await page.goto(`http://localhost:${port}/`)
  await page.waitForSelector('.editor-text[contenteditable="true"]', { timeout: 30000 })
  await page.waitForTimeout(300)
  const longLine = Array.from({ length: 20 }, (_, i) => `word${i}`).join(' ')
  const text = Array.from({ length: 20 }, () => longLine).join('\n')
  await page.evaluate(async (initialText) => {
    const note = await window.thockdownNotes.createNote({ initialText })
    await window.thockdownSections.setActiveNote('default', note.id)
  }, text)
  await page.reload()
  await page.waitForSelector('.editor-text[contenteditable="true"]', { timeout: 30000 })
  await page.waitForTimeout(300)
  if (gutterOn) {
    await page.click('[aria-label*="Toggle line numbers"]')
    await page.waitForTimeout(300)
  }
}

async function main() {
  const port = 5200
  console.error(`[verify] starting dev server on port ${port}...`)
  const server = await startDevServer(port)
  const consoleErrors = []

  let browser
  try {
    browser = await chromium.launch({ headless: true, executablePath: resolveChromiumExecutablePath() })
    const page = await browser.newPage()
    await page.setViewportSize({ width: 900, height: 700 })
    page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()) })
    page.on('pageerror', (err) => consoleErrors.push(String(err)))

    // Geometry check across several widths, gutter off (the common case).
    for (const width of [700, 900, 1100, 1300]) {
      await page.setViewportSize({ width, height: 700 })
      await seedAndOpen(page, port)
      const s = await page.evaluate(() => {
        const scroller = document.querySelector('.cm-scroller')
        return { scrollWidth: scroller.scrollWidth, clientWidth: scroller.clientWidth }
      })
      assertTrue(s.scrollWidth === s.clientWidth, `no horizontal overflow at width=${width} (scrollWidth=${s.scrollWidth}, clientWidth=${s.clientWidth})`)
    }

    // Same check with the review gutter/line-numbers column on -- a
    // different, larger paddingRight path that must not reintroduce
    // overflow.
    await page.setViewportSize({ width: 900, height: 700 })
    await seedAndOpen(page, port, { gutterOn: true })
    const gutterState = await page.evaluate(() => {
      const scroller = document.querySelector('.cm-scroller')
      return { scrollWidth: scroller.scrollWidth, clientWidth: scroller.clientWidth }
    })
    assertTrue(gutterState.scrollWidth === gutterState.clientWidth, `no horizontal overflow with the review gutter on (scrollWidth=${gutterState.scrollWidth}, clientWidth=${gutterState.clientWidth})`)

    // The originally reported symptom: drag a selection past the left
    // border, then past the right border, and confirm scrollLeft never
    // moves off 0 either way.
    await seedAndOpen(page, port)
    await page.click('.editor-text[contenteditable="true"]')
    await page.waitForTimeout(100)
    const scrollerBox = await page.locator('.cm-scroller').boundingBox()
    const startX = scrollerBox.x + scrollerBox.width / 2
    const startY = scrollerBox.y + scrollerBox.height / 2

    async function scrollLeftNow() {
      return page.evaluate(() => document.querySelector('.cm-scroller').scrollLeft)
    }

    await page.mouse.move(startX, startY)
    await page.mouse.down()
    await page.mouse.move(scrollerBox.x + scrollerBox.width + 100, startY, { steps: 5 })
    await page.waitForTimeout(300)
    assertTrue((await scrollLeftNow()) === 0, 'scrollLeft stays 0 after dragging a selection past the right border')

    await page.mouse.move(scrollerBox.x - 100, startY, { steps: 5 })
    await page.waitForTimeout(300)
    assertTrue((await scrollLeftNow()) === 0, 'scrollLeft stays 0 after dragging a selection past the left border')

    await page.mouse.up()

    assertTrue(consoleErrors.length === 0, `no console errors (saw: ${JSON.stringify(consoleErrors)})`)

    console.log('\n[verify] ALL CHECKS PASSED')
  } finally {
    await browser?.close()
    server.stop()
  }
  process.exit(process.exitCode ?? 0)
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
