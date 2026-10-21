import type { EditorTextEdit } from '../editor/EditorContract'

/**
 * `text` with `changes` applied -- each `from`..`to` replaced by `insert`, all
 * in the coordinates of `text` and none overlapping, as EditorAdapter.applyEdit
 * takes them.
 */
export function applyNonOverlappingChanges(text: string, changes: ReadonlyArray<{ from: number; to: number; insert: string }>): string {
  let result = text
  for (const change of [...changes].sort((a, b) => b.from - a.from)) {
    result = result.slice(0, change.from) + change.insert + result.slice(change.to)
  }
  return result
}

/** How long to wait after the last change before persisting a note. */
export const SAVE_DEBOUNCE_MS = 350

/**
 * One open note: the single source of truth for its text while any slot shows
 * it, and the one place that writes it to the database.
 *
 * WHY IT EXISTS. A note can be open in several slots at once. Each slot used
 * to keep its own copy of the text and save the whole document, so the next
 * keystroke in one slot wrote over everything typed in the other, and an
 * inactive slot was "frozen" onto a snapshot that thawed back to its own
 * stale copy (the hibernation this replaced). The fault was that the text
 * belonged to the VIEW. Here it belongs to the note: a slot is a view of the
 * document and owns only what is about the view (caret, scroll, edit or
 * render view, speed reading, Time Machine browsing).
 *
 * THE RULES, each held by construction rather than by care at a call site:
 *
 * 1. Every view of a note shows the document's text. A change made in one
 *    view is `publish`ed and handed, synchronously, to every other view of
 *    the same note as a `change` event carrying the edit that produced it,
 *    so a view applies it in O(edit) instead of rediscovering it by diffing
 *    two whole documents. `edit` is null when the change was not one
 *    contiguous range or did not follow on from the text the views were last
 *    handed; a view then reconciles from `text` alone.
 *
 * 2. A save writes the document's text AS IT IS WHEN THE WRITE STARTS, never
 *    a text captured when the save was queued. Writes to one note are
 *    serialized. So no write can carry an older text over a newer one, which
 *    is the race a per-view queue had (two queues, two debounce timers, an
 *    awaited worker between queueing and writing).
 *
 * 3. A view that opens a note which is already open gets the LIVE text, not
 *    the database's: the database is behind by whatever is still debouncing.
 *    The database text is adopted instead only when it is provably at least
 *    as new as the document -- the document has nothing unsaved and nothing
 *    it holds was written or loaded after this load began (`bind`). That is
 *    what lets a note the main process rewrites (the auto-TOC and Open Items
 *    chapters, regenerated on every visit) reach the views already showing
 *    it, without ever letting a slow load roll back a newer text.
 *
 * 4. A document lives while anything needs it: a view, a pending or running
 *    write, or a load in progress for its note. The last condition is what
 *    makes rule 3 sound across a close and reopen: a document cannot be
 *    dropped, and its newer text forgotten, between a load reading the
 *    database and that load binding.
 *
 * 5. A deleted note is `remove`d: its views are told, and nothing pending
 *    for it is written (a save must never bring a deleted note back).
 *
 * UNDO stays per view, deliberately: each editor keeps the history of the
 * edits made IN IT and maps that history through changes arriving from
 * other views (CodeMirror's own collaborative-editing model), so undo in a
 * slot undoes what was typed in that slot and never something done out of
 * sight in another.
 */
export interface NoteDocumentChange {
  /** The text before the change, exactly as views were last handed it. */
  previousText: string
  text: string
  /** The one contiguous edit from `previousText` to `text`, or null: reconcile from `text`. */
  edit: EditorTextEdit | null
}

export type NoteDocumentEvent =
  /** Another view changed the text. */
  | { kind: 'change'; change: NoteDocumentChange }
  /** A write of this note, requested by another view, completed. */
  | { kind: 'saved' }
  /** The note no longer exists. The view is already unbound. */
  | { kind: 'removed' }

export type NoteDocumentListener = (event: NoteDocumentEvent) => void

/** Persists `text` as the note's content. Supplied by the view that asked for the save. */
export type NoteDocumentWriter = (text: string) => Promise<void>

export type NoteDocumentWriterFor = (noteId: string, text: string) => Promise<void>

/**
 * A load of a note from the database, begun before the IPC call is made and
 * handed to `bind` with what it read. Holding one keeps the note's document
 * alive (rule 4). Release it if the load is abandoned; `bind` consumes it.
 */
export interface NoteDocumentLoad {
  readonly noteId: string
  /** The store's clock when the load began. */
  readonly startedAt: number
  /** Idempotent. Called by `bind`; call it yourself on any path that does not bind. */
  release: () => void
}

