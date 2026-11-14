import type { PlaylistSlot } from '../../shared/audioPlayer'

/**
 * The ICON PICKER: while it is open for an entry (a music set, a soundscape, a soundstage, a keystroke sound, a flashing preset, a layout),
 * the entry's sidebar view shows every solid icon in place of its list, the
 * dock below stays to name the entry, and the sidebar's filter field filters
 * the icons. A module store, because what opens it (the entry's mark in its
 * dock, DockEntryRow), what shows it and what closes it besides a pick
 * (Escape and the view bar, App.tsx) sit in different parts of the tree.
 *
 * The picker's query is its own, never the view's filter: that filter is
 * simply not touched while the picker is up, so closing it finds the list
 * filtered exactly as it was, with nothing saved and restored.
 */
export type IconPickTarget =
  | { kind: 'musicSet'; slot: PlaylistSlot }
  | { kind: 'soundscape'; id: string }
  | { kind: 'soundstage'; id: string }
  | { kind: 'keystrokeSound'; id: string }
  | { kind: 'flashing'; id: string }
  | { kind: 'layout'; id: number }

export interface IconPick {
  target: IconPickTarget
  query: string
}

/** The sidebar view an entry of each kind lives in. */
export const ICON_PICK_VIEW = { musicSet: 'songs', soundscape: 'soundscapes', soundstage: 'options', keystrokeSound: 'options', flashing: 'options', layout: 'options' } as const satisfies Record<IconPickTarget['kind'], string>

export function sameIconPickTarget(a: IconPickTarget, b: IconPickTarget): boolean {
  if (a.kind === 'musicSet' || b.kind === 'musicSet') return a.kind === 'musicSet' && b.kind === 'musicSet' && a.slot === b.slot
  return a.kind === b.kind && a.id === b.id
}

let pick: IconPick | null = null
const listeners = new Set<() => void>()

function publish(next: IconPick | null): void {
  if (next === pick) return
  pick = next
  for (const listener of listeners) listener()
}

export function readIconPick(): IconPick | null {
  return pick
}

export function subscribeIconPick(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/** Whether the picker is open for `target`. */
export function isPickingIconFor(current: IconPick | null, target: IconPickTarget): boolean {
  return current !== null && sameIconPickTarget(current.target, target)
}

/** Opens the picker for `target`, with an empty query; open for it already, closes it. */
export function toggleIconPick(target: IconPickTarget): void {
  publish(isPickingIconFor(pick, target) ? null : { target, query: '' })
}

export function closeIconPick(): void {
  publish(null)
}

export function setIconPickQuery(query: string): void {
  if (pick && pick.query !== query) publish({ ...pick, query })
}

/**
 * The names (`guitar`, without `fa-`) of the icons a query keeps: every word
 * of it must appear in the icon's name or in its search words, so "music"
 * finds a guitar as well as the music note.
 */
export function filterSolidIcons(catalog: ReadonlyArray<readonly [string, string]>, query: string): string[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  return catalog
    .filter(([name, terms]) => words.every((word) => name.includes(word) || terms.includes(word)))
    .map(([name]) => name)
}
