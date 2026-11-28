/**
 * THE MUSIC LIBRARY on Android, as two documents with one writer each, so
 * nothing two parties change at once can be lost:
 *
 * - The CATALOG is the page's: the songs found in the reader's music folders
 *   (each a MusicSongEntry like the desktop's, its `filePath` the document's
 *   content URI, its tags read natively), the SETS they are in, which sets
 *   are active and the pool filter. The page edits it and hands the whole of
 *   it to the native service, which stores it and gives it to the renderer.
 *   A song's LIKES (how much it is liked, set from the visualizer) and the
 *   PLAY MODE (mix or folder order) are the catalog's too: only the reader
 *   changes them.
 * - The ROTATION is the renderer's: each song's DUE, its place in the mix,
 *   moved by what plays (packages/visualizer/shared/musicPool.ts's rules,
 *   the desktop's own). It changes while the page may be paused, so only the
 *   music renderer writes it; the page reads it to show the pool's order.
 *
 * A song the rotation does not know yet has no due: the renderer places it
 * (`settleRotation`), and until it has, the page shows it last.
 */
import {
  advance,
  choose,
  clampLikes,
  queueOrder,
  sanitizePlayMode,
  settleDues,
  stepBack,
  type DueChanges,
  type PlayMode,
  type QueueMove,
} from '@thockdown/visualizer/shared/musicPool';
import {
  createPoolMatcher,
  defaultMusicSetName,
  EMPTY_POOL_FILTER,
  sanitizePoolFilter,
  MAX_FACTORY_PLAYLIST_SLOT,
  type MusicPoolFilter,
  type MusicSet,
  type MusicSongEntry,
  type PlaylistSlot,
} from '@thockdown/visualizer/shared/audioPlayer';

export type CatalogSong = Omit<MusicSongEntry, 'due'>;

/** A folder the reader added to a set: its tree URI, whose read grant the app holds while some set has it. */
export interface CatalogFolder {
  uri: string;
  setId: PlaylistSlot;
}

export interface MusicCatalog {
  songs: CatalogSong[];
  /**
   * The SETS, in display order, as the desktop's (MusicSet). The phone has no
   * factory sets: every set is the reader's, so ids start past the desktop's
   * factory slots and a set never borrows a factory set's icon.
   */
  sets: MusicSet[];
  folders: CatalogFolder[];
  /** The sets that play: a song is in the pool when it is in one of them and passes the filter. */
  activeSetIds: number[];
  filter: MusicPoolFilter;
  /** How the pool plays: the mix, or folder order. */
  playMode: PlayMode;
  /**
   * The filter queries last used, newest first, at most RECENT_FILTER_LIMIT
   * (`withPoolFilter`): what Android Auto offers to pick from.
   */
  recentFilters: string[];
}

export const RECENT_FILTER_LIMIT = 10;

/**
 * The catalog with `filter` as its pool filter. A query switched on joins
 * the recent filters (moved to the front if it is there already), so every
 * route that sets a filter, the page's field or a voice search, keeps the
 * list the same way.
 */
export function withPoolFilter(catalog: MusicCatalog, filter: MusicPoolFilter): MusicCatalog {
  const query = filter.query.trim();
  if (!filter.enabled || query === '') return { ...catalog, filter };
  const recentFilters = [query, ...catalog.recentFilters.filter((entry) => entry !== query)].slice(0, RECENT_FILTER_LIMIT);
  return { ...catalog, filter, recentFilters };
}

/** Each song's place in the mix. */
export type MusicRotation = Array<{ id: number; due: number }>;

export const EMPTY_CATALOG: MusicCatalog = { songs: [], sets: [], folders: [], activeSetIds: [], filter: EMPTY_POOL_FILTER, playMode: 'mix', recentFilters: [] };

/**
 * A stored rotation; an entry without a due (written by the priority
 * rotation this replaced) is dropped, so its song is placed afresh.
 */
export function sanitizeRotation(input: unknown): MusicRotation {
  if (!Array.isArray(input)) return [];
  return input.filter((entry): entry is { id: number; due: number } =>
    !!entry && typeof entry === 'object' && Number.isInteger(entry.id) && Number.isFinite(entry.due),
  ).map(({ id, due }) => ({ id, due }));
}

/** A stored catalog, any field a catalog written before it existed lacks taken as empty. */
export function sanitizeCatalog(input: unknown): MusicCatalog {
  const stored = (input && typeof input === 'object' ? input : {}) as Partial<MusicCatalog>;
  return {
    songs: Array.isArray(stored.songs) ? stored.songs.map((song) => ({ ...song, likes: clampLikes(song.likes ?? 0) })) : [],
    sets: Array.isArray(stored.sets) ? stored.sets : [],
    folders: Array.isArray(stored.folders) ? stored.folders : [],
    activeSetIds: Array.isArray(stored.activeSetIds) ? stored.activeSetIds : [],
    filter: sanitizePoolFilter(stored.filter),
    playMode: sanitizePlayMode(stored.playMode),
    recentFilters: Array.isArray(stored.recentFilters)
      ? stored.recentFilters.filter((entry): entry is string => typeof entry === 'string' && entry.trim() !== '').slice(0, RECENT_FILTER_LIMIT)
      : [],
  };
}

