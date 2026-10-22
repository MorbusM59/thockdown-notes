import { describe, expect, it } from 'vitest'
import { installExternalFileSync } from './externalFileSync'
import { createNoteDocumentStore, type NoteDocumentEvent } from './noteDocumentStore'
import type { NoteSummaryWithContent } from '../shared/noteLifecycle'

/**
 * A note database and a file system in memory, around a real document store.
 * The database's clean/unsaved rule is the main process's: a save is clean
 * exactly when it equals the newest from-disk snapshot.
 */
function createWorld() {
  const files = new Map<string, string>()
  const db = new Map<string, { text: string; fromDisk: string[]; unsaved: boolean }>()
  const watched: string[][] = []
  const fileListeners = new Set<(noteId: string) => void>()
  let beforeSnapshotLands: (() => void) | null = null

  const save = (noteId: string, text: string) => {
    const row = db.get(noteId)!
    row.text = text
    row.unsaved = row.fromDisk.at(-1) !== text
  }

  const noteDocuments = createNoteDocumentStore({
    setTimer: () => 0,
    clearTimer: () => {},
    persist: async (noteId, text) => save(noteId, text),
  })

  const summaries: Array<{ id: string; text: string }> = []
  const baselines = new Map<string, string>()
  const stop = installExternalFileSync({
    noteDocuments,
    externalFiles: {
      watchNoteFiles: async (noteIds) => { watched.push(noteIds.filter((noteId) => files.has(noteId))) },
      readNoteFile: async (noteId) => (files.has(noteId) ? { content: files.get(noteId)!, modifiedAtMs: 1_000 } : null),
      onNoteFileChanged: (callback) => {
        fileListeners.add(callback)
        return () => fileListeners.delete(callback)
      },
    },
    notes: {
      getFromDiskBaseline: async ({ id }) => {
        const content = db.get(id)?.fromDisk.at(-1)
        return content === undefined ? null : { content, timestamp: '' }
      },
      saveNoteSnapshot: async ({ id, content, isFromDisk }) => {
        beforeSnapshotLands?.()
        if (isFromDisk) db.get(id)!.fromDisk.push(content)
        return 1
      },
      updateExternalNoteState: async ({ id, hasUnsavedChanges }) => {
        db.get(id)!.unsaved = hasUnsavedChanges
        return { id } as NoteSummaryWithContent
      },
    },
    onBaseline: (noteId, text) => baselines.set(noteId, text),
    onSummary: (summary, text) => summaries.push({ id: summary.id, text }),
  })

  const events: NoteDocumentEvent[] = []
  const open = (noteId: string, viewId = 'a') => {
    const row = db.get(noteId)!
    const shown = noteDocuments.bind(viewId, noteDocuments.beginLoad(noteId), row.text, (event) => events.push(event))
    return shown
  }
  const settle = async () => {
    for (let i = 0; i < 20; i += 1) await new Promise((resolve) => setTimeout(resolve, 0))
  }
  const fileChanged = (noteId: string, text: string) => {
    files.set(noteId, text)
    for (const listener of fileListeners) listener(noteId)
  }
  const external = (noteId: string, text: string) => {
    files.set(noteId, text)
    db.set(noteId, { text, fromDisk: [text], unsaved: false })
  }
  const type = (noteId: string, viewId: string, text: string) => {
    noteDocuments.publish(viewId, text)
    save(noteId, text)
  }

  return {
    noteDocuments, files, db, watched, baselines, summaries, events, stop,
    open, settle, fileChanged, external, type,
    holdSnapshot: (callback: (() => void) | null) => { beforeSnapshotLands = callback },
  }
}

describe('installExternalFileSync', () => {
  it('takes the file\'s new text into a note the reader has not edited', async () => {
    const world = createWorld()
    world.external('n', 'from file')
    world.open('n')
    await world.settle()
    world.fileChanged('n', 'edited elsewhere')
    await world.settle()
    expect(world.noteDocuments.read('n')).toBe('edited elsewhere')
    expect(world.db.get('n')).toMatchObject({ text: 'edited elsewhere', unsaved: false })
    expect(world.db.get('n')!.fromDisk).toEqual(['from file', 'edited elsewhere'])
    expect(world.baselines.get('n')).toBe('edited elsewhere')
  })

  it('keeps the reader\'s edits when the file changed too, with the file on the Timeline and the note unsaved', async () => {
    const world = createWorld()
    world.external('n', 'from file')
    world.open('n')
    await world.settle()
    world.type('n', 'a', 'from file + mine')
    world.fileChanged('n', 'edited elsewhere')
    await world.settle()
    expect(world.noteDocuments.read('n')).toBe('from file + mine')
    expect(world.db.get('n')).toMatchObject({ text: 'from file + mine', unsaved: true })
    expect(world.db.get('n')!.fromDisk.at(-1)).toBe('edited elsewhere')
  })

  it('treats typing that lands while the file is being recorded as an edit, never overwriting it', async () => {
    const world = createWorld()
    world.external('n', 'from file')
    world.open('n')
    await world.settle()
    world.holdSnapshot(() => {
      world.holdSnapshot(null)
      world.type('n', 'a', 'from file!')
    })
    world.fileChanged('n', 'edited elsewhere')
    await world.settle()
    expect(world.noteDocuments.read('n')).toBe('from file!')
    expect(world.db.get('n')!.unsaved).toBe(true)
  })

  it('marks the note clean when the file now holds exactly the note\'s text', async () => {
    const world = createWorld()
    world.external('n', 'from file')
    world.open('n')
    await world.settle()
    world.type('n', 'a', 'saved by us')
    world.fileChanged('n', 'saved by us')
    await world.settle()
    expect(world.db.get('n')!.unsaved).toBe(false)
    expect(world.summaries).toEqual([{ id: 'n', text: 'saved by us' }])
  })

  it('reconciles a note when it opens, catching changes made while it was closed', async () => {
    const world = createWorld()
    world.external('n', 'from file')
    world.files.set('n', 'changed while closed')
    world.open('n')
    await world.settle()
    expect(world.noteDocuments.read('n')).toBe('changed while closed')
  })

  it('does nothing when the file is unchanged, unreadable, or the note is not external', async () => {
    const world = createWorld()
    world.external('n', 'from file')
    world.db.set('plain', { text: 'plain', fromDisk: [], unsaved: false })
    world.open('n', 'a')
    world.open('plain', 'b')
    await world.settle()
    world.fileChanged('n', 'from file')
    world.files.delete('n')
    world.fileChanged('plain', 'x')
    world.files.delete('plain')
    await world.settle()
    expect(world.db.get('n')!.fromDisk).toEqual(['from file'])
    expect(world.events).toEqual([])
  })

  it('watches exactly the open external notes, and ignores reports for closed ones', async () => {
    const world = createWorld()
    world.external('n', 'from file')
    world.open('n')
    await world.settle()
    expect(world.watched.at(-1)).toEqual(['n'])
    world.noteDocuments.unbind('a')
    await world.settle()
    expect(world.watched.at(-1)).toEqual([])
    world.fileChanged('n', 'edited elsewhere')
    await world.settle()
    expect(world.db.get('n')!.fromDisk).toEqual(['from file'])
  })

  it('stops entirely when uninstalled', async () => {
    const world = createWorld()
    world.external('n', 'from file')
    world.stop()
    world.open('n')
    world.fileChanged('n', 'edited elsewhere')
    await world.settle()
    expect(world.noteDocuments.read('n')).toBe('from file')
  })
})
