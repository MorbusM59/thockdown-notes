/**
 * THE MUSIC LIBRARY on Android, as two documents with one writer each, so
 * nothing two parties change at once can be lost:
 *
 * - The CATALOG is the page's: the songs found in the reader's music folders
 *   (each a MusicSongEntry like the desktop's, its `filePath` the document's
 *   content URI, its tags read natively), the SETS they are in, which sets
 *   are active and the pool filter. The page edits it and hands the whole of
 *   it to the native service, which stores it and gives it to the renderer.
 * - The ROTATION is the renderer's: each song's priority and favorability,
 *   moved by what plays (packages/visualizer/shared/musicPool.ts's rules,
 *   the desktop's own). It changes while the page may be paused, so only the
 *   music renderer writes it; the page reads it to show the pool's order.
 *
 * A song the rotation does not know yet is new: priority 1, favorability 1,
 * as the desktop gives a song just added.
 */
import {
  afterPlay,
  comparePoolOrder,
  pickFromPool,
  rotatePoolTo,
  type LibrarySong,
} from '@thockdown/visualizer/shared/musicPool';
import {
  createPoolFilterMatcher,
  defaultMusicSetName,
  EMPTY_POOL_FILTER,
  sanitizePoolFilter,
  poolFilterPassesAll,
  MAX_FACTORY_PLAYLIST_SLOT,
  type MusicPoolFilter,
  type MusicSet,
  type MusicSongEntry,
  type PlaylistSlot,
} from '@thockdown/visualizer/shared/audioPlayer';

export type CatalogSong = Omit<MusicSongEntry, 'priority' | 'favorability'>;

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
}

export type MusicRotation = LibrarySong[];

export const EMPTY_CATALOG: MusicCatalog = { songs: [], sets: [], folders: [], activeSetIds: [], filter: EMPTY_POOL_FILTER };

/** A stored catalog, any field a catalog written before it existed lacks taken as empty. */
export function sanitizeCatalog(input: unknown): MusicCatalog {
  const stored = (input && typeof input === 'object' ? input : {}) as Partial<MusicCatalog>;
  return {
    songs: Array.isArray(stored.songs) ? stored.songs : [],
    sets: Array.isArray(stored.sets) ? stored.sets : [],
    folders: Array.isArray(stored.folders) ? stored.folders : [],
    activeSetIds: Array.isArray(stored.activeSetIds) ? stored.activeSetIds : [],
    filter: sanitizePoolFilter(stored.filter),
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
  return { catalog: { ...catalog, sets: [...catalog.sets, set] }, slot };
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
  added: ReadonlyArray<Omit<CatalogSong, 'id' | 'setIds'>>,
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
    songs.push({ ...song, id: nextId, setIds: [slot] });
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

/** Every catalog song with its place in the rotation (new songs at the front). */
export function libraryOf(catalog: MusicCatalog, rotation: MusicRotation): MusicSongEntry[] {
  const places = new Map(rotation.map((song) => [song.id, song]));
  return catalog.songs.map((song) => {
    const place = places.get(song.id);
    return { ...song, priority: place?.priority ?? 1, favorability: place?.favorability ?? 1 };
  });
}

/** The pool in pick order: the active sets' songs that pass the filter. */
export function poolOf(catalog: MusicCatalog, rotation: MusicRotation): MusicSongEntry[] {
  const active = new Set(catalog.activeSetIds);
  const matches = poolFilterPassesAll(catalog.filter) ? () => true : createPoolFilterMatcher(catalog.filter);
  return libraryOf(catalog, rotation)
    .filter((song) => song.setIds.some((id) => active.has(id)) && matches(song))
    .sort(comparePoolOrder);
}

/** The rotation written out in full for the catalog's songs, with `changes` ([id, priority]) applied. */
function withPriorities(library: readonly MusicSongEntry[], changes: Array<[number, number]>): MusicRotation {
  const next = new Map(changes);
  return library.map((song) => ({ id: song.id, priority: next.get(song.id) ?? song.priority, favorability: song.favorability }));
}

/**
 * The song to play after `previousId` (null at the start), and the rotation
 * once `previousId` has counted as played.
 */
export function nextSong(
  catalog: MusicCatalog,
  rotation: MusicRotation,
  previousId: number | null,
  random: () => number = Math.random,
): { song: MusicSongEntry | null; rotation: MusicRotation } {
  let next = rotation;
  if (previousId !== null) next = withPriorities(libraryOf(catalog, rotation), afterPlay(libraryOf(catalog, rotation), previousId));
  return { song: pickFromPool(poolOf(catalog, next), random), rotation: next };
}

/** The rotation with `songId` made the pool's unique next pick, its order kept (a song chosen from the list). */
export function chooseSong(catalog: MusicCatalog, rotation: MusicRotation, songId: number): MusicRotation {
  const changes = rotatePoolTo(poolOf(catalog, rotation), songId);
  return changes ? withPriorities(libraryOf(catalog, rotation), changes) : rotation;
}
