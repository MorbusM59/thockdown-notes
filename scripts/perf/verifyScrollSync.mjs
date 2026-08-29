import { chromium } from 'playwright'
import { ensureEditMode } from './perfHarness.mjs'

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

async function getScrollPositions(page) {
  return page.evaluate(() => ({
    editScrollTop: document.querySelector('.cm-scroller')?.scrollTop ?? null,
    previewScrollTop: document.querySelector('.markdown-preview')?.scrollTop ?? null,
    isPreviewMode: document.querySelector('.editor-stage')?.classList.contains('is-preview-mode') ?? false,
  }))
}

async function main() {
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })

  page.on('console', (msg) => {
    if (msg.text().includes('[scroll-sync]')) {
      console.log('[browser]', msg.text())
    }
  })

  try {
    await page.goto('http://localhost:5174/')
    await page.evaluate(() => {
      window.localStorage.setItem('thockdown:debug-input-lag', '1')
    })
    await page.reload()
    await waitForDatabaseReady(page)

    // Create a tall note with many blocks.
    const lines = []
    for (let i = 0; i < 80; i += 1) {
      lines.push(`# Heading ${i + 1}`)
      lines.push('')
      lines.push(`This is paragraph ${i + 1} with enough text to make the block taller than one line if needed. `)
      lines.push('')
    }
    const initialText = lines.join('\n')

    const noteId = await page.evaluate(async (text) => {
      const note = await window.thockdownNotes.createNote({ initialText: text })
      await window.thockdownState.saveAppState({ selectedNoteId: note.id })
      await window.thockdownSections.setActiveNote('default', note.id)
      return note.id
    }, initialText)

    await page.reload()
    await ensureEditMode(page)
    await page.waitForTimeout(2000)

    // Focus the editor and scroll it down with the mouse wheel.
    await page.click('.editor-text[contenteditable="true"]')
    const scrollerBox = await page.locator('.cm-scroller').boundingBox()
    if (scrollerBox) {
      await page.mouse.move(
        scrollerBox.x + scrollerBox.width / 2,
        scrollerBox.y + scrollerBox.height / 2,
      )
      for (let i = 0; i < 20; i += 1) {
        await page.mouse.wheel(0, 1200)
        await page.waitForTimeout(80)
      }
    }
    await page.waitForTimeout(800)

    const metrics = await page.evaluate(() => {
      const scroller = document.querySelector('.cm-scroller')
      const preview = document.querySelector('.markdown-preview')
      const editorText = document.querySelector('.editor-text')
      return {
        scrollerExists: !!scroller,
        scrollerScrollHeight: scroller?.scrollHeight ?? null,
        scrollerClientHeight: scroller?.clientHeight ?? null,
        previewExists: !!preview,
        previewScrollHeight: preview?.scrollHeight ?? null,
        previewClientHeight: preview?.clientHeight ?? null,
        editorTextLength: editorText?.textContent?.length ?? null,
      }
    })
    console.log('Metrics:', metrics)
    console.log('After edit scroll:', await getScrollPositions(page))

    const toggleButton = page.getByRole('button', { name: /Switch to/ })

    for (let i = 0; i < 20; i += 1) {
      await toggleButton.click()
      await page.waitForTimeout(800)
      const pos = await getScrollPositions(page)
      console.log(`After toggle ${i + 1}:`, pos)
    }

    console.log('noteId:', noteId)
  } finally {
    await browser.close()
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
