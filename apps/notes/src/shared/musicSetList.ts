import { createPoolFilterMatcher, songAlbumText, songArtistText, songListTitleText, type MusicSongEntry } from './audioPlayer'

/**
 * The SET LIST: one music set's songs, shown in the sidebar in place of the
 * options panel (`sidebar/MusicSetListPanel.tsx`), grouped one of two ways.
 * By FOLDER, each folder is a subsection named by its last folder level and
 * divided by file type; by ARTIST, each artist is a subsection divided by
 * album. Songs are alphabetical inside a divider. Kept free of the DOM so the
 * main process's `sanitizeMenu` can use the grouping setting.
 */

export const MUSIC_SET_LIST_GROUPINGS = ['folder', 'artist'] as const

export type MusicSetListGrouping = typeof MUSIC_SET_LIST_GROUPINGS[number]

export const DEFAULT_MUSIC_SET_LIST_GROUPING: MusicSetListGrouping = 'folder'

export function sanitizeMusicSetListGrouping(value: unknown): MusicSetListGrouping {
  return (MUSIC_SET_LIST_GROUPINGS as readonly unknown[]).includes(value)
    ? value as MusicSetListGrouping
    : DEFAULT_MUSIC_SET_LIST_GROUPING
}

export type MusicSetListDivider = { label: string; songs: MusicSongEntry[] }

/** A subsection: `key` is unique (a folder's whole path), `label` is what the heading shows. */
export type MusicSetListGroup = { key: string; label: string; dividers: MusicSetListDivider[] }

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

function folderOf(filePath: string): string {
  const cut = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'))
  return cut < 0 ? '' : filePath.slice(0, cut)
}

function lastFolderLevel(folder: string): string {
  return folder.split(/[\\/]/).filter((part) => part.length > 0).at(-1) ?? folder
}

function extensionOf(filePath: string): string {
  const file = filePath.slice(Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\')) + 1)
  const dot = file.lastIndexOf('.')
  return dot <= 0 ? '' : file.slice(dot).toLowerCase()
}

function bucket<T>(items: readonly T[], keyOf: (item: T) => string): Map<string, T[]> {
  const buckets = new Map<string, T[]>()
  for (const item of items) {
    const key = keyOf(item)
    const list = buckets.get(key)
    if (list) list.push(item)
    else buckets.set(key, [item])
  }
  return buckets
}

/** The songs matching `query` (the visualizer's pool-filter syntax), grouped for the set list. */
export function groupMusicSetList(songs: readonly MusicSongEntry[], grouping: MusicSetListGrouping, query: string): MusicSetListGroup[] {
  const matches = createPoolFilterMatcher({ query })
  const titles = new Map<MusicSongEntry, string>()
  const shown = songs.filter(matches)
  for (const song of shown) titles.set(song, songListTitleText(song))
  const byTitle = (a: MusicSongEntry, b: MusicSongEntry) => collator.compare(titles.get(a)!, titles.get(b)!)

  const groupKey = grouping === 'folder' ? (song: MusicSongEntry) => folderOf(song.filePath) : songArtistText
  const dividerKey = grouping === 'folder'
    ? (song: MusicSongEntry) => extensionOf(song.filePath) || 'no file type'
    : songAlbumText

  const groups: MusicSetListGroup[] = [...bucket(shown, groupKey)].map(([key, members]) => ({
    key,
    label: grouping === 'folder' ? lastFolderLevel(key) : key,
    dividers: [...bucket(members, dividerKey)]
      .map(([label, dividerSongs]) => ({ label, songs: dividerSongs.sort(byTitle) }))
      .sort((a, b) => collator.compare(a.label, b.label)),
  }))
  return groups.sort((a, b) => collator.compare(a.label, b.label) || collator.compare(a.key, b.key))
}