/*
 * THE SET OPERATIONS, each a pure catalog -> catalog, the desktop's set rules
 * (electron's music library) restated over the phone's one document.
 */

/** A new set at the end of the list, named as the desktop names one; and its id. */
export function createSet(catalog: MusicCatalog): { catalog: MusicCatalog; slot: PlaylistSlot } {
  const slot = Math.max(MAX_FACTORY_PLAYLIST_SLOT, ...catalog.sets.map((set) => set.slot)) + 1;
  const set: MusicSet = { slot, name: defaultMusicSetName(catalog.sets), icon: null };
  // A new set is active at once: whatever is added to it plays (the desktop activates a set as it fills).
  return { catalog: { ...catalog, sets: [...catalog.sets, set], activeSetIds: [...catalog.activeSetIds, slot] }, slot };
}

/** A set renamed; refused (unchanged) when another set has the name or it is blank. */
export function renameSet(catalog: MusicCatalog, slot: PlaylistSlot, name: string): MusicCatalog {
  const trimmed = name.trim();
  if (!trimmed || catalog.sets.some((set) => set.slot !== slot && set.name === trimmed)) return catalog;
  return { ...catalog, sets: catalog.sets.map((set) => (set.slot === slot ? { ...set, name: trimmed } : set)) };
}

export function setSetIcon(catalog: MusicCatalog, slot: PlaylistSlot, icon: string | null): MusicCatalog {
  return { ...catalog, sets: catalog.sets.map((set) => (set.slot === slot ? { ...set, icon } : set)) };
}

/** `dragged` moved onto `target`'s row, the rows between shifting. */
export function moveSet(catalog: MusicCatalog, dragged: PlaylistSlot, target: PlaylistSlot): MusicCatalog {
  const from = catalog.sets.findIndex((set) => set.slot === dragged);
  const to = catalog.sets.findIndex((set) => set.slot === target);
  if (from < 0 || to < 0 || from === to) return catalog;
  const sets = [...catalog.sets];
  const [moved] = sets.splice(from, 1);
  sets.splice(to, 0, moved);
  return { ...catalog, sets };
}

/** `songIds` taken out of `slot`; a song left in no set leaves the library. */
export function removeFromSet(catalog: MusicCatalog, slot: PlaylistSlot, songIds: readonly number[]): MusicCatalog {
  const removed = new Set(songIds);
  const songs = catalog.songs
    .map((song) => (removed.has(song.id) ? { ...song, setIds: song.setIds.filter((id) => id !== slot) } : song))
    .filter((song) => song.setIds.length > 0);
  return { ...catalog, songs };
}

/** Every song and folder taken out of `slot`, the set kept; and the folders no set holds any more, to release. */
export function purgeSet(catalog: MusicCatalog, slot: PlaylistSlot): { catalog: MusicCatalog; released: string[] } {
  const emptied = removeFromSet(catalog, slot, catalog.songs.map((song) => song.id));
  const folders = catalog.folders.filter((folder) => folder.setId !== slot);
  const kept = new Set(folders.map((folder) => folder.uri));
  const released = [...new Set(catalog.folders.filter((folder) => !kept.has(folder.uri)).map((folder) => folder.uri))];
  // An emptied set cannot play: it leaves the pool (another stays when it was not the only one).
  const activeSetIds = emptied.activeSetIds.filter((id) => id !== slot);
  return { catalog: { ...emptied, folders, activeSetIds }, released };
}

/** A set deleted with its songs and folders. */
export function deleteSet(catalog: MusicCatalog, slot: PlaylistSlot): { catalog: MusicCatalog; released: string[] } {
  const purged = purgeSet(catalog, slot);
  return { catalog: { ...purged.catalog, sets: purged.catalog.sets.filter((set) => set.slot !== slot) }, released: purged.released };
}

/**
 * A folder's scan joined to `slot`: songs already in the library join the
 * set, new ones are added with fresh ids, and the folder is recorded.
 */