export interface NoteDocumentStore {
  beginLoad: (noteId: string) => NoteDocumentLoad
  /**
   * Makes `viewId` a view of the load's note (and of nothing else) and
   * returns the text it must show. Consumes the load. Null, and nothing
   * bound, when the note was deleted while the load was in progress -- the
   * view must not show what the load read.
   */
  bind: (viewId: string, load: NoteDocumentLoad, loadedText: string, listener: NoteDocumentListener) => string | null
  /**
   * What `bind` would return now, without binding: for work a view does
   * between its load and its bind (placing the caret, splitting blocks).
   * `bind` may still answer differently if the note changes in between.
   */
  textToShow: (load: NoteDocumentLoad, loadedText: string) => string
  unbind: (viewId: string) => void
  /** The note `viewId` is a view of, or null. */
  boundNoteOf: (viewId: string) => string | null
  /** The open note's text, or null when no document is open for it. */
  read: (noteId: string) => string | null
  /** Every note with an open document -- shown in a slot, or still being written. */
  openNoteIds: () => string[]
  /**
   * The view changed its note's text to `text`. `from` is what the view
   * changed it from and the edit that did it, when it knows them.
   */
  publish: (viewId: string, text: string, from?: { previousText: string; edit: EditorTextEdit | null }) => void
  /** Debounces a write of the view's note, made by `writer` when it fires (rule 2). */
  scheduleSave: (viewId: string, writer: NoteDocumentWriter) => void
  /** Starts any debounced write of the note now, and resolves once every write of it so far has finished. */
  flushSave: (noteId: string) => Promise<void>
  /** Drops a debounced write of the note that has not started. */
  cancelSave: (noteId: string) => void
  /**
   * Changes an open note's text from outside every view (a chapter merged
   * into it, an image reference renamed in it): every view is told, and a
   * write is queued through the store's own `persist`. False, and nothing
   * done, when the note is not open -- the caller then changes the database
   * directly, which is safe exactly because nothing holds the note.
   */
  change: (noteId: string, transform: (text: string) => string) => boolean
  /**
   * Writes the open note's live text again even if it was written already,
   * through the store's `persist`: for when the main process has changed
   * what a write decides (an external file's saved baseline, against which
   * it judges the note clean). Null when the note is not open.
   */
  resave: (noteId: string) => Promise<void> | null
  /** Starts every pending or failed write now (the window is closing). */
  flushAll: () => void
  /** The note was deleted (rule 5). */
  remove: (noteId: string) => void
}

export interface NoteDocumentStoreOptions {
  /** Writes a note's text for a change no view made (`change`). */
  persist?: NoteDocumentWriterFor
  setTimer?: (callback: () => void, ms: number) => unknown
  clearTimer?: (handle: unknown) => void
  debounceMs?: number
}

interface DocumentEntry {
  readonly noteId: string
  text: string
  /**
   * The text most recently handed to a writer, or the loaded text the
   * document was created from; null when the last write failed and what the
   * database holds is unknown. `text !== sentText` means unsaved changes.
   */
  sentText: string | null
  /**
   * The clock at which the database was last known to hold `sentText`: when
   * the load the document was created from began, or when a write of it
   * COMPLETED. Not when a write started -- a writer may await other work
   * before its request reaches the main process, and a load begun in that
   * gap reads the database from before the write.
   */
  observedAt: number
  readonly views: Map<string, NoteDocumentListener>
  saveTimer: unknown
  /** The latest requester's writer; `viewId` null for a change no view made. */
  writer: { viewId: string | null; write: NoteDocumentWriter } | null
  writes: Promise<void>
  writesInFlight: number
  removed: boolean
}

