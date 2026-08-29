// Regression check for the preview's rendered block geometry: does every
// block occupy exactly the vertical slot the virtualizer gave it?
//
// The preview positions each block absolutely, at an offset that is the
// running sum of the heights the virtualizer believes in. When a believed
// height disagrees with the rendered one, the reader sees it directly: too
// small and the block overlaps the one below (the document's own title
// sitting 20px into its first paragraph), too large and a phantom gap opens
// where nothing is drawn (a ~50px margin above every group in the Open Items
// chapter, whose marker lines render to nothing at all).
//
// Both of those shipped, and both came from the same place: real measurements
// being discarded and replaced by the height model's predictions.
// `virtualizer.measure()` clears the size cache with no way to keep what was
// measured, react-virtual does not re-measure a mounted block that has not
// changed size, and the survey's own buffer used to drop any block that
// measured zero. The fixes are in usePreviewMarkdownRendering.tsx's
// applyHeightModel/remeasureMountedBlocks; this asserts the property they
// exist to hold.
//
// The leading-margin reset on the first block is checked here too, because it
// is the one thing that makes block 0's height unlike every other heading's --
// and because it used to be applied by DOM position (`:first-child`), which in
// a virtualized list means "whichever block is mounted right now".
//
// Usage: node scripts/perf/verifyPreviewBlockGeometry.mjs

import { chromium } from 'playwright'
import { startDevServer } from './perfHarness.mjs'

const PORT = 5197
const EXECUTABLE_PATH = process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined

const failures = []
const check = (label, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` -- ${detail}` : ''}`)
  if (!ok) failures.push(label)
}

/** A document that opens on an h1 and carries headings, lists and quotes throughout. */
function proseDocument() {
  const parts = ['# The Opening Title Of This Document']
  for (let i = 1; i <= 200; i += 1) {
    if (i % 10 === 0) parts.push(`## Section ${i} heading text`)
    parts.push(`Paragraph ${i} - lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco.`)
    if (i % 7 === 0) parts.push('- list item one\n- list item two\n- list item three')
    if (i % 11 === 0) parts.push('> a blockquote line here for shape variety')
  }
  return parts.join('\n\n')
}

/**
 * The auto-Open-Items chapter's own shape: a `[open-items-group:...]` marker
 * line ahead of each note's group. PreviewMarkdown.tsx renders those markers
 * as nothing, so each is a real block of exactly zero height -- the case the
 * survey used to skip.
 */
function openItemsDocument() {
  const lines = ['# Open Items', '']
  for (let g = 1; g <= 8; g += 1) {
    lines.push(`[open-items-group:note${g}]`)
    lines.push(`- [Chapter Title ${g}](@note${g})`)
    lines.push(`  - [ ] first unchecked item for group ${g}`)
    lines.push(`  - [ ] second unchecked item for group ${g}`)
    lines.push('')
  }
  return lines.join('\n')
}

/**
 * Every mounted block's assigned slot (the distance to the next block's own
 * offset) against its rendered height. `slack` is what react-virtual's own
 * integer rounding of a measured element costs, per block.
 */
const readBlockGeometry = () => {
  const scroller = document.querySelector('.markdown-preview')
  const spacer = scroller?.querySelector(':scope > div')
  if (!spacer) return []
  const readTop = (el) => {
    const match = /translateY\(([-\d.]+)px\)/.exec(el.style.transform || '')
    return match ? Number(match[1]) : null
  }
  const rows = [...spacer.querySelectorAll(':scope > [data-index]')].map((el) => ({
    index: Number(el.getAttribute('data-index')),
    top: readTop(el),
    height: el.getBoundingClientRect().height,
  })).sort((a, b) => a.index - b.index)
  return rows.slice(0, -1).map((row, i) => ({
    ...row,
    error: Math.round(((rows[i + 1].top - row.top) - row.height) * 100) / 100,
  }))
}

const worstError = (rows) => rows.reduce(
  (worst, row) => (Math.abs(row.error) > Math.abs(worst.error) ? row : worst),
  { index: -1, error: 0 },
)

async function seed(page, text) {
  await page.evaluate(async (initialText) => {
    const note = await window.thockdownNotes.createNote({ initialText })
    await window.thockdownSections.setActiveNote('default', note.id)
  }, text)
  await page.reload()
  await page.waitForSelector('.markdown-preview', { state: 'attached', timeout: 90000 })
  await page.waitForTimeout(2000)
  // Which mode a note opens in is remembered per section, so a second seeded
  // note in the same run can land in edit mode. Escape is the app's own
  // mode toggle.
  if (!(await page.locator('.markdown-preview').isVisible())) {
    await page.keyboard.press('Escape')
    await page.waitForSelector('.markdown-preview', { state: 'visible', timeout: 30000 })
  }
  await page.waitForTimeout(4000)
}

