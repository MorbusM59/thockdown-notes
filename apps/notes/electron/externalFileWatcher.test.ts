import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { ExternalFileWatcher } from './externalFileWatcher'

// Real file system events, so each wait is for an event the OS delivers.
function nextReport(reports: string[], count: number, timeoutMs = 3000): Promise<void> {
  return new Promise((resolve, reject) => {
    const started = Date.now()
    const check = () => {
      if (reports.length >= count) resolve()
      else if (Date.now() - started > timeoutMs) reject(new Error(`expected ${count} reports, got ${reports.length}`))
      else setTimeout(check, 20)
    }
    check()
  })
}

const quiet = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

describe('ExternalFileWatcher', () => {
  let directory: string
  let reports: string[]
  let watcher: ExternalFileWatcher

  beforeEach(() => {
    directory = mkdtempSync(path.join(tmpdir(), 'thockdown-watch-test-'))
    reports = []
    watcher = new ExternalFileWatcher((noteId) => reports.push(noteId), 50)
  })

  afterEach(() => {
    watcher.dispose()
    rmSync(directory, { recursive: true, force: true })
  })

  it('reports a write to a watched file once, after its events settle', async () => {
    const file = path.join(directory, 'a.md')
    writeFileSync(file, 'one')
    watcher.setWatched([{ noteId: 'n', filePath: file }])
    writeFileSync(file, 'two')
    writeFileSync(file, 'three')
    await nextReport(reports, 1)
    await quiet(200)
    expect(reports).toEqual(['n'])
  })

  it('keeps reporting after a save that renames a new file over the old one', async () => {
    const file = path.join(directory, 'a.md')
    writeFileSync(file, 'one')
    watcher.setWatched([{ noteId: 'n', filePath: file }])
    for (const text of ['two', 'three']) {
      const temporary = path.join(directory, `.a.md.${text}`)
      writeFileSync(temporary, text)
      renameSync(temporary, file)
      await nextReport(reports, reports.length + 1)
      await quiet(120)
    }
    expect(reports.every((noteId) => noteId === 'n')).toBe(true)
    expect(reports.length).toBeGreaterThanOrEqual(2)
  })

  it('ignores other files in the directory and stops when unwatched', async () => {
    const file = path.join(directory, 'a.md')
    writeFileSync(file, 'one')
    watcher.setWatched([{ noteId: 'n', filePath: file }])
    writeFileSync(path.join(directory, 'other.md'), 'x')
    await quiet(200)
    expect(reports).toEqual([])
    watcher.setWatched([])
    writeFileSync(file, 'two')
    await quiet(200)
    expect(reports).toEqual([])
  })
})
