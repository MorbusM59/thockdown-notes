import type { InvokeChannels } from './ipcContract';
import { sanitizeDocumentText } from './textSanitization';
// Shared types and IPC channel names for the music player feature.

export const AUDIO_PLAYER_CHANNELS = {
  pickFiles:            'audio-player:pick-files',
  pickFolder:           'audio-player:pick-folder',
  addFolder:            'audio-player:add-folder',
  addPaths:             'audio-player:add-paths',
  getPlaylist:          'audio-player:get-playlist',
  addSongs:             'audio-player:add-songs',
  clearPlaylist:        'audio-player:clear-playlist',
  removeFromSet:        'audio-player:remove-from-set',
  removeSong:           'audio-player:remove-song',
  pickNextSong:         'audio-player:pick-next-song',
  getPool:              'audio-player:get-pool',
  rotatePoolTo:         'audio-player:rotate-pool-to',
  afterPlay:            'audio-player:after-play',
  favoriteSong:         'audio-player:favorite-song',
  unfavoriteSong:       'audio-player:unfavorite-song',
  skipSong:             'audio-player:skip-song',
  purgeSong:            'audio-player:purge-song',
  getPlaylistCounts:    'audio-player:get-playlist-counts',
  getSongById:          'audio-player:get-song-by-id',
  getMusicSets:         'audio-player:get-music-sets',
  createMusicSet:       'audio-player:create-music-set',
  renameMusicSet:       'audio-player:rename-music-set',
  moveMusicSet:         'audio-player:move-music-set',
  deleteMusicSet:       'audio-player:delete-music-set',
} as const satisfies InvokeChannels<AudioPlayerApi>;

/** A persisted music set's numeric id; factory ids retain their historical slot values. */
export type PlaylistSlot = number;

/**
 * The five factory sets retain their historical numeric ids, so
 * existing songs stay in the same set when custom sets are introduced.
 */
export const PLAYLIST_BUTTON_SLOTS = [2, 4, 5, 6, 3] as const satisfies readonly PlaylistSlot[];
export type PlaylistButtonSlot = (typeof PLAYLIST_BUTTON_SLOTS)[number];
export const MUSIC_SET_QUICK_ACCESS_COUNT = PLAYLIST_BUTTON_SLOTS.length;

export const MAX_FACTORY_PLAYLIST_SLOT = 6;

export interface MusicSet {
  slot: PlaylistSlot;
  name: string;
}

/**
 * Column count of the player's button grid: five visible music sets plus
 * the Soundscapes toggle. The top row fills the same width (play spans two).
 *
 * This is a LAYOUT measurement, not just a render detail, and three places
 * need it in agreement or the player visibly breaks:
 *   1. the grid itself (audio.css, via the `--audio-grid-columns` custom
 *      property AudioControls sets from this constant);
 *   2. the renderer's window-controls column width (App.tsx's
 *      `windowControlsMetrics`), which is an exact px track in the app grid
 *      and in the mini-mode window size -- too narrow and the player
 *      overflows the panel it sits in;
 *   3. the main process's startup fallback for that same width
 *      (`WINDOW_CONTROLS_WIDTH_PX` in electron/main.ts), used for the window
 *      minimum until the renderer reports its own measured figure.
 * (3) cannot import from here at the time it is needed, so it stays a mirrored
 * literal -- its comment carries the arithmetic and names this constant.
 */
export const AUDIO_GRID_COLUMNS = PLAYLIST_BUTTON_SLOTS.length + 1;

/** Narrowing guard for values arriving from persisted state or the database. */
export function isPlaylistSlot(value: unknown): value is PlaylistSlot {
  return Number.isSafeInteger(value) && (value as number) > 0;
}

/** Empty count map; consumers treat an absent set count as zero until loaded. */
export function emptyPlaylistCounts(): PlaylistCountsResult {
  return {};
}

export type MusicSongEntry = {
  id: number;
  filePath: string;
  /** Every set containing this song. A song can belong to several sets. */
  setIds: PlaylistSlot[];
  /** Lower value = higher priority. 1 is the highest (just added / least recently played). */
  priority: number;
  /** 1–10; affects how quickly the song regains priority. */
  favorability: number;
  /** From the file's tags (electron/audioTags.ts); empty when the file has none. Shown through `songTitleText`. */
  title: string;
  /** From the file's tags; empty when the file has none. Shown through `songArtistText`. */
  artist: string;
  /** From the file's tags; empty when the file has none. Shown through `songAlbumText`. */
  album: string;
  /** Total duration in seconds (0 when unknown, filled lazily by renderer). */
  durationSec: number;
};

