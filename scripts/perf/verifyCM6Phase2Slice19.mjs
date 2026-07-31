// Live-browser verification for Phase 2 slice 19: the whole grid + text
// must be shifted by exactly half a cell (halfCellWidthPx, halfLineHeightPx)
// in the positive x/y direction, for a bit of breathing room between content
// and the container's top-left edge, while the grid stays an "infinity grid"
// -- grid and text must move together and stay aligned with each other, not
// just individually offset from the edge.
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

const PORT = 5283

async function measure(page) {
  return page.evaluate(() => {
    const layer = document.querySelector('.cm6-editor-root').parentElement
    const gridLines = layer.querySelector('.thockdown-grid-lines')
    const gridRect = gridLines.getBoundingClientRect()
    const gridPos = getComputedStyle(gridLines).backgroundPosition
    const content = document.querySelector('.cm6-editor-root .cm-content')
    const cs = getComputedStyle(content)
    const cellWidth = parseFloat(cs.getPropertyValue('--editor-cell-width'))
    const lineHeight = parseFloat(cs.getPropertyValue('--editor-line-height'))
    const glyphWidth = parseFloat(cs.getPropertyValue('--editor-glyph-width'))
    const paddingLeft = parseFloat(cs.paddingLeft)
    const paddingTop = parseFloat(cs.paddingTop)
    const firstLine = document.querySelector('.cm6-editor-root .cm-line')
    const lineRect = firstLine.getBoundingClientRect()
    const [gridX, gridY] = gridPos.split(' ').map(parseFloat)
    return {
      cellWidth,
      lineHeight,
      glyphWidth,
      paddingLeft,
      paddingTop,
      gridX,
      gridY,
      // Text's own visual start relative to the container's own edge.
      lineLeftInLayer: lineRect.left - gridRect.left,
      lineTopInLayer: lineRect.top - gridRect.top,
    }
  })
}

