/**
 * THE PHONE'S MUSIC PLAYER as the shared music views see it: it publishes
 * NowPlaying (packages/visualizer/sound/nowPlaying.ts) and supplies the
 * library's reads (packages/visualizer/shared/musicLibraryReads.ts) from the
 * catalog and the native player, so the Songs panel and the visualizer run
 * here unchanged.
 *
 * The catalog is this page's document (musicLibrary.ts): every change to the
 * sets is a pure catalog operation, stored whole through the plugin. The
 * rotation is the native renderer's, re-read whenever the song heard changes
 * (every pick moves it, and only then).
 */
import { volumeGain } from '@thockdown/audio/volumeLaw'
import {
  getNextActiveSlotsForSelection,
  type MusicPoolFilter,
  type MusicSongEntry,
  type PlaylistSlot,
} from '@thockdown/visualizer/shared/audioPlayer'
import { setMusicLibraryReads } from '@thockdown/visualizer/shared/musicLibraryReads'
import { publishNowPlaying, type NowPlaying, type SoundLevels } from '@thockdown/visualizer/sound/nowPlaying'
import { setMusicListening } from '@thockdown/visualizer/sound/musicListening'
import { createNativeMusicListening } from './nativeMusicListening'
import {
  addScanToSet,
  createSet,
  deleteSet,
  EMPTY_CATALOG,
  libraryOf,
  moveSet,
  poolOf,
  purgeSet,
  removeFromSet,
  renameSet,
  setCounts,
  setSetIcon,
  type MusicCatalog,
  type MusicRotation,
} from './musicLibrary'
import { loadMusicLibrary, type NativeMusicPlugin } from './nativeMusic'

let catalog: MusicCatalog = EMPTY_CATALOG
let rotation: MusicRotation = []
let heardSongId: number | null = null
// The music's own levels. Reverb and room are the soundstage's on the phone
// (the Soundstages tab), so the visualizer's level bars move only the volume.
let levels: SoundLevels = { volume: loadVolume(), reverb: 0, room: 0 }

const VOLUME_KEY = 'thockdown:music-volume'

/** The music volume last set (the slider's fraction), or full on a first launch. */
function loadVolume(): number {
  try {
    const stored = Number(localStorage.getItem(VOLUME_KEY))
    return localStorage.getItem(VOLUME_KEY) !== null && Number.isFinite(stored) ? Math.max(0, Math.min(1, stored)) : 1
  } catch {
    return 1
  }
}
const CHANNEL_KEY = 'thockdown:music-channel'

/**
 * The music CHANNEL's switch (the dashboard's CD button): switched out, the
 * music is silent whoever plays it, the volume slider kept for its return.
 */
let channelOn = loadChannel()

function loadChannel(): boolean {
  try {
    return localStorage.getItem(CHANNEL_KEY) !== 'off'
  } catch {
    return true
  }
}

/** The gain the native player is given: the slider's, or silence while the channel is switched out. */
function heardGain(): number {
  return channelOn ? volumeGain(levels.volume) : 0
}

let plugin: NativeMusicPlugin | null = null
// Whether the music is heard playing (the native player's `heard` reports).
let playing = false
// The active soundstage as the native processing takes it (musicStageOf), sent with every start.
let stageJson: string | null = null

/** The active soundstage: kept for the next start, heard at once if music plays. */
export function setMusicStage(stage: string): void {
  stageJson = stage
  void plugin?.setStage({ stage })
}

/**
 * Starts the music if it is not playing (the native player picks from the
 * pool), and resolves once a renderer exists, so a `choose` after it lands.
 */
export async function startMusic(): Promise<void> {
  if (!plugin || playing || stageJson === null) return
  setPlaying(true)
  await plugin.play({ stage: stageJson })
}

/** Pauses the music if it plays. */
export function pauseMusic(): void {
  if (!plugin || !playing) return
  setPlaying(false)
  void plugin.pause()
}

/** Switch the music channel in or out of the mix. */
export function setMusicChannel(on: boolean): void {
  if (on === channelOn) return
  channelOn = on
  void plugin?.setVolume({ volume: heardGain() })
  try {
    localStorage.setItem(CHANNEL_KEY, on ? 'on' : 'off')
  } catch {
    // Storage refused: the switch holds until the app is closed.
  }
  for (const listener of playingListeners) listener()
}

export function readMusicChannel(): boolean {
  return channelOn
}

/** On to the pool's next pick, starting the music if it is not playing. */
export function skipMusic(): void {
  if (!plugin) return
  if (!playing) {
    void startMusic()
    return
  }
  void plugin.skip()
}

const playingListeners = new Set<() => void>()

function setPlaying(next: boolean): void {
  if (next === playing) return
  playing = next
  for (const listener of playingListeners) listener()
}

/** Whether the music plays, for useSyncExternalStore. */
export function readMusicPlaying(): boolean {
  return playing
}

/** Told when the music starts or stops playing, or its channel is switched (readMusicChannel). */
export function subscribeMusicPlaying(listener: () => void): () => void {
  playingListeners.add(listener)
  return () => playingListeners.delete(listener)
}

/** Plays `songId`, starting the music first if nothing plays: choosing needs a renderer. */
async function playSong(songId: number): Promise<void> {
  await startMusic()
  await plugin?.choose({ songId })
}

