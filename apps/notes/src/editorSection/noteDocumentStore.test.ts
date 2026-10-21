import { describe, expect, it } from 'vitest'
import { createNoteDocumentStore, type NoteDocumentEvent, type NoteDocumentStore } from './noteDocumentStore'
import type { EditorTextEdit } from '../editor/EditorContract'

/**
 * A deterministic world around the store: timers that fire only when told,
 * a database whose reads and writes complete in an order the test chooses
 * (the IPC is asynchronous, and the ordering hazards are exactly what is
 * under test), and views that apply what they are handed the way an editor
 * does -- the edit when there is one, the text otherwise.
 */
function createWorld(seed = 1, withPersist = false) {
  let random = seed >>> 0
  const nextRandom = () => {
    random = (random * 1664525 + 1013904223) >>> 0
    return random / 2 ** 32
  }

  const timers = new Map<number, () => void>()
  let nextTimer = 1
  const store = createNoteDocumentStore({
    setTimer: (callback) => {
      const id = nextTimer++
      timers.set(id, callback)
      return id
    },
    clearTimer: (handle) => { timers.delete(handle as number) },
    persist: withPersist ? (noteId, text) => write(noteId)(text) : undefined,
  })

  /** What the database holds, and every value it ever held, in order. */
  const db = new Map<string, string>()
  const dbHistory: string[] = []
  /** Requests that reached the "main process" but whose answers have not been delivered. */
  const pendingAnswers: Array<() => void> = []

  const write = (noteId: string) => (text: string) => new Promise<void>((resolve) => {
    // The request's effect on the database happens when it arrives, which
    // may be later than the call (a writer awaits other work first).
    pendingAnswers.push(() => {
      db.set(noteId, text)
      dbHistory.push(text)
      resolve()
    })
  })

  const load = (noteId: string) => new Promise<string>((resolve) => {
    pendingAnswers.push(() => resolve(db.get(noteId) ?? ''))
  })

  /** Lets every queued request through, in a random order, and every promise run. */
  const settle = async () => {
    for (let guard = 0; guard < 1000; guard += 1) {
      await Promise.resolve()
      await Promise.resolve()
      if (pendingAnswers.length === 0) {
        await new Promise((resolve) => setTimeout(resolve, 0))
        if (pendingAnswers.length === 0) return
      }
      const index = Math.floor(nextRandom() * pendingAnswers.length)
      pendingAnswers.splice(index, 1)[0]()
    }
    throw new Error('world did not settle')
  }

  const fireTimers = () => {
    const due = [...timers.entries()]
    timers.clear()
    for (const [, callback] of due) callback()
  }

  return { store, db, dbHistory, write, load, settle, fireTimers, nextRandom, pendingAnswers, timers }
}

interface View {
  id: string
  noteId: string | null
  text: string
  events: NoteDocumentEvent[]
}

function bound(store: NoteDocumentStore, ...args: Parameters<NoteDocumentStore['bind']>): string {
  const text = store.bind(...args)
  if (text === null) throw new Error('bind declined')
  return text
}

function applyEdit(text: string, edit: EditorTextEdit): string {
  return text.slice(0, edit.from) + edit.insert + text.slice(edit.to)
}

function attachView(view: View) {
  return (event: NoteDocumentEvent) => {
    view.events.push(event)
    if (event.kind === 'change') {
      const { previousText, text, edit } = event.change
      if (edit) {
        // A view applies an edit to what it holds; it must hold what the edit is against.
        expect(view.text).toBe(previousText)
        view.text = applyEdit(view.text, edit)
        expect(view.text).toBe(text)
      } else {
        view.text = text
      }
    }
    if (event.kind === 'removed') {
      view.noteId = null
      view.text = ''
    }
  }
}

async function open(world: ReturnType<typeof createWorld>, view: View, noteId: string) {
  const load = world.store.beginLoad(noteId)
  const loaded = await world.load(noteId)
  view.text = bound(world.store, view.id, load, loaded, attachView(view))
  view.noteId = noteId
}

function type(world: ReturnType<typeof createWorld>, view: View, insert: string, at?: number) {
  const position = at ?? view.text.length
  const edit = { from: position, to: position, insert }
  const previousText = view.text
  view.text = applyEdit(previousText, edit)
  world.store.publish(view.id, view.text, { previousText, edit })
  world.store.scheduleSave(view.id, world.write(view.noteId!))
}

function newView(id: string): View {
  return { id, noteId: null, text: '', events: [] }
}

