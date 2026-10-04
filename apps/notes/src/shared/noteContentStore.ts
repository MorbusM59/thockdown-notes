import { isSameNoteSummary, type NoteSummary } from './noteLifecycle'

/**
 * Moves every note's content out of a list of summaries bound for React state
 * and into `contentById`, returning the summaries without it.
 *
 * The main process sends a note's content with its summary
 * (NoteSummaryWithContent), and a loaded or created note arrives as a
 * NoteDocument carrying it as `text` too. Neither may reach React state: a
 * summary held by a render scope stays alive for as long as any memoized
 * callback created in that render does, so a summary with content kept one
 * copy of the note per save (see NoteSummary.leadLine and
 * editorSection/useDisplayedNoteText.ts). App's notes setter runs every list
 * through this, so no call site has to know; content is read back by id.
 *
 * Content of notes no longer in the list is dropped, so the store holds
 * exactly one string per listed note. Returns `entries` itself when nothing
 * needed moving, so a setter that bails out with the previous array still
 * does.
 */
export function adoptNoteSummaries(entries: readonly NoteSummary[], contentById: Map<string, string>): NoteSummary[] {
  let moved = false
  const adopted = entries.map((entry) => {
    const carried = entry as NoteSummary & { contentText?: string; text?: string }
    if (carried.contentText === undefined && carried.text === undefined) return entry
    moved = true
    contentById.set(entry.id, carried.contentText ?? carried.text ?? '')
    const summary: NoteSummary & { contentText?: string; text?: string } = { ...carried }
    delete summary.contentText
    delete summary.text
    return summary
  })
  const listed = new Set(adopted.map((entry) => entry.id))
  for (const id of contentById.keys()) {
    if (!listed.has(id)) contentById.delete(id)
  }
  return moved ? adopted : (entries as NoteSummary[])
}

/**
 * Puts a just-saved note's summary into `previous`, carrying the text that was
 * saved so `adoptNoteSummaries` stores it. `saveNote` no longer sends content
 * back -- the renderer is the one that saved it -- so this is how the store
 * learns the new text; without it search and labels would keep the old one.
 * Returns `previous` when the note is not listed.
 */
export function withSavedNote(previous: readonly NoteSummary[], summary: NoteSummary, savedText: string): NoteSummary[] {
  const index = previous.findIndex((note) => note.id === summary.id)
  if (index < 0) return previous as NoteSummary[]
  const next = [...previous]
  next[index] = { ...summary, contentText: savedText } as NoteSummary
  return next
}

/**
 * `adopted` itself, or `previous` when every summary in it is the same as the
 * one already there -- so an update that only brought new CONTENT (now in the
 * store) does not re-render everything that reads the list. The save queue
 * used to get this by bailing out before `setNotes`; content now has to reach
 * the store even when the summary has not changed, so the bail-out lives here.
 */
export function keepIfUnchanged(adopted: NoteSummary[], previous: readonly NoteSummary[]): NoteSummary[] {
  if (adopted === previous) return adopted
  if (adopted.length !== previous.length) return adopted
  for (let index = 0; index < adopted.length; index += 1) {
    if (!isSameNoteSummary(adopted[index], previous[index])) return adopted
  }
  return previous as NoteSummary[]
}
