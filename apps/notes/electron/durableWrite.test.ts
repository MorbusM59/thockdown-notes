import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { chmodSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { writeFileDurably } from './durableWrite'

describe('writeFileDurably', () => {
  let directory: string
  beforeEach(() => { directory = mkdtempSync(path.join(tmpdir(), 'thockdown-durable-')) })
  afterEach(() => { rmSync(directory, { recursive: true, force: true }) })

  it('creates a file, replaces it, and leaves nothing else behind', async () => {
    const file = path.join(directory, 'a.md')
    await writeFileDurably(file, 'one')
    await writeFileDurably(file, 'two')
    expect(readFileSync(file, 'utf8')).toBe('two')
    expect(readdirSync(directory)).toEqual(['a.md'])
  })

  it.skipIf(process.platform === 'win32')('keeps the replaced file\'s permissions', async () => {
    const file = path.join(directory, 'a.md')
    writeFileSync(file, 'one')
    chmodSync(file, 0o600)
    await writeFileDurably(file, 'two')
    expect(statSync(file).mode & 0o777).toBe(0o600)
  })
})
