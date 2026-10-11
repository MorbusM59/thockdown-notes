import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { DatabaseService } from './databaseService'
import { NoteLifecycleService } from './noteLifecycleService'

const GIF = Uint8Array.from([...'GIF89a'].map((c) => c.charCodeAt(0)).concat([3, 0, 2, 0, 0, 0, 0]))
const OTHER_GIF = Uint8Array.from([...GIF.slice(0, 10), 1, 1, 1])

describe('stored images', () => {
  let dataRoot: string
  let db: DatabaseService
  let lifecycle: NoteLifecycleService
  const launch = async () => {
    db = new DatabaseService(dataRoot)
    await db.initialize()
    lifecycle = new NoteLifecycleService(db)
  }

  beforeEach(async () => {
    dataRoot = mkdtempSync(path.join(tmpdir(), 'thockdown-images-test-'))
    await launch()
  })
  afterEach(() => {
    db.close()
    rmSync(dataRoot, { recursive: true, force: true })
  })

  it('stores an image under the next automatic id, reusing it for the same file', () => {
    expect(db.importImage({ bytes: GIF, origin: '/a.gif' })).toEqual({ ok: true, id: '&1' })
    expect(db.importImage({ bytes: GIF, origin: '/a.gif' })).toEqual({ ok: true, id: '&1' })
    expect(db.importImage({ bytes: GIF, origin: null })).toEqual({ ok: true, id: '&2' })
    expect(db.importImage({ bytes: OTHER_GIF, origin: '/a.gif' })).toEqual({ ok: true, id: '&3' })
    const resolved = db.resolveImages(['&1', '&2', '&9'])
    expect(resolved['&1']).toMatchObject({ width: 3, height: 2 })
    expect(resolved['&1']!.hash).toBe(resolved['&2']!.hash)
    expect(resolved['&9']).toBeNull()
    expect(db.readImageBlob(resolved['&1']!.hash)?.mime).toBe('image/gif')
  })

  it('refuses what is not an image', () => {
    expect(db.importImage({ bytes: new TextEncoder().encode('# a note'), origin: null })).toEqual({ ok: false, reason: 'not-an-image' })
  })

  it('indexes which images a note uses on every save, and survives a restart', async () => {
    const note = await lifecycle.createNote({ initialText: '# A\n\n![x](&1) ![y](&logo "12em") ![z](https://e.com/z.png)' })
    expect(db.listImageReferences(note.id)).toEqual(['&1', '&LOGO'])
    await lifecycle.saveNote({ id: note.id, text: '# A\n\nnone' })
    expect(db.listImageReferences(note.id)).toEqual([])
    await lifecycle.saveNote({ id: note.id, text: '# A\n\n![x](&2)' })
    db.close()
    await launch()
    expect(db.listImageReferences(note.id)).toEqual(['&2'])
  })
})