export type IndexedMusicFile = Pick<MusicSongEntry, 'filePath' | 'title' | 'artist' | 'album'>;

export type PickNextSongResult = MusicSongEntry | null;

export type PlaylistCountsResult = Record<number, number>;

export type AudioPlayerApi = {
  /** The sets, in display order. */
  getMusicSets(): Promise<MusicSet[]>;
  /** Create a set at the end of the ordered set list. */
  createMusicSet(): Promise<MusicSet[]>;
  /** Rename a user-created set. Factory names are fixed. */
  renameMusicSet(slot: PlaylistSlot, name: string): Promise<MusicSet[]>;
  /** Move one set onto another row, shifting the intervening rows. */
  moveMusicSet(draggedSlot: PlaylistSlot, targetSlot: PlaylistSlot): Promise<MusicSet[]>;
  /** Purge memberships and orphan songs, then delete a user-created set. */
  deleteMusicSet(slot: PlaylistSlot): Promise<MusicSet[]>;
  /** Open a multi-select file dialog; returns an array of chosen file paths. */
  pickFiles(): Promise<string[]>;
  /** Open a folder dialog; returns the chosen folder path or null. */
  pickFolder(): Promise<string | null>;
  /** Recursively index a folder and add its audio files; returns the number found. */
  addFolder(slot: PlaylistSlot, folderPath: string): Promise<number>;
  /** Add files and folders alike (a drop from the file manager), each folder searched through; returns the number of audio files found. */
  addPaths(slot: PlaylistSlot, paths: string[]): Promise<number>;
    /** Return all songs belonging to the given set. */
  getPlaylist(slot: PlaylistSlot): Promise<MusicSongEntry[]>;
    /** Add files to the given set. */
  addSongs(slot: PlaylistSlot, filePaths: string[]): Promise<MusicSongEntry[]>;
  /** Remove a set's memberships and permanently purge songs with no remaining memberships. */
  clearPlaylist(slot: PlaylistSlot): Promise<void>;
  /** Take one song out of one set; a song left in no set leaves the library, as clearing a set does. */
  removeFromSet(slot: PlaylistSlot, songIds: number[]): Promise<void>;
  /** Remove a single song by its DB id. */
  removeSong(id: number): Promise<void>;
  /** Pick the next song to play from the pool `query` describes. */
  pickNextSong(query: MusicPoolQuery): Promise<PickNextSongResult>;
  /** Every song in the pool `query` describes, in pick order (`shared/musicPool.ts`). */
  getPool(query: MusicPoolQuery): Promise<MusicSongEntry[]>;
  /**
   * Make `id` the next pick by rotating the pool's order to it, keeping that
   * order (`shared/musicPool.ts`). Returns the song, or null when it is not
   * in the pool.
   */
  rotatePoolTo(query: MusicPoolQuery, id: number): Promise<MusicSongEntry | null>;
  /**
   * Called by the renderer after a song finishes playing naturally.
   * Updates priority + favorability counters across the database.
   */
  afterPlay(id: number): Promise<void>;
  /**
   * "Favourite" the current song: set its priority to 0 (replay immediately)
   * and increment its favorability by 1 (capped at 10).
   */
  favoriteSong(id: number): Promise<MusicSongEntry | null>;
  /**
   * Clear the replay marker a favourite carries: priority drops back to the
   * bottom of the rotation, exactly where finishing the song would have put
   * it, and favorability is left alone.
   *
   * Deliberately not `skipSong`, which also resets favorability to 1: taking
   * the marker off a song says "not right now", not "I was wrong to like
   * this", and a listener toggling the button off should not silently undo
   * however many times they have favourited it before.
   */
  unfavoriteSong(id: number): Promise<MusicSongEntry | null>;
  /**
   * "Skip" the current song: set its priority to the current max and reset
   * its favorability to 1.
   */
  skipSong(id: number): Promise<void>;
  /** Permanently delete a song from the database. */
  purgeSong(id: number): Promise<void>;
  /** Return the total song count for each set id. */
  getPlaylistCounts(): Promise<PlaylistCountsResult>;
  /** Look up a single song by its DB id (used to restore the last-played song across sessions). */
  getSongById(id: number): Promise<MusicSongEntry | null>;
};

