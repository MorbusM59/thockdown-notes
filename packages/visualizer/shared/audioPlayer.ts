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
  nextSong:             'audio-player:next-song',
  getPool:              'audio-player:get-pool',
  chooseSong:           'audio-player:choose-song',
  stepBackTo:           'audio-player:step-back-to',
  purgeSong:            'audio-player:purge-song',
  getPlaylistCounts:    'audio-player:get-playlist-counts',
  getSongById:          'audio-player:get-song-by-id',
  getMusicSets:         'audio-player:get-music-sets',
  createMusicSet:       'audio-player:create-music-set',
  renameMusicSet:       'audio-player:rename-music-set',
  moveMusicSet:         'audio-player:move-music-set',
  deleteMusicSet:       'audio-player:delete-music-set',
  setMusicSetIcon:      'audio-player:set-music-set-icon',
} as const satisfies InvokeChannels<AudioPlayerApi>;

/** A persisted music set's numeric id; factory ids retain their historical slot values. */
export type PlaylistSlot = number;

/**
 * The five factory sets retain their historical numeric ids, so
 * existing songs stay in the same set when custom sets are introduced.
 */
export const PLAYLIST_BUTTON_SLOTS = [2, 4, 5, 6, 3] as const satisfies readonly PlaylistSlot[];
export type PlaylistButtonSlot = (typeof PLAYLIST_BUTTON_SLOTS)[number];

export const MAX_FACTORY_PLAYLIST_SLOT = 6;

export interface MusicSet {
  slot: PlaylistSlot;
  name: string;
  /**
   * The Font Awesome solid icon the reader picked for the set (`fa-guitar`),
   * or null for its default: a factory set's own icon, anyone else's initials
   * (musicSetMarkOf).
   */
  icon: string | null;
}

/** A solid icon's name as a set stores it: `fa-` and the icon's id. */
export const MUSIC_SET_ICON_PATTERN = /^fa-[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * What a set's mark is: an icon's class, or the set's initials. Every place
 * that draws a set reads it here, so a picked icon reaches all of them.
 */
export function musicSetMarkOf(set: MusicSet): { iconClass: string } | { letters: string } {
  if (set.icon) return { iconClass: `fa-solid ${set.icon}` };
  if (isFactoryMusicSet(set.slot)) return { iconClass: PLAYLIST_SLOT_ICONS[set.slot] };
  return { letters: musicSetMark(set.name) };
}

/**
 * Column count of the player's button grid: Music (two columns),
 * Filter, Soundstages and Soundscape (two columns); the second row's
 * sliders, stages or filter fill the same width.
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
export const AUDIO_GRID_COLUMNS = 6;

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
  /** Its place in the mix: the pool plays lowest first (`musicPool.ts`). */
  due: number;
  /** How much it is liked, in steps of -MAX_LIKES..MAX_LIKES (`musicPool.ts`'s `favorabilityOf`). */
  likes: number;
  /** From the file's tags (shared/audioTags.ts); empty when the file has none. Shown through `songTitleText`. */
  title: string;
  /** From the file's tags; empty when the file has none. Shown through `songArtistText`. */
  artist: string;
  /** From the file's tags; empty when the file has none. Shown through `songAlbumText`. */
  album: string;
  /** Total duration in seconds (0 when unknown, filled lazily by renderer). */
  durationSec: number;
};

export type IndexedMusicFile = Pick<MusicSongEntry, 'filePath' | 'title' | 'artist' | 'album' | 'durationSec'>;

export type PlaylistCountsResult = Record<number, number>;

export type AudioPlayerApi = {
  /** The sets, in display order. */
  getMusicSets(): Promise<MusicSet[]>;
  /** Create a set at the end of the ordered set list. */
  createMusicSet(): Promise<MusicSet[]>;
  /** Rename a set, factory sets included; names are unique. */
  renameMusicSet(slot: PlaylistSlot, name: string): Promise<MusicSet[]>;
  /** Move one set onto another row, shifting the intervening rows. */
  moveMusicSet(draggedSlot: PlaylistSlot, targetSlot: PlaylistSlot): Promise<MusicSet[]>;
  /** Purge memberships and orphan songs, then delete a user-created set. */
  deleteMusicSet(slot: PlaylistSlot): Promise<MusicSet[]>;
  /** Give a set a solid icon (`fa-guitar`), or null to restore its default. */
  setMusicSetIcon(slot: PlaylistSlot, icon: string | null): Promise<MusicSet[]>;
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
  /**
   * NEXT (`musicPool.ts`'s `advance`, in a mix): the song `currentId` is left,
   * going back into the list by its favorability, and the song now at the
   * head is returned. Null `currentId` reads the head. Null when the pool is empty.
   */
  nextSong(query: MusicPoolQuery, currentId: number | null): Promise<MusicSongEntry | null>;
  /** Every song in the pool `query` describes, in queue order (`shared/musicPool.ts`). */
  getPool(query: MusicPoolQuery): Promise<MusicSongEntry[]>;
  /**
   * A song chosen from the list (`musicPool.ts`'s `choose`): `id` goes to the
   * head and `currentId` back in as NEXT would put it. Returns the song, or
   * null when the pool does not hold it.
   */
  chooseSong(query: MusicPoolQuery, currentId: number | null, id: number): Promise<MusicSongEntry | null>;
  /**
   * PREVIOUS (`musicPool.ts`'s `stepBack`): `currentId` goes to the head and
   * `previousId`, the song gone back to, in front of it.
   */
  stepBackTo(query: MusicPoolQuery, currentId: number | null, previousId: number): Promise<void>;
  /** Permanently delete a song from the database. */
  purgeSong(id: number): Promise<void>;
  /** Return the total song count for each set id. */
  getPlaylistCounts(): Promise<PlaylistCountsResult>;
  /** Look up a single song by its DB id (used to restore the last-played song across sessions). */
  getSongById(id: number): Promise<MusicSongEntry | null>;
};

