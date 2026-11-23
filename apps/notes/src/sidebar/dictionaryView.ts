import { closeIconPick, readIconPick } from '@thockdown/interaction/iconPicker/iconPick'

/**
 * Which dictionary the sidebar is open on, if any. A dictionary is opened
 * from its row in Options > Tools > Spell Checking (the edit button) and
 * shown IN the Options view, in place of the options, the way an icon pick
 * is: its words listed as the Music Library lists songs
 * (DictionaryPanel.tsx), the filter field filtering them and its dock below.
 * Escape, a press on the view bar, or leaving Options closes it, back to the
 * options. A module store because what opens it (the options panel) and what
 * shows and closes it (App.tsx) sit in different parts of the tree.
 *
 * Not persisted: a restart opens on the options, as it does on the view the
 * dictionary was opened from.
 */
let openId: string | null = null
const listeners = new Set<() => void>()
let showOptions: (() => void) | null = null

export function readOpenDictionary(): string | null {
  return openId
}

export function subscribeOpenDictionary(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

function publish(next: string | null): void {
  if (next === openId) return
  openId = next
  // An icon being picked for a dictionary is for the one that was open.
  if (readIconPick()?.target.kind === 'dictionary') closeIconPick()
  for (const listener of listeners) listener()
}

/** Opens `id` in the sidebar, bringing the Options view up if it is not. */
export function openDictionary(id: string): void {
  publish(id)
  showOptions?.()
}

export function closeDictionary(): void {
  publish(null)
}

/** App.tsx's way of showing the Options view; returns the unregistration. */
export function registerDictionaryPresenter(present: () => void): () => void {
  showOptions = present
  return () => {
    if (showOptions === present) showOptions = null
  }
}