export function getNextActiveSlotsForSelection(
  activeSlots: PlaylistSlot[],
  selectedSlot: PlaylistSlot,
  additive: boolean,
): PlaylistSlot[] {
  if (!additive) return [selectedSlot]
  return activeSlots.includes(selectedSlot) ? activeSlots : [...activeSlots, selectedSlot]
}

export function shouldStopCurrentSongAfterSlotSelection({
  currentSongSetIds,
  nextActiveSlots,
}: {
  currentSongSetIds: readonly PlaylistSlot[] | undefined;
  nextActiveSlots: readonly PlaylistSlot[];
}): boolean {
  return currentSongSetIds !== undefined
    && !currentSongSetIds.some((slot) => nextActiveSlots.includes(slot))
}

/** Supported audio file extensions that can be added to playlists. */
export const AUDIO_EXTENSIONS = new Set([
  '.mp3', '.wav', '.ogg', '.flac', '.m4a', '.aac', '.opus', '.weba', '.webm',
]);

/** FA icon classes used for each visible playlist button (bottom row). */
export const PLAYLIST_SLOT_ICONS: Record<PlaylistButtonSlot, string> = {
  2: 'fa-solid fa-radio',
  3: 'fa-solid fa-om',
  4: 'fa-solid fa-bolt',
  5: 'fa-solid fa-microchip',
  6: 'fa-solid fa-mug-hot',
};

/** Human-readable theme name for each visible playlist button (bottom row). */
export const PLAYLIST_SLOT_THEMES: Record<PlaylistButtonSlot, string> = {
  2: 'Pop',
  3: 'Ambient',
  4: 'Rock',
  5: 'Electronic',
  6: 'Lounge',
};

export const FACTORY_MUSIC_SETS: readonly MusicSet[] = PLAYLIST_BUTTON_SLOTS.map((slot) => ({
  slot,
  name: PLAYLIST_SLOT_THEMES[slot],
}));

const FACTORY_SET_BY_SLOT = new Map(FACTORY_MUSIC_SETS.map((set) => [set.slot, set]));

export function isFactoryMusicSet(slot: number): slot is PlaylistButtonSlot {
  return FACTORY_SET_BY_SLOT.has(slot);
}

export function defaultMusicSetName(sets: readonly MusicSet[]): string {
  const used = new Set(sets.map((set) => set.name.trim().toLowerCase()));
  for (let index = 0; ; index += 1) {
    let value = index + 1
    let letters = ''
    while (value > 0) {
      value -= 1
      letters = String.fromCharCode(65 + (value % 26)) + letters
      value = Math.floor(value / 26)
    }
    const name = `Set ${letters}`
    if (!used.has(name.toLowerCase())) return name
  }
}

/**
 * How a song's tags are shown, the same everywhere (the music bar, the OS
 * media controls, the visualizer). A missing artist or album says so in
 * words; a missing title falls back to where the file is, as
 * `... | folder | folder | file.mp3` (the leading `...` only when the path
 * goes further up), so two untitled songs are still told apart.
 */
export const SONG_PATH_SEPARATOR = ' | ';

/**
 * A tag as it is shown: the editor's own text rule (`sanitizeDocumentText`:
 * line separators, tabs, HTML tags and the single-cell rule), with what is
 * left of any line break as a space, since every place a tag is shown is one
 * row. Applied here, at the one way a tag reaches the screen, so the stored
 * tag stays what the file said.
 */
function songTagText(tag: string): string {
  return sanitizeDocumentText(tag).replace(/\n+/g, ' ').trim();
}

export function songTitleText(song: Pick<MusicSongEntry, 'title' | 'filePath'>): string {
  const title = songTagText(song.title);
  if (title) return title;
  const parts = song.filePath.split(/[\\/]/).filter((part) => part.length > 0);
  const shown = parts.slice(-3);
  return songTagText((parts.length > shown.length ? ['...', ...shown] : shown).join(SONG_PATH_SEPARATOR));
}

/**
 * A song's name in a list of songs (the visualizer's song list): the title
 * tag, or with none the file's name alone, without its folders and its
 * extension, where `songTitleText`'s folders tell one untitled song from
 * another in a single line.
 */