describe('noteDocumentStore', () => {
  it('reproduces the reported loss as fixed: typing alternately in two views of one note keeps both', async () => {
    const world = createWorld()
    world.db.set('n', 'start\n')
    const a = newView('a')
    const b = newView('b')
    const opening = Promise.all([open(world, a, 'n'), open(world, b, 'n')])
    await world.settle()
    await opening

    type(world, a, 'AAA')
    type(world, b, 'BBB')
    type(world, a, 'CCC')
    world.fireTimers()
    await world.settle()

    expect(a.text).toBe('start\nAAABBBCCC')
    expect(b.text).toBe('start\nAAABBBCCC')
    expect(world.db.get('n')).toBe('start\nAAABBBCCC')
  })

  it('hands a change to the other views only, with the edit that made it', () => {
    const world = createWorld()
    const a = newView('a')
    const b = newView('b')
    const loadA = world.store.beginLoad('n')
    a.text = bound(world.store, 'a', loadA, 'hello', attachView(a))
    const loadB = world.store.beginLoad('n')
    b.text = bound(world.store, 'b', loadB, 'hello', attachView(b))
    a.noteId = 'n'
    b.noteId = 'n'

    type(world, a, '!', 5)
    expect(a.events).toEqual([])
    expect(b.events).toEqual([{ kind: 'change', change: { previousText: 'hello', text: 'hello!', edit: { from: 5, to: 5, insert: '!' } } }])
  })

  it('drops an edit that does not follow on from what the views hold', () => {
    const world = createWorld()
    const a = newView('a')
    const b = newView('b')
    a.text = bound(world.store, 'a', world.store.beginLoad('n'), 'one', attachView(a))
    b.text = bound(world.store, 'b', world.store.beginLoad('n'), 'one', attachView(b))
    // A view that claims to have edited a text nobody else holds.
    world.store.publish('a', 'two!', { previousText: 'two', edit: { from: 3, to: 3, insert: '!' } })
    expect(b.events.at(-1)).toEqual({ kind: 'change', change: { previousText: 'one', text: 'two!', edit: null } })
    expect(b.text).toBe('two!')
  })

  it('opens an already open note on its live text, not on the database behind it', async () => {
    const world = createWorld()
    world.db.set('n', 'saved')
    const a = newView('a')
    const opening = open(world, a, 'n')
    await world.settle()
    await opening
    type(world, a, ' and typed')

    const b = newView('b')
    const openingB = open(world, b, 'n')
    await world.settle()
    await openingB
    expect(b.text).toBe('saved and typed')
  })

  it('adopts a database text the main process changed when nothing is unsaved (a regenerated chapter)', async () => {
    const world = createWorld()
    world.db.set('toc', 'old contents')
    const a = newView('a')
    const opening = open(world, a, 'toc')
    await world.settle()
    await opening

    world.db.set('toc', 'regenerated')
    const b = newView('b')
    const openingB = open(world, b, 'toc')
    await world.settle()
    await openingB
    expect(b.text).toBe('regenerated')
    expect(a.text).toBe('regenerated')
  })

  it('never adopts a load that began before a write it may have missed', async () => {
    const world = createWorld()
    world.db.set('n', 'v0')
    const a = newView('a')
    const opening = open(world, a, 'n')
    await world.settle()
    await opening

    type(world, a, '1')
    world.fireTimers()
    // The write is started but has not reached the database; a load begins now.
    const b = newView('b')
    const load = world.store.beginLoad('n')
    const loaded = world.load('n')
    // The load is answered first (it read v0), then the write lands.
    world.pendingAnswers.splice(0, world.pendingAnswers.length).reverse().forEach((answer) => answer())
    await world.settle()
    b.text = bound(world.store, 'b', load, await loaded, attachView(b))
    expect(b.text).toBe('v01')
    expect(a.text).toBe('v01')
  })

  it('keeps a closed note open while a load of it is in progress, so the reopen sees its last text', async () => {
    const world = createWorld()
    world.db.set('n', 'v0')
    const a = newView('a')
    const opening = open(world, a, 'n')
    await world.settle()
    await opening
    type(world, a, 'X')

    // b starts loading; the read happens before a's write reaches the database.
    const b = newView('b')
    const load = world.store.beginLoad('n')
    const loaded = world.load('n')
    world.pendingAnswers.shift()!()
    // a leaves the note; its save is still pending.
    world.store.unbind('a')
    world.fireTimers()
    await world.settle()

    b.text = bound(world.store, 'b', load, await loaded, attachView(b))
    expect(await loaded).toBe('v0')
    expect(b.text).toBe('v0X')
  })

  it('writes the text current when the write starts, so a slow write never carries an older text', async () => {
    const world = createWorld()
    const a = newView('a')
    a.text = bound(world.store, 'a', world.store.beginLoad('n'), '', attachView(a))
    a.noteId = 'n'
    type(world, a, 'one')
    const flushing = world.store.flushSave('n')
    type(world, a, ' two')
    world.fireTimers()
    await world.settle()
    await flushing
    // The flushed write had not started when ' two' was typed, so it wrote
    // the text current when it did start, and the debounced one behind it
    // found nothing new to write.
    expect(world.dbHistory).toEqual(['one two'])
  })

  it('does not write the same text twice when two views ask for the same save', async () => {
    const world = createWorld()
    const a = newView('a')
    const b = newView('b')
    a.text = bound(world.store, 'a', world.store.beginLoad('n'), '', attachView(a))
    b.text = bound(world.store, 'b', world.store.beginLoad('n'), '', attachView(b))
    a.noteId = 'n'
    b.noteId = 'n'
    type(world, a, 'x')
    void world.store.flushSave('n')
    await world.settle()
    world.store.scheduleSave('b', world.write('n'))
    world.fireTimers()
    await world.settle()
    expect(world.dbHistory).toEqual(['x'])
  })

  it('tells the other views a save completed', async () => {
    const world = createWorld()
    const a = newView('a')
    const b = newView('b')
    a.text = bound(world.store, 'a', world.store.beginLoad('n'), '', attachView(a))
    b.text = bound(world.store, 'b', world.store.beginLoad('n'), '', attachView(b))
    a.noteId = 'n'
    type(world, a, 'x')
    world.fireTimers()
    await world.settle()
    expect(b.events.map((event) => event.kind)).toEqual(['change', 'saved'])
    expect(a.events).toEqual([])
  })

  it('removes a deleted note: its views are told and nothing pending is written', async () => {
    const world = createWorld()
    const a = newView('a')
    const b = newView('b')
    a.text = bound(world.store, 'a', world.store.beginLoad('n'), 'text', attachView(a))
    b.text = bound(world.store, 'b', world.store.beginLoad('n'), 'text', attachView(b))
    a.noteId = 'n'
    b.noteId = 'n'
    type(world, a, '!')
    world.store.remove('n')
    world.fireTimers()
    await world.settle()
    expect(world.dbHistory).toEqual([])
    expect(a.events.at(-1)).toEqual({ kind: 'removed' })
    expect(b.events.at(-1)).toEqual({ kind: 'removed' })
    expect(world.store.read('n')).toBeNull()
    expect(world.store.boundNoteOf('a')).toBeNull()
  })

  it('a removal stops a write that was queued behind another', async () => {
    const world = createWorld()
    const a = newView('a')
    a.text = bound(world.store, 'a', world.store.beginLoad('n'), '', attachView(a))
    a.noteId = 'n'
    type(world, a, 'first')
    void world.store.flushSave('n')
    // The first write has started (its writer was called); the second waits behind it.
    await Promise.resolve()
    await Promise.resolve()
    type(world, a, ' second')
    void world.store.flushSave('n')
    world.store.remove('n')
    await world.settle()
    expect(world.dbHistory).toEqual(['first'])
  })

  it('a view bound to a second note is no longer a view of the first', () => {
    const world = createWorld()
    const a = newView('a')
    const b = newView('b')
    a.text = bound(world.store, 'a', world.store.beginLoad('n'), 'n', attachView(a))
    b.text = bound(world.store, 'b', world.store.beginLoad('n'), 'n', attachView(b))
    bound(world.store, 'b', world.store.beginLoad('m'), 'm', attachView(b))
    b.events.length = 0
    world.store.publish('a', 'n!')
    expect(b.events).toEqual([])
    expect(world.store.boundNoteOf('b')).toBe('m')
  })

  it('drops a document nobody needs, and keeps one whose write is still running', async () => {
    const world = createWorld()
    const a = newView('a')
    a.text = bound(world.store, 'a', world.store.beginLoad('n'), '', attachView(a))
    a.noteId = 'n'
    type(world, a, 'x')
    world.store.unbind('a')
    expect(world.store.read('n')).toBe('x')
    world.fireTimers()
    expect(world.store.read('n')).toBe('x')
    await world.settle()
    expect(world.store.read('n')).toBeNull()
    expect(world.db.get('n')).toBe('x')
  })

  it('a released load that never bound does not keep the note open', () => {
    const world = createWorld()
    const a = newView('a')
    a.text = bound(world.store, 'a', world.store.beginLoad('n'), 'x', attachView(a))
    const abandoned = world.store.beginLoad('n')
    world.store.unbind('a')
    expect(world.store.read('n')).toBe('x')
    abandoned.release()
    abandoned.release()
    expect(world.store.read('n')).toBeNull()
  })

  // The property: whatever views do, in whatever order the database answers,
  // every view shows the document, and once everything settles the database
  // holds the last text anybody typed -- no edit is ever lost or reverted.
  it('holds every view on the document and loses no edit, over random interleavings', async () => {
    for (let seed = 1; seed <= 60; seed += 1) {
      const world = createWorld(seed)
      world.db.set('n', '')
      const views = [newView('a'), newView('b'), newView('c')]
      let lastTyped = ''
      let typedCount = 0
      const openings: Promise<void>[] = []

      for (let step = 0; step < 80; step += 1) {
        const roll = world.nextRandom()
        const view = views[Math.floor(world.nextRandom() * views.length)]
        if (view.noteId === null) {
          // Opening is asynchronous: other views keep typing while it loads.
          view.noteId = 'opening'
          openings.push(open(world, view, 'n'))
        } else if (view.noteId === 'opening') {
          // still loading
        } else if (roll < 0.6) {
          const at = Math.floor(world.nextRandom() * (view.text.length + 1))
          type(world, view, String.fromCharCode(97 + (typedCount % 26)), at)
          typedCount += 1
          lastTyped = view.text
        } else if (roll < 0.7) {
          world.store.unbind(view.id)
          view.noteId = null
        } else if (roll < 0.8) {
          void world.store.flushSave('n')
        } else if (roll < 0.9) {
          world.fireTimers()
        } else if (world.pendingAnswers.length > 0) {
          const index = Math.floor(world.nextRandom() * world.pendingAnswers.length)
          world.pendingAnswers.splice(index, 1)[0]()
          await Promise.resolve()
          await Promise.resolve()
        }

        const live = world.store.read('n')
        for (const other of views) {
          if (other.noteId === 'n') expect(other.text, `seed ${seed} step ${step}`).toBe(live)
        }
      }

      await world.settle()
      await Promise.all(openings)
      world.fireTimers()
      await world.settle()

      const live = world.store.read('n')
      for (const view of views) {
        if (view.noteId === 'n') expect(view.text, `seed ${seed}`).toBe(live)
      }
      if (typedCount > 0) {
        expect(world.db.get('n'), `seed ${seed}`).toBe(lastTyped)
        if (live !== null) expect(live, `seed ${seed}`).toBe(lastTyped)
      }
    }
  })

  it('applies an outside change to every view and writes it at once, not after the debounce', async () => {
    const world = createWorld(3, true)
    world.db.set('n', 'body')
    const a = newView('a')
    const b = newView('b')
    const opening = Promise.all([open(world, a, 'n'), open(world, b, 'n')])
    await world.settle()
    await opening

    expect(world.store.change('n', (text) => `${text}+merged`)).toBe(true)
    expect(a.text).toBe('body+merged')
    expect(b.text).toBe('body+merged')
    expect(world.timers.size).toBe(0)
    const flushed = world.store.flushSave('n')
    await world.settle()
    await flushed
    expect(world.db.get('n')).toBe('body+merged')
  })

  it('declines an outside change to a note nobody has open, so the caller writes the database', () => {
    const world = createWorld(4, true)
    expect(world.store.change('closed', (text) => `${text}!`)).toBe(false)
    expect(world.store.openNoteIds()).toEqual([])
  })

  it('an outside change that changes nothing writes nothing', async () => {
    const world = createWorld(5, true)
    world.db.set('n', 'same')
    const a = newView('a')
    const opening = open(world, a, 'n')
    await world.settle()
    await opening
    expect(world.store.change('n', (text) => text)).toBe(true)
    await world.settle()
    expect(world.dbHistory).toEqual([])
    expect(a.events).toEqual([])
  })

  it('an outside change while a view has typing queued writes the newest text once', async () => {
    const world = createWorld(6, true)
    world.db.set('n', 'a')
    const a = newView('a')
    const opening = open(world, a, 'n')
    await world.settle()
    await opening
    type(world, a, 'b')
    world.store.change('n', (text) => `${text}c`)
    expect(a.text).toBe('abc')
    world.fireTimers()
    await world.settle()
    await world.store.flushSave('n')
    expect(world.dbHistory).toEqual(['abc'])
  })

  it('textToShow gives the live text of an open note and the loaded text of a closed one', async () => {
    const world = createWorld(7)
    world.db.set('n', 'saved')
    const a = newView('a')
    const opening = open(world, a, 'n')
    await world.settle()
    await opening
    type(world, a, ' unsaved')

    const load = world.store.beginLoad('n')
    expect(world.store.textToShow(load, 'saved')).toBe('saved unsaved')
    load.release()

    const other = world.store.beginLoad('m')
    expect(world.store.textToShow(other, 'from db')).toBe('from db')
    other.release()
    expect(world.store.openNoteIds()).toEqual(['n'])
  })


  it('does not bring back a note deleted while a load of it was in progress', async () => {
    const world = createWorld(8)
    world.db.set('n', 'doomed')
    const a = newView('a')
    const load = world.store.beginLoad('n')
    const loaded = world.load('n')
    await world.settle()
    world.store.remove('n')
    expect(world.store.bind('a', load, await loaded, attachView(a))).toBeNull()
    expect(world.store.openNoteIds()).toEqual([])
    expect(world.store.boundNoteOf('a')).toBeNull()
    // Once that load is over, the id is not remembered.
    const later = world.store.beginLoad('n')
    expect(world.store.bind('a', later, 'recreated', attachView(a))).toBe('recreated')
  })

  it('keeps text whose write failed, shows it on reopening, and writes it on flushAll', async () => {
    const written: string[] = []
    let failing = true
    const timers: Array<() => void> = []
    const store = createNoteDocumentStore({
      setTimer: (callback) => { timers.push(callback); return timers.length },
      clearTimer: () => {},
      persist: async (_noteId, text) => { written.push(text) },
    })
    const a = newView('a')
    a.text = bound(store, 'a', store.beginLoad('n'), 'base', attachView(a))
    a.noteId = 'n'
    a.text = 'base+typed'
    store.publish('a', a.text)
    store.scheduleSave('a', async () => { if (failing) throw new Error('disk full') })
    const consoleError = console.error
    console.error = () => {}
    try {
      timers.shift()!()
      await store.flushSave('n')
    } finally {
      console.error = consoleError
    }
    store.unbind('a')
    expect(store.openNoteIds()).toEqual(['n'])
    const reopen = store.beginLoad('n')
    expect(store.textToShow(reopen, 'base')).toBe('base+typed')
    reopen.release()
    failing = false
    store.flushAll()
    await store.flushSave('n')
    expect(written).toEqual(['base+typed'])
    expect(store.openNoteIds()).toEqual([])
  })

  it('tells every view of a note about a save whose requester has moved to another note', async () => {
    const world = createWorld(9)
    world.db.set('n', 'x')
    const a = newView('a')
    const b = newView('b')
    const opening = Promise.all([open(world, a, 'n'), open(world, b, 'n')])
    await world.settle()
    await opening
    type(world, a, 'y')
    world.store.unbind('a')
    world.fireTimers()
    await world.settle()
    expect(b.events.some((event) => event.kind === 'saved')).toBe(true)
  })

  it('a departed view\'s queued write goes through the store\'s own writer', async () => {
    const viewWrites: string[] = []
    const storeWrites: string[] = []
    const timers: Array<() => void> = []
    const store = createNoteDocumentStore({
      setTimer: (callback) => { timers.push(callback); return timers.length },
      clearTimer: () => {},
      persist: async (_noteId, text) => { storeWrites.push(text) },
    })
    const a = newView('a')
    bound(store, 'a', store.beginLoad('n'), 'one', attachView(a))
    store.publish('a', 'one two')
    store.scheduleSave('a', async (text) => { viewWrites.push(text) })
    store.unbind('a')
    timers.shift()!()
    await store.flushSave('n')
    expect(viewWrites).toEqual([])
    expect(storeWrites).toEqual(['one two'])
  })

  it('resave writes the live text again even when it is already written', async () => {
    const world = createWorld(10, true)
    world.db.set('n', 'clean')
    const a = newView('a')
    const opening = open(world, a, 'n')
    await world.settle()
    await opening
    const resaving = world.store.resave('n')
    expect(resaving).not.toBeNull()
    await world.settle()
    await resaving
    expect(world.dbHistory).toEqual(['clean'])
    expect(world.store.resave('closed')).toBeNull()
  })

})
