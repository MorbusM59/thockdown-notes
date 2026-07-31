#!/usr/bin/env node
// One-off diagnostic: reads out the temporary performance.mark/measure pairs
// added to EditorSection.tsx (t:currentEditorText, t:useNoteSnapshotTimeline,
// t:activeNoteDocumentStats, t:useDocumentFind, t:usePreviewMarkdownRendering,
// t:usePreviewScrollbar, t:useDocumentFindNavigation,
// t:useMarkdownFormattingToolbar) during a real keystroke burst on the CM6
// path, to find which of EditorSection's hook calls is actually behind the
// large but source-map-drifted "(anonymous) @ EditorSection.tsx:549" CDP
// profile entry. Not a permanent tool -- the marks are meant to be reverted
// once this answers the question.

import { chromium } from 'playwright'
import { existsSync, readdirSync } from 'node:fs'
import path from 'node:path'
import {
  startDevServer,
  generateSyntheticDocument,
  seedLargeNoteAndReload,
  measureKeystrokeBurstMs,
} from './perfHarness.mjs'

function resolveChromiumExecutablePath() {
  const browsersRoot = process.env.PLAYWRIGHT_BROWSERS_PATH
  if (!browsersRoot || !existsSync(browsersRoot)) return undefined
  const chromiumDir = readdirSync(browsersRoot).find((name) => name.startsWith('chromium-'))
  if (!chromiumDir) return undefined
  const candidate = path.join(browsersRoot, chromiumDir, 'chrome-linux', 'chrome')
  return existsSync(candidate) ? candidate : undefined
}

async function main() {
  const port = 5186
  const chars = 1_500_000
  const keystrokes = 30
  console.error(`[hooks] starting dev server on port ${port}...`)
  const server = await startDevServer(port)

  let browser
  try {
    browser = await chromium.launch({ headless: true, executablePath: resolveChromiumExecutablePath() })
    const page = await browser.newPage()
    await page.addInitScript(() => { window.localStorage.setItem('thockdown:cm6-editor-spike', '1') })
    await page.goto(`http://localhost:${port}/`)

    console.error(`[hooks] generating synthetic document (~${chars} chars)...`)
    const text = generateSyntheticDocument(chars)
    console.error('[hooks] seeding note and reloading...')
    await seedLargeNoteAndReload(page, text)

    const editable = page.locator('.cm-content[contenteditable="true"]')
    await editable.click()
    await page.waitForSelector('.cm-content[contenteditable="true"]:focus')
    await page.keyboard.press('Control+End')
    await page.waitForTimeout(200)

    await page.evaluate(() => performance.clearMeasures())
    await measureKeystrokeBurstMs(page, keystrokes, 'x')

    const measures = await page.evaluate(() => {
      const entries = performance.getEntriesByType('measure')
      const byName = new Map()
      for (const e of entries) {
        if (!e.name.startsWith('t:')) continue
        const list = byName.get(e.name) || []
        list.push(e.duration)
        byName.set(e.name, list)
      }
      return Array.from(byName.entries()).map(([name, durations]) => ({
        name,
        count: durations.length,
        totalMs: durations.reduce((a, b) => a + b, 0),
        meanMs: durations.reduce((a, b) => a + b, 0) / durations.length,
        maxMs: Math.max(...durations),
      }))
    })

    measures.sort((a, b) => b.totalMs - a.totalMs)
    console.log(`\n${keystrokes}-keystroke burst on a ${chars}-char note, caret at end:\n`)
    for (const m of measures) {
      console.log(`  ${m.totalMs.toFixed(1).padStart(8)}ms total  ${m.meanMs.toFixed(2).padStart(7)}ms mean  ${m.maxMs.toFixed(2).padStart(7)}ms max  (n=${m.count})  ${m.name}`)
    }
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