async function main() {
  const server = await startDevServer(PORT)
  const browser = await chromium.launch({ executablePath: EXECUTABLE_PATH })
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  const errors = []
  page.on('pageerror', (err) => errors.push(String(err).slice(0, 200)))
  page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text().slice(0, 200)) })

  try {
    await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load' })
    await page.waitForTimeout(2000)

    // ── a document that opens on a heading ────────────────────────────────
    await seed(page, proseDocument())

    const atTop = await page.evaluate(readBlockGeometry)
    const first = atTop.find((row) => row.index === 0)
    // 20.6px of overlap, before the fix. Every block's height came from the
    // model, and the model has no idea block 0 is missing a leading margin.
    check('the first block does not overlap the one below it', first && first.error > -1,
      first ? `slot is ${first.error}px off its rendered height` : 'block 0 not mounted')
    check('no block on the first screen is out by more than a pixel',
      Math.abs(worstError(atTop).error) <= 1,
      `worst was block ${worstError(atTop).index} at ${worstError(atTop).error}px`)

    const margins = await page.evaluate(() => {
      const scroller = document.querySelector('.markdown-preview')
      const firstBlockHeading = scroller.querySelector(':scope > div > [data-index="0"] h1')
      return { firstBlockMarginTop: firstBlockHeading ? getComputedStyle(firstBlockHeading).marginTop : null }
    })
    check('the document does not open with a gap above its own title',
      margins.firstBlockMarginTop === '0px', `margin-top: ${margins.firstBlockMarginTop}`)

    // The reset belongs to block 0, not to "whatever is mounted first". With a
    // `:first-child` rule this heading loses its margin the moment the reader
    // scrolls it to the top of the mounted range, and gets it back on the way
    // out -- a height that changes for no reason the virtualizer can see.
    const scrolledHeading = await page.evaluate(async () => {
      const scroller = document.querySelector('.markdown-preview')
      scroller.style.scrollBehavior = 'auto'
      const spacer = scroller.querySelector(':scope > div')
      // Finely, not in screenfuls: the mounted range leads the viewport by
      // PREVIEW_BLOCK_OVERSCAN blocks, so a heading only leads it at one
      // particular scroll offset, and a coarse sweep walks straight past it.
      for (let top = 0; top < 12000; top += 60) {
        scroller.scrollTop = top
        await new Promise((r) => setTimeout(r, 40))
        const mounted = [...spacer.querySelectorAll(':scope > [data-index]')]
          .sort((a, b) => Number(a.getAttribute('data-index')) - Number(b.getAttribute('data-index')))
        const heading = mounted[0]?.querySelector('h1, h2')
        if (heading && Number(mounted[0].getAttribute('data-index')) > 0) {
          return { index: Number(mounted[0].getAttribute('data-index')), marginTop: getComputedStyle(heading).marginTop }
        }
      }
      return null
    })
    check('a mid-document heading keeps its margin when it is the first mounted block',
      scrolledHeading !== null && scrolledHeading.marginTop !== '0px',
      scrolledHeading ? `block ${scrolledHeading.index} margin-top: ${scrolledHeading.marginTop}` : 'no heading ever led the mounted range')

    // ── a resize re-fits the model; the geometry must survive it ──────────
    await page.setViewportSize({ width: 900, height: 900 })
    await page.waitForTimeout(4000)
    await page.evaluate(() => {
      const scroller = document.querySelector('.markdown-preview')
      scroller.style.scrollBehavior = 'auto'
      scroller.scrollTop = 0
    })
    await page.waitForTimeout(1500)
    const afterResize = await page.evaluate(readBlockGeometry)
    const firstAfterResize = afterResize.find((row) => row.index === 0)
    check('the first block still does not overlap after a window resize',
      firstAfterResize && firstAfterResize.error > -1,
      firstAfterResize ? `slot is ${firstAfterResize.error}px off` : 'block 0 not mounted')
    check('no block is out by more than a pixel after a window resize',
      Math.abs(worstError(afterResize).error) <= 1,
      `worst was block ${worstError(afterResize).index} at ${worstError(afterResize).error}px`)

    // ── a document containing blocks that render to nothing ───────────────
    await page.setViewportSize({ width: 1280, height: 900 })
    await seed(page, openItemsDocument())

    const openItems = await page.evaluate(readBlockGeometry)
    const emptyBlocks = openItems.filter((row) => row.height === 0)
    check('the Open Items marker blocks really do render to nothing', emptyBlocks.length >= 4,
      `${emptyBlocks.length} zero-height blocks`)
    check('a block that renders to nothing takes up no space',
      emptyBlocks.every((row) => Math.abs(row.error) <= 1),
      `worst was ${worstError(emptyBlocks).error}px above block ${worstError(emptyBlocks).index + 1}`)
    check('no block in the Open Items chapter is out by more than a pixel',
      Math.abs(worstError(openItems).error) <= 1,
      `worst was block ${worstError(openItems).index} at ${worstError(openItems).error}px`)

    check('no page errors', errors.length === 0, errors.slice(0, 2).join(' | '))
  } finally {
    await browser.close()
    await server.stop()
  }

  if (failures.length > 0) {
    console.log(`\n${failures.length} check(s) failed`)
    process.exit(1)
  }
  console.log('\nall checks passed')
}

main().catch((err) => { console.error(err); process.exit(1) })