function commit(next: MusicCatalog): void {
  if (next === catalog) return
  catalog = next
  void plugin?.setCatalog({ catalog: JSON.stringify(catalog) })
  publish()
}

function entryOf(songId: number | null): MusicSongEntry | null {
  if (songId === null) return null
  return libraryOf(catalog, rotation).find((song) => song.id === songId) ?? null
}

async function addFolderTo(slot: PlaylistSlot): Promise<boolean> {
  if (!plugin) return false
  const { uri } = await plugin.pickFolder()
  if (!uri) return false
  const scan = await plugin.scanFolder({ uri, known: catalog.songs.map((song) => song.filePath) })
  commit(addScanToSet(catalog, slot, uri, scan.paths, scan.added))
  return true
}

function release(uris: readonly string[]): void {
  for (const uri of uris) void plugin?.releaseFolder({ uri })
}

// The actions are made once: NowPlaying's readers compare them by identity.
const actions = {
  jumpSong(direction: -1 | 1) {
    const pool = poolOf(catalog, rotation)
    if (pool.length === 0) return
    const at = pool.findIndex((song) => song.id === heardSongId)
    const target = pool[(at + direction + pool.length) % pool.length]
    void playSong(target.id)
  },
  playFromPool(id: number) {
    void playSong(id)
  },
  selectSlot(slot: PlaylistSlot, selection: Parameters<NowPlaying['selectSlot']>[1]) {
    commit({ ...catalog, activeSetIds: getNextActiveSlotsForSelection(catalog.activeSetIds, slot, selection) })
  },
  async createMusicSet() {
    const created = createSet(catalog)
    commit(created.catalog)
    return created.slot
  },
  async renameMusicSet(slot: PlaylistSlot, name: string) {
    commit(renameSet(catalog, slot, name))
  },
  moveMusicSet(dragged: PlaylistSlot, target: PlaylistSlot) {
    commit(moveSet(catalog, dragged, target))
  },
  async deleteMusicSet(slot: PlaylistSlot) {
    const deleted = deleteSet(catalog, slot)
    commit(deleted.catalog)
    release(deleted.released)
  },
  async setMusicSetIcon(slot: PlaylistSlot, icon: string | null) {
    commit(setSetIcon(catalog, slot, icon))
  },
  async purgeMusicSet(slot: PlaylistSlot) {
    const purged = purgeSet(catalog, slot)
    commit(purged.catalog)
    release(purged.released)
  },
  async removeFromMusicSet(slot: PlaylistSlot, songIds: number[]) {
    commit(removeFromSet(catalog, slot, songIds))
  },
  // The phone adds FOLDERS only: the folder picker grants a tree, which is
  // what keeps the app free of storage permissions; "files" asks for one too.
  addToMusicSet: (slot: PlaylistSlot) => addFolderTo(slot),
  // Nothing is dropped from a file manager on a phone.
  addPathsToMusicSet: async () => false,
  setPoolFilter(filter: MusicPoolFilter) {
    commit({ ...catalog, filter })
  },
  setLevel(level: keyof SoundLevels, fraction: number) {
    if (level !== 'volume') return
    levels = { ...levels, volume: fraction }
    void plugin?.setVolume({ volume: heardGain() })
    try {
      localStorage.setItem(VOLUME_KEY, String(fraction))
    } catch {
      // Storage refused: the volume holds until the app is closed.
    }
    publish()
  },
}

function publish(): void {
  const slots = catalog.sets.map((set) => set.slot)
  publishNowPlaying({
    ...actions,
    song: entryOf(heardSongId),
    pool: { slots, active: catalog.activeSetIds, counts: setCounts(catalog), filter: catalog.filter },
    musicSets: catalog.sets,
    levels,
  })
}

/**
 * Starts the player against the native plugin: reads the library, answers
 * the shared views' reads, and follows the song heard. Returns a stop.
 */
export async function startMobileMusicPlayer(native: NativeMusicPlugin): Promise<() => void> {
  plugin = native
  const stored = await loadMusicLibrary(native)
  catalog = stored.catalog
  rotation = stored.rotation
  setMusicLibraryReads({
    getPlaylist: async (slot) => libraryOf(catalog, rotation).filter((song) => song.setIds.includes(slot)),
    getPool: async (query) => poolOf({ ...catalog, activeSetIds: query.slots, filter: query.filter }, rotation),
  })
  // The visualizer reads the native music: its clock, its file and its spectrum (nativeMusicListening.ts).
  setMusicListening(createNativeMusicListening(native, (songId) => entryOf(songId)))
  setPlaying((await native.getState()).playing)
  void native.setVolume({ volume: heardGain() })
  publish()
  const handle = await native.addListener('heard', (heard) => {
    setPlaying(heard.playing)
    if (heard.songId === heardSongId) return
    heardSongId = heard.songId
    // A new song means the renderer picked (or was told to): its rotation moved.
    void native.getLibrary().then((library) => {
      rotation = JSON.parse(library.rotation) as MusicRotation
      publish()
    })
  })
  return () => {
    void handle.remove()
    setMusicLibraryReads(null)
    plugin = null
  }
}
