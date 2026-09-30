#!/usr/bin/env node
// Live-browser gate for the edit view's table input rules
// (src/editor/MarkdownTableTransforms.ts). The unit tests cover what each
// transform computes; this covers what the unit tests cannot see: that each
// rule is actually reached from the real key, click and toolbar paths, and
// that a tidy on Enter lands as its own undo step in CodeMirror's history.
//
// Drives the real editor with real key presses and clicks and asserts on
// the note text, read back from the editor's rendered lines.
import { chromium } from 'playwright'
import { existsSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { ensureEditMode, startDevServer, waitForAppReady } from './perfHarness.mjs'

function resolveChromiumExecutablePath() {
  const browsersRoot = process.env.PLAYWRIGHT_BROWSERS_PATH
  if (!browsersRoot || !existsSync(browsersRoot)) return undefined
  const chromiumDir = readdirSync(browsersRoot).find((name) => name.startsWith('chromium-'))
  if (!chromiumDir) return undefined
  const candidate = path.join(browsersRoot, chromiumDir, 'chrome-linux', 'chrome')
  return existsSync(candidate) ? candidate : undefined
}

let failures = 0
function check(cond, msg, detail) {
  console.log(`  ${cond ? 'ok' : 'FAIL'}: ${msg}`)
  if (!cond) {
    failures += 1
    if (detail !== undefined) console.log(`        got: ${JSON.stringify(detail)}`)
  }
}

const PORT = 5193
const server = await startDevServer(PORT)
const browser = await chromium.launch({ executablePath: resolveChromiumExecutablePath() })
try {
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })
  await page.goto(`http://localhost:${PORT}/`)
  await waitForAppReady(page)
  await page.evaluate(async () => {
    const note = await window.thockdownNotes.createNote({ initialText: '# Table test\n\nprose' })
    await window.thockdownSections.setActiveNote('default', note.id)
  })
  await page.reload()
  await waitForAppReady(page)
  const editable = await ensureEditMode(page)
  await page.waitForTimeout(500)

  const docText = () => page.$$eval('.cm-content .cm-line', (lines) => lines.map((line) => line.textContent).join('\n'))
  const tableText = async () => (await docText()).split('\n').filter((line) => line.startsWith('|')).join('\n')
  const settle = () => page.waitForTimeout(120)

  // Caret to the end of "prose".
  await editable.click()
  await page.keyboard.press('Control+End')
  await settle()

  // 1. The toolbar button starts a table on a new line below the text.
  await page.locator('button[aria-label="Table"]').click()
  await settle()
  check(await tableText() === '|   |', 'the table button inserts an empty cell', await docText())
  check(await page.locator('button[aria-label="Tidy table"]').count() === 1, 'inside a table the button offers to tidy')

  // 2. Typing fills the empty cell from its middle; Tab adds a cell.
  await page.keyboard.type('name')
  await page.keyboard.press('Tab')
  await page.keyboard.type('age')
  await settle()
  check(await tableText() === '| name | age |', 'typing fills cells, Tab adds one', await tableText())

  // 3. Enter on the header adds the divider and a new row.
  await page.keyboard.press('Enter')
  await settle()
  check(await tableText() === '| name | age |\n|------|-----|\n|   |', 'Enter on the header adds a divider and a row', await tableText())

  // 4. A short row is tidied to the table on Enter, as its own undo step.
  await page.keyboard.type('al')
  await page.keyboard.press('Enter')
  await settle()
  const expectedAfterRow = '| name | age |\n|------|-----|\n| al   |     |\n|   |'
  check(await tableText() === expectedAfterRow, 'Enter tidies the row just typed and starts another', await tableText())
  await page.keyboard.press('Control+z')
  await settle()
  check(await tableText() === '| name | age |\n|------|-----|\n| al   |     |', 'one undo removes the new row and keeps the tidy', await tableText())
  await page.keyboard.press('Control+z')
  await settle()
  check(await tableText() === '| name | age |\n|------|-----|\n| al |', 'a second undo takes back the tidy', await tableText())
  await page.keyboard.press('Control+y')
  await page.keyboard.press('Control+y')
  await settle()
  check(await tableText() === expectedAfterRow, 'redo restores both steps', await tableText())

  // 5. A wide cell stretches the whole table on Enter.
  await page.keyboard.type('bartholomew')
  await page.keyboard.press('Enter')
  await settle()
  check(
    await tableText() === '| name        | age |\n|-------------|-----|\n| al          |     |\n| bartholomew |     |\n|   |',
    'a row wider than its column re-tidies the whole table',
    await tableText(),
  )

  // 5b. Tab from a full row into the next one tidies the row it leaves, as
  //     its own undo step; Shift+Tab back into the previous row does the same.
  await page.keyboard.type('x')
  await page.keyboard.press('Tab')
  await page.keyboard.type('4')
  await page.keyboard.press('Tab')
  await settle()
  const afterTabTidy = '| name        | age |\n|-------------|-----|\n| al          |     |\n| bartholomew |     |\n| x           | 4   |\n|   |'
  check(await tableText() === afterTabTidy, 'Tab into a new row tidies the row it leaves', await tableText())
  await page.keyboard.type('y')
  await page.keyboard.press('Shift+Tab')
  await settle()
  check(
    (await tableText()).endsWith('| x           | 4   |\n| y           |     |'),
    'Shift+Tab into the previous row tidies the row it leaves',
    await tableText(),
  )
  await page.keyboard.press('Control+z')
  await settle()
  check((await tableText()).endsWith('| x           | 4   |\n| y |'), 'one undo takes back only the Shift+Tab tidy', await tableText())
  // Put the table back to one empty last row for what follows.
  await page.keyboard.press('Control+End')
  await page.keyboard.press('Shift+Home')
  await page.keyboard.press('Backspace')
  await page.keyboard.type('|   |')
  await page.keyboard.press('ArrowLeft')
  await page.keyboard.press('ArrowLeft')
  await page.keyboard.press('ArrowLeft')
  await settle()

  // 6. Enter in the empty last row ends the table.
  await page.keyboard.press('Enter')
  await settle()
  check(!(await docText()).includes('|   |'), 'Enter on an empty last row ends the table', await docText())
  await page.keyboard.type('after')
  await settle()
  check((await docText()).endsWith('| x           | 4   |\nafter'), 'typing continues below the table', await docText())

  // 7. Clicking the middle of the first divider cell centres that column;
  //    clicking it again resets it.
  const clickDividerAt = async (charIndex) => {
    const point = await page.evaluate((index) => {
      const line = [...document.querySelectorAll('.cm-content .cm-line')].find((el) => /^\|[:-]/.test(el.textContent))
      const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT)
      let remaining = index
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (remaining < node.length) {
          const range = document.createRange()
          range.setStart(node, remaining)
          range.setEnd(node, remaining + 1)
          const rect = range.getBoundingClientRect()
          return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
        }
        remaining -= node.length
      }
      return null
    }, charIndex)
    await page.mouse.click(point.x, point.y)
    await settle()
  }
  await clickDividerAt(7)
  check((await tableText()).split('\n')[1] === '|:-----------:|-----|', 'a click on the divider\'s middle centres the column', await tableText())
  await clickDividerAt(7)
  check((await tableText()).split('\n')[1] === '|-------------|-----|', 'a second click on the same part resets it', await tableText())
  await clickDividerAt(19)
  check((await tableText()).split('\n')[1] === '|-------------|----:|', 'a click on the right part aligns right', await tableText())

  // 8. Tab outside a table still indents.
  await page.keyboard.press('Control+End')
  await page.keyboard.press('Home')
  await page.keyboard.press('Tab')
  await settle()
  check((await docText()).endsWith('\n   after'), 'Tab outside a table indents as before', await docText())

  // 9. The checkbox toggle shares the click path the divider now uses: a
  //    first click on its box only places the caret, a second one toggles.
  await page.keyboard.press('Control+End')
  await page.keyboard.press('Enter')
  await page.keyboard.type('- [ ] task')
  await settle()
  const box = await page.evaluate(() => {
    const line = [...document.querySelectorAll('.cm-content .cm-line')].find((el) => el.textContent.includes('[ ] task'))
    const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT)
    let remaining = line.textContent.indexOf('[') + 1
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (remaining < node.length) {
        const range = document.createRange()
        range.setStart(node, remaining)
        range.setEnd(node, remaining + 1)
        const rect = range.getBoundingClientRect()
        return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
      }
      remaining -= node.length
    }
    return null
  })
  await page.mouse.click(box.x, box.y)
  await settle()
  check((await docText()).includes('- [ ] task'), 'a first click on a checkbox only places the caret', await docText())
  await page.mouse.click(box.x, box.y)
  await settle()
  check((await docText()).includes('- [X] task'), 'a second click on the caret toggles it', await docText())
} finally {
  await browser.close()
  await server.stop()
}
console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) failed`)
process.exit(failures === 0 ? 0 : 1)
