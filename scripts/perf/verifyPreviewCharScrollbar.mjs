// Verifies the preview scrollbar's character-space thumb (previewCharPosition.ts).
//
// Three properties, each of which fails in a way the reader would feel:
//
//   1. INVERSE. Dragging the thumb to a position and reading the position back
//      must give the same answer. Reading in one space and writing in another
//      drops the thumb somewhere other than where it was released.
//   2. LANDING. Dragging to the end must land on the last block, and dragging
//      to the middle must land near the middle of the TEXT (not of the block
//      list -- blocks are not the same size).
//   3. STILLNESS. Parked, with nothing touched, the thumb must not move. The
//      creeping thumb on a document still being measured is the symptom this
//      whole line of work started from.
//
// Usage: node scripts/perf/verifyPreviewCharScrollbar.mjs [--chars=400000]

import { chromium } from 'playwright'
import { startDevServer, ensurePreviewMode } from './perfHarness.mjs'

const PORT = 5207
const EXECUTABLE_PATH = process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined
const arg = (name, fallback) => Number((process.argv.find((a) => a.startsWith(`--${name}=`)) ?? `--${name}=${fallback}`).split('=')[1])
const chars = arg('chars', 400000)

/** Varied-length blocks, each tagged with its ordinal so position is readable. */
const generateDocument = (targetChars) => {
  let seed = 987654
  const random = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff
    return seed / 0x7fffffff
  }
  const out = []
  let total = 0
  let i = 0
  while (total < targetChars) {
    const words = 8 + Math.floor(random() * 90)
    const block = `BLOCK${i} ${'lorem ipsum dolor sit amet '.repeat(Math.ceil(words / 5)).trim()}.`
    out.push(block, '')
    total += block.length + 2
    i += 1
  }
  return out.join('\n')
}

const readState = () => {
  const scroller = document.querySelector('.markdown-preview')
  const thumb = document.querySelector('.thockdown-scroll-thumb')
  const track = document.querySelector('.thockdown-scroll-track')
  const mounted = [...scroller.querySelectorAll('[data-index]')]
    .map((el) => Number(el.getAttribute('data-index')))
    .sort((a, b) => a - b)
  // The topmost block actually intersecting the viewport, not the first
  // mounted one -- the virtualizer overscans above the fold.
  const scrollTop = scroller.scrollTop
  let topIndex = mounted[0] ?? 0
  for (const index of mounted) {
    const el = scroller.querySelector(`[data-index="${index}"]`)
    if (!el) continue
    const top = el.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scrollTop
    if (top + el.getBoundingClientRect().height > scrollTop) { topIndex = index; break }
  }
  const thumbRect = thumb?.getBoundingClientRect()
  const trackRect = track?.getBoundingClientRect()
  return {
    thumbTop: thumbRect ? Math.round(thumbRect.top - trackRect.top) : null,
    thumbHeight: thumbRect ? Math.round(thumbRect.height) : null,
    trackHeight: trackRect ? Math.round(trackRect.height) : null,
    topIndex,
    scrollTop: Math.round(scrollTop),
    text: (scroller.querySelector(`[data-index="${topIndex}"]`)?.textContent || '').slice(0, 24),
  }
}