export function createNoteDocumentStore(options: NoteDocumentStoreOptions = {}): NoteDocumentStore {
  const setTimer = options.setTimer ?? ((callback, ms) => window.setTimeout(callback, ms))
  const clearTimer = options.clearTimer ?? ((handle) => window.clearTimeout(handle as number))
  const debounceMs = options.debounceMs ?? SAVE_DEBOUNCE_MS
  const persist = options.persist ?? null

  const documents = new Map<string, DocumentEntry>()
  const boundNoteByView = new Map<string, string>()
  const loadsInProgress = new Map<string, number>()
  /**
   * Notes deleted while a load of them was in progress: that load read the
   * note before it was deleted, and binding it would bring it back. Cleared
   * when the last such load is released, so it never outgrows the loads.
   */
  const removedDuringLoad = new Set<string>()
  let clock = 0

  const notify = (entry: DocumentEntry, event: NoteDocumentEvent, exceptViewId: string | null) => {
    // A copy: a listener may unbind (a removed note) while this runs.
    for (const [viewId, listener] of [...entry.views]) {
      if (viewId === exceptViewId) continue
      try {
        listener(event)
      } catch (error) {
        console.error('[note-documents] a view failed to take an event', { noteId: entry.noteId, viewId, kind: event.kind, error })
      }
    }
  }

  const dropIfUnneeded = (entry: DocumentEntry) => {
    if (documents.get(entry.noteId) !== entry) return
    if (entry.views.size > 0 || entry.saveTimer !== null || entry.writesInFlight > 0) return
    if ((loadsInProgress.get(entry.noteId) ?? 0) > 0) return
    // Text no write has reached the database with (the last one failed)
    // stays, so reopening the note shows it and the next write or
    // `flushAll` carries it.
    if (!entry.removed && entry.text !== entry.sentText) return
    documents.delete(entry.noteId)
  }

  /**
   * Rule 3: whether `loadedText` should replace the open document's text.
   * Only when nothing is unsaved or being written, and the database was last
   * known to hold the document's text BEFORE this load began -- then the load
   * is at least as new as the document, and differs from it only where the
   * main process changed the note itself.
   */
  const loadSupersedes = (entry: DocumentEntry, load: NoteDocumentLoad, loadedText: string) => (
    entry.text === entry.sentText
    && entry.saveTimer === null
    && entry.writesInFlight === 0
    && entry.observedAt < load.startedAt
    && loadedText !== entry.text
  )

  const unbind = (viewId: string) => {
    const noteId = boundNoteByView.get(viewId)
    if (noteId === undefined) return
    boundNoteByView.delete(viewId)
    const entry = documents.get(noteId)
    if (!entry) return
    entry.views.delete(viewId)
    // A write the departing view queued must not run that view's code after
    // it is gone (its caches, its callbacks); the store's own writer writes
    // the same text.
    if (entry.writer?.viewId === viewId && persist) {
      entry.writer = { viewId: null, write: (current) => persist(noteId, current) }
    }
    dropIfUnneeded(entry)
  }

  const entryOfView = (viewId: string): DocumentEntry | null => {
    const noteId = boundNoteByView.get(viewId)
    return noteId === undefined ? null : documents.get(noteId) ?? null
  }

  const startWrite = (entry: DocumentEntry) => {
    entry.saveTimer = null
    const writer = entry.writer
    entry.writer = null
    if (!writer) return
    entry.writesInFlight += 1
    entry.writes = entry.writes.then(async () => {
      if (entry.removed) return
      const text = entry.text
      // Two views asking for the same save, or a save of a text that is
      // already what was last written, would write the same bytes again.
      if (text === entry.sentText) return
      entry.sentText = text
      try {
        await writer.write(text)
      } catch (error) {
        if (entry.sentText === text) entry.sentText = null
        // Kept for the next write rather than retried on a timer: a write
        // that failed once will fail again until something changes, and the
        // next edit, flush or `flushAll` is that something.
        entry.writer ??= writer
        console.error('[note-documents] failed to write a note', { noteId: entry.noteId, error })
        return
      }
      entry.observedAt = ++clock
      // The requester learns of its own save from its writer -- unless it has
      // since moved on to another note, when every view of this one is told.
      const requesterStillHere = writer.viewId !== null && entry.views.has(writer.viewId)
      notify(entry, { kind: 'saved' }, requesterStillHere ? writer.viewId : null)
    }).finally(() => {
      entry.writesInFlight -= 1
      dropIfUnneeded(entry)
    })
  }

  return {
    beginLoad(noteId) {
      loadsInProgress.set(noteId, (loadsInProgress.get(noteId) ?? 0) + 1)
      let released = false
      return {
        noteId,
        startedAt: ++clock,
        release: () => {
          if (released) return
          released = true
          const remaining = (loadsInProgress.get(noteId) ?? 1) - 1
          if (remaining > 0) loadsInProgress.set(noteId, remaining)
          else {
            loadsInProgress.delete(noteId)
            removedDuringLoad.delete(noteId)
          }
          const entry = documents.get(noteId)
          if (entry) dropIfUnneeded(entry)
        },
      }
    },

    bind(viewId, load, loadedText, listener) {
      const { noteId } = load
      if (removedDuringLoad.has(noteId)) {
        load.release()
        return null
      }
      if (boundNoteByView.get(viewId) !== noteId) unbind(viewId)
      let entry = documents.get(noteId)
      if (!entry) {
        entry = {
          noteId,
          text: loadedText,
          sentText: loadedText,
          observedAt: load.startedAt,
          views: new Map(),
          saveTimer: null,
          writer: null,
          writes: Promise.resolve(),
          writesInFlight: 0,
          removed: false,
        }
        documents.set(noteId, entry)
      } else {
        if (loadSupersedes(entry, load, loadedText)) {
          const previousText = entry.text
          entry.text = loadedText
          entry.sentText = loadedText
          entry.observedAt = load.startedAt
          notify(entry, { kind: 'change', change: { previousText, text: loadedText, edit: null } }, viewId)
        }
      }
      entry.views.set(viewId, listener)
      boundNoteByView.set(viewId, noteId)
      load.release()
      return entry.text
    },

    textToShow(load, loadedText) {
      const entry = documents.get(load.noteId)
      if (!entry || loadSupersedes(entry, load, loadedText)) return loadedText
      return entry.text
    },

    unbind,

    boundNoteOf(viewId) {
      return boundNoteByView.get(viewId) ?? null
    },

    read(noteId) {
      return documents.get(noteId)?.text ?? null
    },

    openNoteIds() {
      return [...documents.keys()]
    },

    publish(viewId, text, from) {
      const entry = entryOfView(viewId)
      if (!entry || entry.text === text) return
      const previousText = entry.text
      // An edit is only meaningful against the text the other views hold.
      const edit = from && from.previousText === previousText ? from.edit : null
      entry.text = text
      notify(entry, { kind: 'change', change: { previousText, text, edit } }, viewId)
    },

    scheduleSave(viewId, write) {
      const entry = entryOfView(viewId)
      if (!entry) return
      entry.writer = { viewId, write }
      if (entry.saveTimer !== null) clearTimer(entry.saveTimer)
      entry.saveTimer = setTimer(() => startWrite(entry), debounceMs)
    },

    flushSave(noteId) {
      const entry = documents.get(noteId)
      if (!entry) return Promise.resolve()
      if (entry.saveTimer !== null) {
        clearTimer(entry.saveTimer)
        startWrite(entry)
      }
      return entry.writes
    },

    cancelSave(noteId) {
      const entry = documents.get(noteId)
      if (!entry) return
      if (entry.saveTimer !== null) clearTimer(entry.saveTimer)
      entry.saveTimer = null
      entry.writer = null
      dropIfUnneeded(entry)
    },

    change(noteId, transform) {
      const entry = documents.get(noteId)
      if (!entry) return false
      const previousText = entry.text
      const text = transform(previousText)
      if (text === previousText) return true
      entry.text = text
      notify(entry, { kind: 'change', change: { previousText, text, edit: null } }, null)
      if (persist) {
        // Not the debounce: a change from outside is one step, and its caller
        // usually flushes straight after. A view's own writer queued for the
        // same note is kept -- it writes the same document.
        entry.writer ??= { viewId: null, write: (current) => persist(noteId, current) }
        if (entry.saveTimer !== null) clearTimer(entry.saveTimer)
        startWrite(entry)
      }
      return true
    },

    resave(noteId) {
      const entry = documents.get(noteId)
      if (!entry || !persist) return null
      entry.sentText = null
      entry.writer ??= { viewId: null, write: (current) => persist(noteId, current) }
      if (entry.saveTimer !== null) clearTimer(entry.saveTimer)
      startWrite(entry)
      return entry.writes
    },

    flushAll() {
      for (const entry of [...documents.values()]) {
        if (entry.saveTimer !== null) clearTimer(entry.saveTimer)
        if (entry.text !== entry.sentText) {
          entry.writer ??= persist ? { viewId: null, write: (current) => persist(entry.noteId, current) } : null
        }
        startWrite(entry)
      }
    },

    remove(noteId) {
      if ((loadsInProgress.get(noteId) ?? 0) > 0) removedDuringLoad.add(noteId)
      const entry = documents.get(noteId)
      if (!entry) return
      entry.removed = true
      if (entry.saveTimer !== null) clearTimer(entry.saveTimer)
      entry.saveTimer = null
      entry.writer = null
      const views = [...entry.views]
      entry.views.clear()
      for (const [viewId] of views) boundNoteByView.delete(viewId)
      documents.delete(noteId)
      for (const [viewId, listener] of views) {
        try {
          listener({ kind: 'removed' })
        } catch (error) {
          console.error('[note-documents] a view failed to take its note\'s removal', { noteId, viewId, error })
        }
      }
    },
  }
}