/**
 * How a set joins or leaves the activated sets: `solo` plays from it alone,
 * `add` puts it in, `toggle` puts it in or takes it out, the last one
 * included: an empty pool plays nothing, and the music stops (the pool is
 * what plays).
 */
export type SetSelection = 'solo' | 'add' | 'toggle'

export function getNextActiveSlotsForSelection(
  activeSlots: PlaylistSlot[],
  selectedSlot: PlaylistSlot,
  selection: SetSelection,
): PlaylistSlot[] {
  if (selection === 'solo') return [selectedSlot]
  if (!activeSlots.includes(selectedSlot)) return [...activeSlots, selectedSlot]
  if (selection === 'add') return activeSlots
  return activeSlots.filter((slot) => slot !== selectedSlot)
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
  icon: null,
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

/**
 * The folders and file name a song's path names, outermost first. A file
 * path splits on its separators. A content URI (the phone's songs, from a
 * folder the reader picked: `content://<provider>/tree/<tree id>/document/
 * <document id>`) names its file by the DOCUMENT ID, percent-encoded, which
 * for the device's storage is `<volume>:<path>`; split on its raw slashes it
 * would read as the folders `tree` and `document`. Every reader of a song's
 * folders and file name goes through this.
 */
export function songPathParts(filePath: string): string[] {
  const documentAt = filePath.startsWith('content://') ? filePath.lastIndexOf('/document/') : -1;
  const path = documentAt < 0 ? filePath : documentIdPath(filePath.slice(documentAt + '/document/'.length));
  return path.split(/[\\/]/).filter((part) => part.length > 0);
}

function documentIdPath(encoded: string): string {
  let id = encoded;
  try {
    id = decodeURIComponent(encoded);
  } catch {
    // A malformed escape: the id as it stands.
  }
  // `primary:Music/Album/song.mp3`: the volume before the first colon is not a folder.
  const colon = id.indexOf(':');
  return colon < 0 ? id : id.slice(colon + 1);
}

export function songTitleText(song: Pick<MusicSongEntry, 'title' | 'filePath'>): string {
  const title = songTagText(song.title);
  if (title) return title;
  const parts = songPathParts(song.filePath);
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
  const file = songPathParts(song.filePath).at(-1) ?? '';
  return songTagText(file.replace(/\.[^.]+$/, ''));
}

/** The visualizer's song search, shared by the song list and the next pick. */
/**
 * What the music bar's second row shows: the two volume sliders, or in
 * their place the soundstages or the pool filter (`AudioControls.tsx`).
 */
export type MusicBarRow = 'levels' | 'soundstages' | 'filter';

export function sanitizeMusicBarRow(input: unknown): MusicBarRow | undefined {
  return input === 'levels' || input === 'soundstages' || input === 'filter' ? input : undefined;
}

/**
 * The pool filter: a query, and whether it is in effect. Switching it off keeps
 * the query for when it is switched on again; an empty query filters nothing
 * either way. Editing the query switches it on.
 */
export type MusicPoolFilter = { query: string; enabled: boolean };

export const EMPTY_POOL_FILTER: MusicPoolFilter = { query: '', enabled: false };

/** Which songs are in the pool: those belonging to any active set in `slots` that pass `filter`. */
export type MusicPoolQuery = { slots: PlaylistSlot[]; filter: MusicPoolFilter };

/** Whether the filter lets every song through: switched off, or with nothing to match. */
export function poolFilterPassesAll(filter: MusicPoolFilter): boolean {
  return !filter.enabled || !filter.query.trim();
}

/**
 * Whether a song is in the pool `query` describes: in one of its sets and
 * passing its filter. The one statement of pool membership, read by the
 * phone's pool and by both players' rule that the pool is what plays
 * (a song that leaves it while playing is left for the next pick).
 */
export function createPoolMatcher(query: MusicPoolQuery): (song: Pick<MusicSongEntry, 'setIds' | 'title' | 'artist' | 'album' | 'filePath'>) => boolean {
  const slots = new Set(query.slots);
  const passes = createPoolFilterMatcher(query.filter);
  return (song) => song.setIds.some((id) => slots.has(id)) && passes(song);
}

export function samePoolFilter(a: MusicPoolFilter, b: MusicPoolFilter): boolean {
  return a.query === b.query && a.enabled === b.enabled;
}

/**
 * A filter read from storage or IPC; old field values become quoted search terms. One saved before the switch
 * existed is on exactly when it holds a query, which is when it filtered anything.
 */
export function sanitizePoolFilter(input: unknown): MusicPoolFilter {
  const record = input && typeof input === 'object' ? input as Record<string, unknown> : {};
  const switched = typeof record.enabled === 'boolean' ? record.enabled : null;
  if (typeof record.query === 'string') return { query: record.query, enabled: switched ?? record.query.trim() !== '' };
  const legacyTerms = [record.artist, record.album, record.title]
    .filter((value): value is string => typeof value === 'string')
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`);
  return { query: legacyTerms.join(' '), enabled: switched ?? legacyTerms.length > 0 };
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
  if (!filter.enabled) return () => true;
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

// The music library port: the desktop's main process supplies it through the
// preload; another app sets it before the visualizer reads the pool.
declare global {
  interface Window {
    thockdownAudioPlayer?: AudioPlayerApi;
  }
}
