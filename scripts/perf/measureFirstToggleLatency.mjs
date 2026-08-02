#!/usr/bin/env node
// Live-browser measurement of the first edit -> preview toggle latency on a
// large note. The goal is to confirm that useEditorSectionMount's background
// preview-block prewarm cache eliminates the cold remark-parse cost that
// previously made the first toggle take ~700-800ms on a 1.5M-char document.
//
// Run against the browser mock dev server (npm run dev:browser). On Windows
// spawn('npm') from Node is unreliable, so start the dev server manually and
// pass --use-existing. Example:
//   npm run dev:browser -- --port 5174
//   node scripts/perf/measureFirstToggleLatency.mjs --use-existing --port 5174 --chars=1500000

import { chromium } from 'playwright'
import { performance } from 'node:perf_hooks'
import {
  startDevServer,
  generateSyntheticDocument,
  seedLargeNoteAndReload,
} from './perfHarness.mjs'

const CHARS = Number(process.argv.find((a) => a.startsWith('--chars='))?.split('=')[1]) || 1_500_000
const PORT = Number(process.argv.find((a) => a.startsWith('--port='))?.split('=')[1]) || 5183
const USE_EXISTING_SERVER = process.argv.includes('--use-existing')

async function waitForDatabaseReady(page, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs
  let lastError
  while (Date.now() < deadline) {
    try {
      await page.evaluate(() => window.thockdownNotes.listNotes())
      return
    } catch (err) {
      lastError = err
      await new Promise((resolve) => setTimeout(resolve, 200))
    }
  }
  throw new Error(`App never ready: ${lastError}`)
}

async function measureToggleMs(page, buttonLabel) {
  return page.evaluate(() => {
    window.__toggleStart = performance.now()
  }).then(() => page.getByRole('button', { name: buttonLabel }).click())
    .then(() => page.waitForFunction(() => {
      const stage = document.querySelector('.editor-stage')
      return stage && stage.classList.contains('is-preview-mode')
    }, { timeout: 30000 }))
    .then(() => page.evaluate(() => performance.now() - window.__toggleStart))
}

async function main() {
  let server = null
  if (!USE_EXISTING_SERVER) {
    console.error(`[perf] starting dev server on port ${PORT}...`)
    server = await startDevServer(PORT)
  } else {
    console.error(`[perf] using existing dev server on port ${PORT}...`)
  }

  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })

  try {
    await page.goto(`http://localhost:${PORT}/`)
    await page.evaluate(() => {
      window.localStorage.setItem('thockdown:debug-input-lag', '1')
    })
    await page.reload()
    await waitForDatabaseReady(page)

    const text = generateSyntheticDocument(CHARS)
    console.log(`[perf] seeding note with ${text.length.toLocaleString()} chars...`)
    await seedLargeNoteAndReload(page, text)

    // Scroll down so the toggle has a real anchor to restore.
    const scroller = page.locator('.cm-scroller')
    await scroller.evaluate((el) => { el.scrollTop = el.scrollHeight * 0.25 })
    await page.waitForTimeout(500)

    console.log('[perf] measuring first edit -> preview toggle...')
    const firstToggleMs = await measureToggleMs(page, /Switch to Render/)
    console.log(`[perf] first toggle: ${firstToggleMs.toFixed(1)}ms`)

    // Toggle back to edit, then preview again to measure cached path.
    await page.getByRole('button', { name: /Switch to Edit/ }).click()
    await page.waitForFunction(() => {
      const stage = document.querySelector('.editor-stage')
      return stage && !stage.classList.contains('is-preview-mode')
    }, { timeout: 30000 })
    await page.waitForTimeout(500)

    console.log('[perf] measuring cached edit -> preview toggle...')
    const cachedToggleMs = await measureToggleMs(page, /Switch to Render/)
    console.log(`[perf] cached toggle: ${cachedToggleMs.toFixed(1)}ms`)
  } finally {
    await browser.close()
    if (server) server.stop()
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