export function addScanToSet(
  catalog: MusicCatalog,
  slot: PlaylistSlot,
  uri: string,
  paths: readonly string[],
  added: ReadonlyArray<Omit<CatalogSong, 'id' | 'setIds' | 'likes'>>,
): MusicCatalog {
  const inFolder = new Set(paths);
  let nextId = Math.max(0, ...catalog.songs.map((song) => song.id)) + 1;
  const songs = catalog.songs.map((song) =>
    inFolder.has(song.filePath) && !song.setIds.includes(slot) ? { ...song, setIds: [...song.setIds, slot] } : song,
  );
  const known = new Set(songs.map((song) => song.filePath));
  for (const song of added) {
    if (known.has(song.filePath)) continue;
    known.add(song.filePath);
    songs.push({ ...song, id: nextId, setIds: [slot], likes: 0 });
    nextId += 1;
  }
  const folders = catalog.folders.some((folder) => folder.uri === uri && folder.setId === slot)
    ? catalog.folders
    : [...catalog.folders, { uri, setId: slot }];
  return { ...catalog, songs, folders };
}

/** How many songs each set holds. */
export function setCounts(catalog: MusicCatalog): Record<number, number> {
  const counts: Record<number, number> = {};
  for (const set of catalog.sets) counts[set.slot] = 0;
  for (const song of catalog.songs) for (const id of song.setIds) counts[id] = (counts[id] ?? 0) + 1;
  return counts;
}

/** `songId` liked `steps` more (fewer when negative), held to the range (`musicPool.ts`'s `clampLikes`). */
export function likeSong(catalog: MusicCatalog, songId: number, steps: number): MusicCatalog {
  const song = catalog.songs.find((entry) => entry.id === songId);
  if (!song) return catalog;
  const likes = clampLikes(song.likes + steps);
  if (likes === song.likes) return catalog;
  return { ...catalog, songs: catalog.songs.map((entry) => (entry.id === songId ? { ...entry, likes } : entry)) };
}

/** Every catalog song with its place in the mix; a song not placed yet comes last. */
export function libraryOf(catalog: MusicCatalog, rotation: MusicRotation): MusicSongEntry[] {
  const dues = new Map(rotation.map((entry) => [entry.id, entry.due]));
  return catalog.songs.map((song) => ({ ...song, due: dues.get(song.id) ?? Number.POSITIVE_INFINITY }));
}

/** The pool in queue order: the active sets' songs that pass the filter, as the play mode orders them. */
export function poolOf(catalog: MusicCatalog, rotation: MusicRotation): MusicSongEntry[] {
  const pool = libraryOf(catalog, rotation).filter(createPoolMatcher({ slots: catalog.activeSetIds, filter: catalog.filter }));
  return queueOrder(pool, catalog.playMode);
}

/**
 * The rotation for exactly the catalog's songs, every song placed
 * (`musicPool.ts`'s `settleDues`): songs gone from the catalog are dropped.
 */
export function settleRotation(catalog: MusicCatalog, rotation: MusicRotation, random: () => number = Math.random): MusicRotation {
  const dues = new Map(rotation.map((entry) => [entry.id, entry.due]));
  const library = catalog.songs.map((song) => ({ id: song.id, likes: song.likes, due: dues.get(song.id) ?? null }));
  const placed = new Map(settleDues(library, random));
  return library.map((song) => ({ id: song.id, due: placed.get(song.id) ?? (song.due as number) }));
}

function withDues(rotation: MusicRotation, changes: DueChanges): MusicRotation {
  if (changes.length === 0) return rotation;
  const next = new Map(changes);
  return rotation.map((entry) => (next.has(entry.id) ? { id: entry.id, due: next.get(entry.id)! } : entry));
}

/** A queue move (`musicPool.ts`) over a settled rotation, and the rotation after it. */
export interface RotationMove {
  song: MusicSongEntry | null;
  rotation: MusicRotation;
}

function applied(move: QueueMove<MusicSongEntry>, rotation: MusicRotation): RotationMove {
  return { song: move.song, rotation: withDues(rotation, move.changes) };
}

/** NEXT: `currentId` (null at the start) is left and the queue's next song plays (`musicPool.ts`'s `advance`). */
export function nextSong(catalog: MusicCatalog, rotation: MusicRotation, currentId: number | null): RotationMove {
  return applied(advance(poolOf(catalog, rotation), catalog.playMode, currentId), rotation);
}

/** A song chosen from the list plays now (`musicPool.ts`'s `choose`); one the pool does not hold is played as given. */
export function chooseSong(catalog: MusicCatalog, rotation: MusicRotation, currentId: number | null, songId: number): RotationMove {
  const move = applied(choose(poolOf(catalog, rotation), catalog.playMode, currentId, songId), rotation);
  return move.song ? move : { ...move, song: libraryOf(catalog, rotation).find((song) => song.id === songId) ?? null };
}

/** PREVIOUS: the rotation once `currentId` was interrupted to go back to `previousId` (`musicPool.ts`'s `stepBack`). */
export function stepBackRotation(catalog: MusicCatalog, rotation: MusicRotation, currentId: number | null, previousId: number): MusicRotation {
  return withDues(rotation, stepBack(poolOf(catalog, rotation), catalog.playMode, currentId, previousId));
}
