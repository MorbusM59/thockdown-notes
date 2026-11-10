import type { InvokeChannels } from './ipcContract';
import { sanitizeDocumentText } from './textSanitization';
// Shared types and IPC channel names for the music player feature.

export const AUDIO_PLAYER_CHANNELS = {
  pickFiles:            'audio-player:pick-files',
  pickFolder:           'audio-player:pick-folder',
  addFolder:            'audio-player:add-folder',
  getPlaylist:          'audio-player:get-playlist',
  addSongs:             'audio-player:add-songs',
  clearPlaylist:        'audio-player:clear-playlist',
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
} as const satisfies InvokeChannels<AudioPlayerApi>;

/** One persisted playlist slot (1-indexed). */
export type PlaylistSlot = 1 | 2 | 3 | 4 | 5 | 6;

/**
 * Every persisted playlist slot. This is the single source of truth for the
 * persisted-state range check, playlist-count record and database CHECK
 * constraint. Slot 1 remains valid for existing libraries but is no longer
 * presented as a player button.
 */
export const PLAYLIST_SLOTS: readonly PlaylistSlot[] = [1, 2, 3, 4, 5, 6];

/** Visible music buckets in player order; slot 1 is intentionally omitted. */
export const PLAYLIST_BUTTON_SLOTS = [2, 4, 5, 6, 3] as const satisfies readonly PlaylistSlot[];
export type PlaylistButtonSlot = (typeof PLAYLIST_BUTTON_SLOTS)[number];

/** Highest valid slot number -- derived, never written out by hand. */
export const MAX_PLAYLIST_SLOT: PlaylistSlot = PLAYLIST_SLOTS[PLAYLIST_SLOTS.length - 1];

/**
 * Column count of the player's button grid: five visible music buckets plus
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
  return Number.isInteger(value) && (PLAYLIST_SLOTS as readonly number[]).includes(value as number);
}

/** True when a persisted slot is represented by a player bucket button. */
export function isPlaylistButtonSlot(value: unknown): value is PlaylistButtonSlot {
  return isPlaylistSlot(value) && (PLAYLIST_BUTTON_SLOTS as readonly number[]).includes(value);
}

/** An all-zero count record covering exactly the slots that exist. */
export function emptyPlaylistCounts(): PlaylistCountsResult {
  return Object.fromEntries(PLAYLIST_SLOTS.map((slot) => [slot, 0])) as PlaylistCountsResult;
}

export type MusicSongEntry = {
  id: number;
  filePath: string;
  playlistSlot: PlaylistSlot;
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

export type PlaylistCountsResult = Record<PlaylistSlot, number>;

export type AudioPlayerApi = {
  /** Open a multi-select file dialog; returns an array of chosen file paths. */
  pickFiles(): Promise<string[]>;
  /** Open a folder dialog; returns the chosen folder path or null. */
  pickFolder(): Promise<string | null>;
  /** Recursively index a folder and add its audio files; returns the number found. */
  addFolder(slot: PlaylistSlot, folderPath: string): Promise<number>;
  /** Return all songs for the given playlist slot. */
  getPlaylist(slot: PlaylistSlot): Promise<MusicSongEntry[]>;
  /** Add files to the given playlist slot. */
  addSongs(slot: PlaylistSlot, filePaths: string[]): Promise<MusicSongEntry[]>;
  /** Permanently remove all songs from a slot. */
  clearPlaylist(slot: PlaylistSlot): Promise<void>;
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
  /** Return the total song count for each playlist slot. */
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
  currentSongSlot,
  nextActiveSlots,
}: {
  currentSongSlot: PlaylistSlot | undefined;
  nextActiveSlots: readonly PlaylistSlot[];
}): boolean {
  return currentSongSlot !== undefined && !nextActiveSlots.includes(currentSongSlot)
}

/** Supported audio file extensions that can be added to playlists. */
export const AUDIO_EXTENSIONS = new Set([
  '.mp3', '.wav', '.ogg', '.flac', '.m4a', '.aac', '.opus', '.weba', '.webm',
]);

/** FA icon classes used for each visible playlist button (bottom row). */
export const PLAYLIST_SLOT_ICONS: Record<PlaylistButtonSlot, string> = {
  2: 'fa-solid fa-compact-disc',
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

/**
 * The pool's filter (the visualizer's three fields): a song is in the pool
 * only if each non-blank field is found, ignoring case, in its artist tag,
 * its album tag and its title as the song list shows it (the title tag, or
 * the file name), the way the note list's search matches a note.
 */
export type MusicPoolFilter = { artist: string; album: string; title: string };

export const EMPTY_POOL_FILTER: MusicPoolFilter = { artist: '', album: '', title: '' };

/** Which songs are in the pool: those in `slots` that pass `filter`. */
export type MusicPoolQuery = { slots: PlaylistSlot[]; filter: MusicPoolFilter };

export function isPoolFilterEmpty(filter: MusicPoolFilter): boolean {
  return !filter.artist.trim() && !filter.album.trim() && !filter.title.trim();
}

export function samePoolFilter(a: MusicPoolFilter, b: MusicPoolFilter): boolean {
  return a.artist === b.artist && a.album === b.album && a.title === b.title;
}

/** A filter read from storage or IPC: every field a string, anything else empty. */
export function sanitizePoolFilter(input: unknown): MusicPoolFilter {
  const record = input && typeof input === 'object' ? input as Record<string, unknown> : {};
  const field = (value: unknown) => (typeof value === 'string' ? value : '');
  return { artist: field(record.artist), album: field(record.album), title: field(record.title) };
}

export function matchesPoolFilter(song: Pick<MusicSongEntry, 'title' | 'artist' | 'album' | 'filePath'>, filter: MusicPoolFilter): boolean {
  const has = (text: string, query: string) => {
    const needle = query.trim().toLowerCase();
    return !needle || text.toLowerCase().includes(needle);
  };
  return has(songTagText(song.artist), filter.artist)
    && has(songTagText(song.album), filter.album)
    && has(songListTitleText(song), filter.title);
}

export function songArtistText(song: Pick<MusicSongEntry, 'artist'>): string {
  return songTagText(song.artist) || 'no artist';
}

export function songAlbumText(song: Pick<MusicSongEntry, 'album'>): string {
  return songTagText(song.album) || 'no album';
}
