// Throughput of the preview's background measurement survey.
//
// The survey is what makes scrollbar navigation honest on a large document
// (see previewMeasurementPrewarm.ts). It is only useful if it FINISHES: the
// user reported 1% of progress every ~2 seconds on a 1.5M-character note,
// i.e. a survey that would take several minutes and is effectively no survey
// at all.
//
// This measures the thing that matters -- blocks measured per second -- plus
// the two numbers that explain it: the batch size the adaptive sizer settles
// on, and how much wall time each batch costs end to end.
//
// Usage: node scripts/perf/measurePreviewSurveyThroughput.mjs [--chars=1500000] [--seconds=45]

import { chromium } from 'playwright'
import { startDevServer, generateSyntheticDocument } from './perfHarness.mjs'

const PORT = 5203
const EXECUTABLE_PATH = process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined
const arg = (name, fallback) => Number((process.argv.find((a) => a.startsWith(`--${name}=`)) ?? `--${name}=${fallback}`).split('=')[1])
const chars = arg('chars', 1500000)
// Block DENSITY is what the survey's cost actually scales with, not character
// count: the survey pays a fixed per-batch overhead (a React commit plus a
// forced layout of the whole preview), so a document of many small blocks is
// far more expensive than the same characters in a few large ones. The shared
// harness generator produces ~9-line blocks; `--shape=dense` produces the
// short blank-line-separated paragraphs a real prose document is made of,
// which is the shape the user reported the crawl on.
const shape = (process.argv.find((a) => a.startsWith('--shape=')) ?? '--shape=harness').split('=')[1]
const generateDenseDocument = (targetChars) => {
  const out = []
  let total = 0
  let i = 0
  while (total < targetChars) {
    const mod = i % 11
    let para
    if (mod === 0) para = `### Heading ${i}`
    else if (mod === 3) para = `- list item ${i} with **bold** text`
    else if (mod === 7) para = `> quoted line ${i}`
    else para = `Paragraph ${i}: a short prose paragraph of the kind a real document is full of, one or two lines long.`
    out.push(para, '')
    total += para.length + 2
    i += 1
  }
  return out.join('\n')
}
const seconds = arg('seconds', 45)

async function main() {
  const server = await startDevServer(PORT)
  const browser = await chromium.launch({ executablePath: EXECUTABLE_PATH })
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  try {
    await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load' })
    await page.waitForTimeout(2000)

    const text = shape === 'dense' ? generateDenseDocument(chars) : generateSyntheticDocument(chars)
    console.log(`document: ${text.length} chars, ${text.split('\n').length} lines`)
    await page.evaluate(async (initialText) => {
      const note = await window.thockdownNotes.createNote({ initialText })
      await window.thockdownSections.setActiveNote('default', note.id)
    }, text)
    await page.reload()
    await page.waitForSelector('.markdown-preview', { timeout: 120000 })
    await page.waitForTimeout(500)

    const inPreview = await page.evaluate(() => !!document.querySelector('.editor-stage.is-preview-mode'))
    if (!inPreview) {
      await page.keyboard.press('Escape')
      await page.waitForTimeout(1500)
    }

    // The survey reports itself through the discovery progress bar's
    // aria-label ("Measuring document: N of M blocks"), which is the only
    // handle on its internal state from outside the hook.
    const result = await page.evaluate(async (limitMs) => {
      const readProgress = () => {
        const bar = document.querySelector('[role="progressbar"][aria-label^="Measuring document"]')
        if (!bar) return null
        const m = /(\d+) of (\d+)/.exec(bar.getAttribute('aria-label') || '')
        return m ? { measured: Number(m[1]), total: Number(m[2]) } : null
      }

      // Sample the host at animation rate to see the batch sizes the adaptive
      // sizer actually settles on, and how long a batch is mounted.
      const batchSizes = []
      let running = true
      let lastCount = 0
      const sample = () => {
        const count = document.querySelectorAll('[data-prewarm-index]').length
        if (count > 0 && count !== lastCount) batchSizes.push(count)
        lastCount = count
        if (running) requestAnimationFrame(sample)
      }
      requestAnimationFrame(sample)

      const startedAt = performance.now()
      const samples = []
      let last = readProgress()
      const firstSeen = last
      while (performance.now() - startedAt < limitMs) {
        await new Promise((r) => setTimeout(r, 500))
        const now = readProgress()
        samples.push({ t: Math.round(performance.now() - startedAt), measured: now?.measured ?? null })
        last = now ?? last
        if (!now) break // survey finished (the bar unmounts)
      }
      running = false

      const elapsedMs = performance.now() - startedAt
      const measured = last?.measured ?? 0
      const total = firstSeen?.total ?? last?.total ?? 0
      const sorted = [...batchSizes].sort((a, b) => a - b)
      return {
        finished: !readProgress(),
        elapsedMs: Math.round(elapsedMs),
        totalBlocks: total,
        measuredBlocks: measured,
        blocksPerSecond: Math.round((measured / elapsedMs) * 1000),
        projectedTotalSeconds: measured > 0 ? Math.round((total / (measured / elapsedMs)) / 1000) : null,
        batches: batchSizes.length,
        medianBatchSize: sorted[Math.floor(sorted.length / 2)] ?? 0,
        maxBatchSize: sorted[sorted.length - 1] ?? 0,
        samples: samples.filter((_, i) => i % 4 === 0),
      }
    }, seconds * 1000)

    console.log(JSON.stringify(result, null, 2))
    console.log('')
    console.log('SUMMARY')
    console.log(`  ${result.measuredBlocks} of ${result.totalBlocks} blocks in ${(result.elapsedMs / 1000).toFixed(1)}s`)
    console.log(`  ${result.blocksPerSecond} blocks/sec, median batch ${result.medianBatchSize} (max ${result.maxBatchSize}) over ${result.batches} batches`)
    console.log(`  projected full survey: ${result.projectedTotalSeconds}s${result.finished ? ' (already finished)' : ''}`)
  } finally {
    await browser.close()
    await server.stop()
  }
}

main().catch((err) => { console.error(err); process.exit(1) })