async function main() {
  const server = await startDevServer(PORT)
  const browser = await chromium.launch({ executablePath: EXECUTABLE_PATH })
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  try {
    await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load' })
    await page.waitForTimeout(2000)

    const text = generateDocument(chars)
    const blockCount = text.split('\n\n').filter(Boolean).length
    console.log(`document: ${text.length} chars, ~${blockCount} blocks`)
    await page.evaluate(async (initialText) => {
      const note = await window.thockdownNotes.createNote({ initialText })
      await window.thockdownSections.setActiveNote('default', note.id)
    }, text)
    await page.reload()
    // Waiting for the preview to be VISIBLE is not the same as waiting for it
    // to exist, and the note does not always open in render view -- this used
    // to run its own toggle, but only after a visibility wait that could never
    // resolve when the toggle was the thing needed. ensurePreviewMode asks
    // both questions in the right order.
    await ensurePreviewMode(page, 120000)
    await page.waitForTimeout(500)
    await page.waitForTimeout(1500)

    // --- 3. STILLNESS: parked, untouched, for two seconds -----------------
    const still = await page.evaluate(async () => {
      const thumb = document.querySelector('.thockdown-scroll-thumb')
      const track = document.querySelector('.thockdown-scroll-track')
      const read = () => Math.round(thumb.getBoundingClientRect().top - track.getBoundingClientRect().top)
      const first = read()
      let worst = 0
      for (let i = 0; i < 40; i += 1) {
        await new Promise((r) => setTimeout(r, 50))
        worst = Math.max(worst, Math.abs(read() - first))
      }
      return { driftPx: worst }
    })

    // --- 1 & 2. Drag the real thumb to a series of positions --------------
    const geometry = await page.evaluate(() => {
      const thumb = document.querySelector('.thockdown-scroll-thumb').getBoundingClientRect()
      const track = document.querySelector('.thockdown-scroll-track').getBoundingClientRect()
      return {
        thumbX: Math.round(thumb.left + thumb.width / 2),
        thumbCenterY: Math.round(thumb.top + thumb.height / 2),
        thumbHeight: Math.round(thumb.height),
        trackTop: Math.round(track.top),
        trackHeight: Math.round(track.height),
      }
    })

    const EDGE_GAP = 3
    const travel = geometry.trackHeight - (EDGE_GAP * 2) - geometry.thumbHeight
    const results = []
    for (const ratio of [0, 0.25, 0.5, 0.75, 1]) {
      // Grab the thumb wherever it is now and drop it at the target.
      const from = await page.evaluate(() => {
        const t = document.querySelector('.thockdown-scroll-thumb').getBoundingClientRect()
        return { x: Math.round(t.left + t.width / 2), y: Math.round(t.top + t.height / 2) }
      })
      const targetCenterY = geometry.trackTop + EDGE_GAP + Math.round(travel * ratio) + Math.round(geometry.thumbHeight / 2)
      await page.mouse.move(from.x, from.y)
      await page.mouse.down()
      await page.mouse.move(from.x, targetCenterY, { steps: 12 })
      await page.mouse.up()
      await page.waitForTimeout(700)

      const state = await page.evaluate(readState)
      const readBackRatio = travel > 0 ? (state.thumbTop - EDGE_GAP) / travel : 0
      results.push({ ratio, readBackRatio: Math.round(readBackRatio * 1000) / 1000, ...state })
    }

    const lastIndex = await page.evaluate(() => {
      const scroller = document.querySelector('.markdown-preview')
      return Math.max(...[...scroller.querySelectorAll('[data-index]')].map((el) => Number(el.getAttribute('data-index'))))
    })

    console.log('')
    console.log('drag results (ratio -> where the thumb reads back, what is on screen)')
    for (const row of results) {
      console.log(`  ${row.ratio.toFixed(2)} -> ${row.readBackRatio.toFixed(3)}  topBlock=${row.topIndex}  "${row.text.trim()}"`)
    }
    const worstInverse = Math.max(...results.map((row) => Math.abs(row.readBackRatio - row.ratio)))

    console.log('')
    console.log('SUMMARY')
    console.log(`  worst inverse error:   ${Math.round(worstInverse * 1000) / 1000} (thumb read back vs where it was dropped)`)
    console.log(`  thumb drift when idle: ${still.driftPx}px over 2s`)
    console.log(`  drag to 1.0 landed on: block ${results.at(-1).topIndex}, last mounted block ${lastIndex}`)
    console.log(`  monotonic:             ${results.every((row, i) => i === 0 || row.topIndex >= results[i - 1].topIndex)}`)
  } finally {
    await browser.close()
    await server.stop()
  }
}

main().catch((err) => { console.error(err); process.exit(1) })
