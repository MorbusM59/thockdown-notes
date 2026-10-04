import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { moveLegacyDevData } from './legacyDevDataMove'

describe('moveLegacyDevData', () => {
  let root: string
  let legacyDir: string
  let dataDir: string

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'thockdown-legacy-data-'))
    legacyDir = path.join(root, 'data')
    dataDir = path.join(root, 'apps', 'notes', 'data')
    mkdirSync(legacyDir, { recursive: true })
    mkdirSync(dataDir, { recursive: true })
    writeFileSync(path.join(dataDir, '.gitkeep'), '')
  })

  afterEach(() => rmSync(root, { recursive: true, force: true }))

  it('moves every entry, nested folders included, and removes the old folder', () => {
    writeFileSync(path.join(legacyDir, '.gitkeep'), '')
    writeFileSync(path.join(legacyDir, 'notes.db'), 'db')
    writeFileSync(path.join(legacyDir, 'notes.db-wal'), 'wal')
    mkdirSync(path.join(legacyDir, 'state'))
    writeFileSync(path.join(legacyDir, 'state', 'app.json'), '{}')

    const result = moveLegacyDevData(legacyDir, dataDir)

    expect(result).toEqual({ kind: 'moved', entries: expect.arrayContaining(['notes.db', 'notes.db-wal', 'state']) })
    expect(existsSync(legacyDir)).toBe(false)
    expect(readFileSync(path.join(dataDir, 'notes.db'), 'utf8')).toBe('db')
    expect(readFileSync(path.join(dataDir, 'notes.db-wal'), 'utf8')).toBe('wal')
    expect(readFileSync(path.join(dataDir, 'state', 'app.json'), 'utf8')).toBe('{}')
    expect(existsSync(path.join(dataDir, '.gitkeep'))).toBe(true)
  })

  it('never touches either folder when both hold data', () => {
    writeFileSync(path.join(legacyDir, 'notes.db'), 'old')
    writeFileSync(path.join(dataDir, 'notes.db'), 'new')

    expect(moveLegacyDevData(legacyDir, dataDir)).toEqual({ kind: 'both-hold-data', legacyDir })
    expect(readFileSync(path.join(legacyDir, 'notes.db'), 'utf8')).toBe('old')
    expect(readFileSync(path.join(dataDir, 'notes.db'), 'utf8')).toBe('new')
  })

  it('does nothing when the old folder is missing or holds only the placeholder', () => {
    writeFileSync(path.join(legacyDir, '.gitkeep'), '')
    expect(moveLegacyDevData(legacyDir, dataDir)).toEqual({ kind: 'nothing-to-move' })
    expect(readdirSync(legacyDir)).toEqual(['.gitkeep'])

    rmSync(legacyDir, { recursive: true })
    expect(moveLegacyDevData(legacyDir, dataDir)).toEqual({ kind: 'nothing-to-move' })
  })

  it('is a fixed point: a second run after a move does nothing', () => {
    writeFileSync(path.join(legacyDir, 'notes.db'), 'db')
    moveLegacyDevData(legacyDir, dataDir)
    expect(moveLegacyDevData(legacyDir, dataDir)).toEqual({ kind: 'nothing-to-move' })
    expect(readFileSync(path.join(dataDir, 'notes.db'), 'utf8')).toBe('db')
  })
})