export function songListTitleText(song: Pick<MusicSongEntry, 'title' | 'filePath'>): string {
  const title = songTagText(song.title);
  if (title) return title;
  const file = song.filePath.split(/[\\/]/).filter((part) => part.length > 0).at(-1) ?? '';
  return songTagText(file.replace(/\.[^.]+$/, ''));
}

/** The visualizer's song search, shared by the song list and the next pick. */
export type MusicPoolFilter = { query: string };

export const EMPTY_POOL_FILTER: MusicPoolFilter = { query: '' };

/** Which songs are in the pool: those belonging to any active set in `slots` that pass `filter`. */
export type MusicPoolQuery = { slots: PlaylistSlot[]; filter: MusicPoolFilter };

export function isPoolFilterEmpty(filter: MusicPoolFilter): boolean {
  return !filter.query.trim();
}

export function samePoolFilter(a: MusicPoolFilter, b: MusicPoolFilter): boolean {
  return a.query === b.query;
}

/** A filter read from storage or IPC; old field values become quoted search terms. */
export function sanitizePoolFilter(input: unknown): MusicPoolFilter {
  const record = input && typeof input === 'object' ? input as Record<string, unknown> : {};
  if (typeof record.query === 'string') return { query: record.query };
  const legacyTerms = [record.artist, record.album, record.title]
    .filter((value): value is string => typeof value === 'string')
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`);
  return { query: legacyTerms.join(' ') };
}

type PoolSearchField = 'artist' | 'album' | 'title' | 'path'

function poolSearchFor(query: string): { fields: PoolSearchField[]; terms: string[] } {
  // Unprefixed, a term may hit the file's path too; a prefix narrows it to one tag.
  let fields: PoolSearchField[] = ['artist', 'album', 'title', 'path'];
  if (query.startsWith('$')) {
    fields = ['artist'];
    query = query.slice(1);
  } else if (query.startsWith('§')) {
    fields = ['album'];
    query = query.slice(1);
  } else if (query.startsWith('#')) {
    fields = ['title'];
    query = query.slice(1);
  }

  const terms: string[] = [];
  let index = 0;
  while (index < query.length) {
    while (/\s/.test(query[index] ?? '')) index += 1;
    if (index >= query.length) break;
    if (query[index] === '"') {
      index += 1;
      let phrase = '';
      while (index < query.length && query[index] !== '"') {
        if (query[index] === '\\' && (query[index + 1] === '"' || query[index + 1] === '\\')) index += 1;
        phrase += query[index];
        index += 1;
      }
      if (query[index] === '"') index += 1;
      if (phrase) terms.push(phrase.toLowerCase());
    } else {
      const start = index;
      while (index < query.length && !/\s/.test(query[index])) index += 1;
      terms.push(query.slice(start, index).toLowerCase());
    }
  }

  return { fields, terms };
}

export function createPoolFilterMatcher(filter: MusicPoolFilter): (song: Pick<MusicSongEntry, 'title' | 'artist' | 'album' | 'filePath'>) => boolean {
  const { fields, terms } = poolSearchFor(filter.query);
  if (terms.length === 0) return () => true;
  return (song) => {
    const textByField = {
      artist: songTagText(song.artist),
      album: songTagText(song.album),
      title: songListTitleText(song),
      path: song.filePath,
    };
    const searchableText = fields.map((field) => textByField[field].toLowerCase());
    return terms.every((term) => searchableText.some((text) => text.includes(term)));
  };
}

export function matchesPoolFilter(song: Pick<MusicSongEntry, 'title' | 'artist' | 'album' | 'filePath'>, filter: MusicPoolFilter): boolean {
  return createPoolFilterMatcher(filter)(song);
}

export function songArtistText(song: Pick<MusicSongEntry, 'artist'>): string {
  return songTagText(song.artist) || 'no artist';
}

export function songAlbumText(song: Pick<MusicSongEntry, 'album'>): string {
  return songTagText(song.album) || 'no album';
}

/**
 * A user set's two-letter mark, wherever a set is shown by a mark rather than
 * by name (the music player's buttons, the Music Library's selector, Options >
 * Music > Sets): the initials of its first two words, or the first two letters
 * of a one-word name.
 */
export function musicSetMark(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  const mark = words.length >= 2 ? [...words[0]][0] + [...words[1]][0] : [...(words[0] ?? '')].slice(0, 2).join('')
  return mark.toUpperCase()
}