async function main() {
  console.error('[verify] starting dev server...')
  const server = await startDevServer(PORT)
  let browser
  const consoleErrors = []
  try {
    browser = await chromium.launch({ headless: true, executablePath: resolveChromiumExecutablePath() })
    const page = await browser.newPage()
    page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()) })
    page.on('pageerror', (err) => consoleErrors.push(String(err)))
    await page.addInitScript(() => window.localStorage.setItem('thockdown:cm6-editor-spike', '1'))
    await page.goto(`http://localhost:${PORT}/`)
    await page.waitForSelector('.cm6-editor-root .cm-content', { timeout: 15000 })

    await page.evaluate(async () => {
      const note = await window.thockdownNotes.createNote({ initialText: 'hello world' })
      await window.thockdownSections.setActiveNote('default', note.id)
    })
    await page.reload()
    await page.waitForSelector('.cm6-editor-root .cm-content', { timeout: 15000 })
    await page.waitForTimeout(400)

    const m = await measure(page)
    const halfCell = m.cellWidth / 2
    const halfLine = m.lineHeight / 2

    if (Math.abs(m.paddingLeft - halfCell) > 0.5) {
      throw new Error(`FAIL: contentDOM paddingLeft (${m.paddingLeft}px) is not half a cell (${halfCell}px)`)
    }
    if (Math.abs(m.paddingTop - halfLine) > 0.5) {
      throw new Error(`FAIL: contentDOM paddingTop (${m.paddingTop}px) is not half a line (${halfLine}px) with no boundary set`)
    }
    if (Math.abs(m.gridX - halfCell) > 0.5) {
      throw new Error(`FAIL: grid backgroundPosition x (${m.gridX}px) is not shifted by half a cell (${halfCell}px)`)
    }
    if (Math.abs(m.gridY - halfLine) > 0.5) {
      throw new Error(`FAIL: grid backgroundPosition y (${m.gridY}px) is not shifted by half a line (${halfLine}px)`)
    }
    console.error(`[verify] contentDOM padding shifted by half a cell (left=${m.paddingLeft}px, top=${m.paddingTop}px) and grid backgroundPosition matches (${m.gridX}px, ${m.gridY}px)`)

    // The real fidelity check: text and grid must still align with each
    // other after both shifted -- i.e. the line's position, minus the
    // grid's own phase offset (backgroundPosition), must land at the SAME
    // sub-cell offset as before this fix. That offset is NOT zero: .cm-
    // content's own pre-existing glyph-centering transform (translateX by
    // (cellWidth-glyphWidth)/2, see index.css's .editor-text rule) shifts
    // every rendered glyph -- including .cm-line's own box, since the
    // transform lands on .cm-content itself -- by that amount regardless of
    // padding/backgroundPosition. That's intentional pre-existing behavior
    // (centers each glyph within its cell) confirmed unaffected by this
    // fix via live A/B measurement: xRel was 1.0/0.99px and yRel was 0px
    // both before and after adding the half-cell paddingLeft/paddingTop +
    // matching grid backgroundPosition shift, proving grid and text moved
    // in exact lockstep rather than drifting apart.
    const expectedXOffset = (m.cellWidth - m.glyphWidth) / 2
    const xRel = ((m.lineLeftInLayer - m.gridX) % m.cellWidth + m.cellWidth) % m.cellWidth
    const yRel = ((m.lineTopInLayer - m.gridY) % m.lineHeight + m.lineHeight) % m.lineHeight
    const xErr = Math.abs(xRel - expectedXOffset)
    const yErr = Math.min(yRel, m.lineHeight - yRel)
    if (xErr > 0.5) throw new Error(`FAIL: first line's horizontal offset from the grid changed after the shift (expected glyph-centering offset=${expectedXOffset}px, got=${xRel}px)`)
    if (yErr > 0.5) throw new Error(`FAIL: first line's top edge is not grid-aligned after the shift (error=${yErr}px, lineTopInLayer=${m.lineTopInLayer}px, gridY=${m.gridY}px)`)
    console.error(`[verify] text stays grid-aligned after the half-cell shift (xRel=${xRel}px vs expected ${expectedXOffset}px, yErr=${yErr}px)`)

    // The shift must actually create visible breathing room -- not just be
    // grid-aligned by coincidence at zero offset.
    if (m.lineLeftInLayer < 1) throw new Error(`FAIL: no horizontal breathing room from the container edge (lineLeftInLayer=${m.lineLeftInLayer}px)`)
    if (m.lineTopInLayer < 1) throw new Error(`FAIL: no vertical breathing room from the container edge (lineTopInLayer=${m.lineTopInLayer}px)`)
    console.error(`[verify] visible breathing room present (left=${m.lineLeftInLayer}px, top=${m.lineTopInLayer}px)`)

    // Natural max-scroll must still be grid-quantized (slice 18's invariant)
    // even with the extra half-line top offset folded into scrollHeight.
    // Force real overflow first (a one-line note may not overflow at all,
    // making maxScrollTop <= 0 and the check vacuous).
    const longText = Array.from({ length: 5000 }, (_, i) => `line ${i}`).join('\n')
    await page.evaluate(async (text) => {
      const note = await window.thockdownNotes.createNote({ initialText: text })
      await window.thockdownSections.setActiveNote('default', note.id)
    }, longText)
    await page.reload()
    await page.waitForSelector('.cm6-editor-root .cm-content', { timeout: 15000 })
    await page.waitForTimeout(400)
    const scrollCheck = await page.evaluate(() => {
      const scroller = document.querySelector('.cm6-editor-root .cm-scroller')
      const cs = getComputedStyle(document.querySelector('.cm6-editor-root .cm-content'))
      const lineHeight = parseFloat(cs.getPropertyValue('--editor-line-height'))
      const maxScrollTop = scroller.scrollHeight - scroller.clientHeight
      const remainder = ((maxScrollTop % lineHeight) + lineHeight) % lineHeight
      const distanceFromQuantized = Math.min(remainder, lineHeight - remainder)
      return { maxScrollTop, distanceFromQuantized }
    })
    if (scrollCheck.maxScrollTop <= 0) throw new Error('FAIL: test setup did not produce scroll overflow -- cannot verify max-scroll quantization')
    if (scrollCheck.distanceFromQuantized > 0.5) {
      throw new Error(`FAIL: natural max-scroll is no longer grid-quantized after the shift (distance=${scrollCheck.distanceFromQuantized}px)`)
    }
    console.error(`[verify] natural max-scroll remains grid-quantized after the shift (maxScrollTop=${scrollCheck.maxScrollTop}px, distance=${scrollCheck.distanceFromQuantized}px)`)

    if (consoleErrors.length > 0) {
      console.error('[verify] console errors:')
      for (const err of consoleErrors) console.error('  ' + err)
      throw new Error(`${consoleErrors.length} console error(s)`)
    }
    console.error('[verify] ALL PASS -- no console errors.')
  } finally {
    await browser?.close()
    server.stop()
  }
}

main().catch((err) => {
  console.error('[verify] FAIL:', err)
  process.exitCode = 1
})
