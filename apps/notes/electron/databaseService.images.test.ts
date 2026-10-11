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

  it('rebuilds the index at startup for notes saved before it existed', async () => {
    const note = await lifecycle.createNote({ initialText: '![x](&7)' })
    db.setAppMeta('imageRefsScannerVersion', '0')
    db.close()
    await launch()
    expect(db.listImageReferences(note.id)).toEqual(['&7'])
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

  it('lists images with their tags and use, and archives by derivation', async () => {
    db.importImage({ bytes: GIF, origin: '/a.gif' })
    db.importImage({ bytes: OTHER_GIF, origin: null })
    await lifecycle.createNote({ initialText: '![x](&2)' })
    expect(db.setImageTags('&1', ['Cats', 'cats', 'archived', 'big one'])).toEqual(['cats', 'big-one'])
    const byId = Object.fromEntries(db.listImages().map((image) => [image.id, image]))
    expect(byId['&1']).toMatchObject({ tags: ['cats', 'big-one'], useCount: 0, trashedAt: null, origin: '/a.gif', width: 3, height: 2 })
    expect(byId['&2']).toMatchObject({ tags: [], useCount: 1 })
  })

  it('trashes, restores and purges, keeping bytes another name still uses', () => {
    db.importImage({ bytes: GIF, origin: '/a.gif' })
    db.importImage({ bytes: GIF, origin: null })
    db.setImageTags('&1', ['cats'])
    expect(db.purgeImage('&1')).toBe(false)
    db.setImageTrashed('&1', true)
    expect(db.listImages().find((image) => image.id === '&1')?.trashedAt).not.toBeNull()
    db.setImageTrashed('&1', false)
    expect(db.listImages().find((image) => image.id === '&1')?.trashedAt).toBeNull()
    db.setImageTrashed('&1', true)
    expect(db.purgeImage('&1')).toBe(true)
    expect(db.listImages().map((image) => image.id)).toEqual(['&2'])
    expect(db.resolveImages(['&2'])['&2']).not.toBeNull()
    db.setImageTrashed('&2', true)
    db.purgeImage('&2')
    expect(db.listImages()).toEqual([])
  })

  it('renames an image everywhere but open notes, and the old name resolves through an alias', async () => {
    db.importImage({ bytes: GIF, origin: '/a.gif' })
    db.setImageTags('&1', ['cats'])
    db.setImageTrashed('&1', true)
    const shut = await lifecycle.createNote({ initialText: '# A\n\n![a](&1 "12em") and ![b](&1)' })
    const open = await lifecycle.createNote({ initialText: '![c](&1)' })
    expect(db.renameImage({ id: '&1', newId: '&logo', openNoteIds: [open.id] }))
      .toEqual({ ok: true, id: '&LOGO', rewrittenNoteIds: [shut.id] })
    expect((await lifecycle.loadNote({ id: shut.id })).text).toBe('# A\n\n![a](&LOGO "12em") and ![b](&LOGO)')
    expect(db.listImageReferences(shut.id)).toEqual(['&LOGO'])
    expect(db.listImages()[0]).toMatchObject({ id: '&LOGO', tags: ['cats'] })
    expect(db.listImages()[0].trashedAt).not.toBeNull()
    expect(db.resolveImages(['&1'])['&1']).toEqual(db.resolveImages(['&LOGO'])['&LOGO'])
    // A new image named like the alias takes the name back.
    db.importImage({ bytes: OTHER_GIF, origin: null, requestedId: '&1' })
    expect(db.resolveImages(['&1'])['&1']?.hash).not.toBe(db.resolveImages(['&LOGO'])['&LOGO']?.hash)
    expect(db.renameImage({ id: '&LOGO', newId: '&1', openNoteIds: [] })).toEqual({ ok: false, reason: 'taken' })
    expect(db.renameImage({ id: '&LOGO', newId: 'nope', openNoteIds: [] })).toEqual({ ok: false, reason: 'invalid' })
  })

  it('counts uses through old names, and will not purge an image a note uses', async () => {
    db.importImage({ bytes: GIF, origin: null })
    await lifecycle.createNote({ initialText: '![a](&1)' })
    // Kept open, so the stored text still says &1.
    const open = await lifecycle.createNote({ initialText: '![b](&1)' })
    db.renameImage({ id: '&1', newId: '&CAT', openNoteIds: [open.id] })
    expect(db.listImages()[0]).toMatchObject({ id: '&CAT', useCount: 2 })
    db.setImageTrashed('&CAT', true)
    expect(db.purgeImage('&CAT')).toBe(false)
    expect(db.listImages()).toHaveLength(1)
  })
})
