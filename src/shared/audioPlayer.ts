// Shared types and IPC channel names for the music player feature.

export const AUDIO_PLAYER_CHANNELS = {
  pickFiles:            'audio-player:pick-files',
  pickFolder:           'audio-player:pick-folder',
  scanFolderForAudio:   'audio-player:scan-folder-for-audio',
  getPlaylist:          'audio-player:get-playlist',
  addSongs:             'audio-player:add-songs',
  clearPlaylist:        'audio-player:clear-playlist',
  removeSong:           'audio-player:remove-song',
  pickNextSong:         'audio-player:pick-next-song',
  afterPlay:            'audio-player:after-play',
  favoriteSong:         'audio-player:favorite-song',
  skipSong:             'audio-player:skip-song',
  purgeSong:            'audio-player:purge-song',
  getPlaylistCounts:    'audio-player:get-playlist-counts',
} as const;

/** One slot out of the 5 playlist buttons (1-indexed). */
export type PlaylistSlot = 1 | 2 | 3 | 4 | 5;

export type MusicSongEntry = {
  id: number;
  filePath: string;
  playlistSlot: PlaylistSlot;
  /** Lower value = higher priority. 1 is the highest (just added / least recently played). */
  priority: number;
  /** 1–10; affects how quickly the song regains priority. */
  favorability: number;
  /** Derived from filename when added; empty string if unknown. */
  title: string;
  /** Derived from filename or ID3 metadata; empty string if unknown. */
  artist: string;
  /** Total duration in seconds (0 when unknown, filled lazily by renderer). */
  durationSec: number;
};

export type PickNextSongResult = MusicSongEntry | null;

export type PlaylistCountsResult = Record<PlaylistSlot, number>;

export type AudioPlayerApi = {
  /** Open a multi-select file dialog; returns an array of chosen file paths. */
  pickFiles(): Promise<string[]>;
  /** Open a folder dialog; returns the chosen folder path or null. */
  pickFolder(): Promise<string | null>;
  /** Recursively scan a folder and return all audio file paths. */
  scanFolderForAudio(folderPath: string): Promise<string[]>;
  /** Return all songs for the given playlist slot. */
  getPlaylist(slot: PlaylistSlot): Promise<MusicSongEntry[]>;
  /** Add files to the given playlist slot. */
  addSongs(slot: PlaylistSlot, filePaths: string[]): Promise<MusicSongEntry[]>;
  /** Permanently remove all songs from a slot. */
  clearPlaylist(slot: PlaylistSlot): Promise<void>;
  /** Remove a single song by its DB id. */
  removeSong(id: number): Promise<void>;
  /**
   * Pick the next song to play.
   * @param activeSlots - Which playlist slots currently contribute to the pool.
   */
  pickNextSong(activeSlots: PlaylistSlot[]): Promise<PickNextSongResult>;
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
   * "Skip" the current song: set its priority to the current max and reset
   * its favorability to 1.
   */
  skipSong(id: number): Promise<void>;
  /** Permanently delete a song from the database. */
  purgeSong(id: number): Promise<void>;
  /** Return the total song count for each of the 5 playlist slots. */
  getPlaylistCounts(): Promise<PlaylistCountsResult>;
};

/** Supported audio file extensions that can be added to playlists. */
export const AUDIO_EXTENSIONS = new Set([
  '.mp3', '.wav', '.ogg', '.flac', '.m4a', '.aac', '.opus', '.weba', '.webm',
]);

/** FA icon classes used for each playlist slot button (bottom row). */
export const PLAYLIST_SLOT_ICONS: Record<PlaylistSlot, string> = {
  1: 'fa-solid fa-microphone',
  2: 'fa-solid fa-guitar',
  3: 'fa-solid fa-ankh',
  4: 'fa-solid fa-bolt',
  5: 'fa-solid fa-microchip',
};
