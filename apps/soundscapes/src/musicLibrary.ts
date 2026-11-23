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
  isPoolFilterEmpty,
  type MusicPoolFilter,
  type MusicSongEntry,
} from '@thockdown/visualizer/shared/audioPlayer';

export type CatalogSong = Omit<MusicSongEntry, 'priority' | 'favorability'>;

export interface MusicCatalog {
  songs: CatalogSong[];
  /** The sets that play: a song is in the pool when it is in one of them and passes the filter. */
  activeSetIds: number[];
  filter: MusicPoolFilter;
}

export type MusicRotation = LibrarySong[];

export const EMPTY_CATALOG: MusicCatalog = { songs: [], activeSetIds: [], filter: { query: '' } };

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
  const matches = isPoolFilterEmpty(catalog.filter) ? () => true : createPoolFilterMatcher(catalog.filter);
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
