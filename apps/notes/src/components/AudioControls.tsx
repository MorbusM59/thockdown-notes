import { memo, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { MouseEvent } from 'react'
import type { MusicPoolFilter, MusicSet, MusicSongEntry, PlaylistSlot, PlaylistCountsResult } from '../shared/audioPlayer'
import { EMPTY_POOL_FILTER, samePoolFilter, songAlbumText, songArtistText, songTitleText, musicSetMark } from '../shared/audioPlayer'
import {
  AUDIO_GRID_COLUMNS,
  emptyPlaylistCounts,
  getNextActiveSlotsForSelection,
  isFactoryMusicSet,
  PLAYLIST_SLOT_ICONS,
  MUSIC_SET_QUICK_ACCESS_COUNT,
} from '../shared/audioPlayer'
import { adjacentSongInPool } from '../shared/musicPool'
import { FACTORY_SOUNDSCAPE_ICONS, SOUNDSCAPE_FACTORY_PRESETS, applySoundscapePreset, nextSoundscapePreset, type SoundscapePreferences } from '@thockdown/soundscape/soundscape'
import {
  fromDisplayLevel,
  nudgeLevel,
  SOUND_LEVEL_MAX_DISPLAY,
  toDisplayLevel,
} from '@thockdown/soundscape/musicSoundOptions'
import {
  emptyPlayHistory,
  forgetSong,
  pushPlayed,
  stepBack,
} from '../shared/musicPlayHistory'
import {
  useHoldToAdjust,
  type HoldToAdjustKeyboardController,
} from '../shared/useHoldToAdjust'
import { useNonPassiveWheel } from '@thockdown/interaction/useNonPassiveWheel'
import { musicPlayerService, MissingFileError, resolveSeekPress } from '../sound/MusicPlayerService'
import { publishNowPlaying, type SoundLevels } from '../sound/nowPlaying'
// Playback resumed from the previous session (the initialWasPlaying restore
// below) starts at silence and full reverb and ramps up over this span.
import { RESTORE_FADE_IN_SEC } from '@thockdown/soundscape/audioOutputBus'
import { armHold, HOLD_COMMIT_MS } from '@thockdown/interaction/holdTiming'
import { openMusicLibrary, readMusicLibrarySlot, subscribeMusicLibrarySlot } from '../sidebar/musicLibraryView'
import { readSoundstageControls, subscribeSoundstageControls } from '../sound/soundstageControls'
import { CUSTOM_SOUNDSTAGE_ICON, FACTORY_SOUNDSTAGES } from '../shared/soundstages'
import { isTextEntryElement } from '@thockdown/interaction/focusOwnership'
import { beginBackgroundWork } from '../shared/backgroundWork'

// Purging a song from the library and clearing a music set are both
// "I know this is not undoable" -- the app's COMMIT threshold
// (`shared/holdTiming.ts`), which also announces the completion in the
// cursor. Was 700ms of its own.
const HOLD_THRESHOLD_MS = HOLD_COMMIT_MS
const VISUALIZER_DOUBLE_PRESS_MS = 300
const SEEK_HOLD_DELAY_MS = 200
const SEEK_INTERVAL_MS = 100
const SEEK_HOLD_STEP = 0.05
const SEEK_CLICK_STEP = 0.2

type SeekDirection = 1 | -1

async function withMusicIndex<T>(index: () => Promise<T>): Promise<T> {
  const work = beginBackgroundWork('music-index')
  try {
    return await index()
  } finally {
    work.done()
  }
}




/** Latest playback snapshot, kept fresh by AudioControls for the parent to read on save. */
export interface MusicPlaybackSnapshot {
  songId: number | null
  positionSec: number
  wasPlaying: boolean
}

export interface AudioControlsProps {
  /** Whether fullscreen visualizer keyboard controls are active. */
  isVisualizerMode: boolean
  /**
   * 0–1 volume for the music player. This is the LEVEL, not the audibility:
   * it keeps its value while muted (see `isMuted`) so unmuting restores it
   * without a separately remembered copy.
   */
  volume: number
  onVolumeChange: (value: number) => void
  /** Whether volume is currently silenced. The level above is left intact. */
  isMuted: boolean
  onMutedChange: (value: boolean) => void
  /** 0–1 reverb wet mix. Like `volume`, retained while bypassed. */
  reverbAmount: number
  onReverbAmountChange: (value: number) => void
  /** 0–1 reverb room size. */
  reverbRoom: number
  onReverbRoomChange: (value: number) => void
  /**
   * Whether reverb is bypassed. One switch behind two buttons: both the
   * reverb button and the room button toggle it and both show `fa-ban` while
   * it is on, because room size is meaningless with no wet signal.
   */
  isReverbBypassed: boolean
  onReverbBypassedChange: (value: boolean) => void
  /** Which set ids are currently toggled active. */
  activeSlots: PlaylistSlot[]
  onActiveSlotsChange: (slots: PlaylistSlot[]) => void
  musicSets: MusicSet[]
  onMusicSetsChange: (sets: MusicSet[]) => void
  /** The pool's filter (the visualizer's fields): which songs of the active slots are picked. */
  poolFilter: MusicPoolFilter
  onPoolFilterChange: (filter: MusicPoolFilter) => void
  /**
   * Procedural ambience preferences. The player shows only the on/off switch
   * and the master volume (a wheel over that switch); everything else is in
   * the settings panel.
   */
  soundscapePreferences: SoundscapePreferences
  onSoundscapePreferencesChange: (preferences: SoundscapePreferences) => void
  /**
   * Whether the bottom row is showing the sound options instead of the
   * music sets. Owned by the parent so it survives a restart.
   */
  isSoundOptionsOpen: boolean
  onSoundOptionsOpenChange: (value: boolean) => void
  /** DB id of the song that was last active in the previous session, if any. */
  initialSongId?: number | null
  /** Playback position (seconds) to resume the initial song at. */
  initialPositionSec?: number
  /** Whether the initial song was playing when the previous session ended. */
  initialWasPlaying?: boolean
  /**
   * Ref kept up to date with the current song id / position / playing state so
   * the parent can read a fresh snapshot whenever it persists app state,
   * without triggering a re-render on every position tick.
   */
  playbackStateRef?: React.MutableRefObject<MusicPlaybackSnapshot>
  /** The snapshot changed: a track change, a pause or a resume. Saved then, and on quit. */
  onPlaybackStateChange?: () => void
}

export const AudioControls = memo(function AudioControls({
  isVisualizerMode,
  volume,
  onVolumeChange,
  isMuted,
  onMutedChange,
  reverbAmount,
  onReverbAmountChange,
  reverbRoom,
  onReverbRoomChange,
  isReverbBypassed,
  onReverbBypassedChange,
  activeSlots,
  onActiveSlotsChange,
  musicSets,
  onMusicSetsChange,
  poolFilter,
  onPoolFilterChange,
  soundscapePreferences,
  onSoundscapePreferencesChange,
  isSoundOptionsOpen,
  onSoundOptionsOpenChange,
  initialSongId,
  initialPositionSec,
  initialWasPlaying,
  playbackStateRef,
  onPlaybackStateChange,
}: AudioControlsProps) {
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentSong, setCurrentSong] = useState<MusicSongEntry | null>(null)
  const [counts, setCounts] = useState<PlaylistCountsResult>(emptyPlaylistCounts)
  const activeSlotsRef = useRef(activeSlots)
  activeSlotsRef.current = activeSlots
  const selectionVersionRef = useRef(0)
  // Slot button that is currently "primed" for clearing (held right-click)
  /** The set whose list the current right press opened by being held; its release's contextmenu is ignored. */
  const heldSlotRef = useRef<PlaylistSlot | null>(null)
  // Position to seek to once the restored song's first playback begins.
  const pendingSeekSecRef = useRef<number | null>(null)

  const holdTimerRef = useRef<(() => void) | null>(null)
  const seekTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const seekIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const isSeekScrubbing = useRef(false)
  const lastVisualizerSeekPressRef = useRef<{ direction: SeekDirection; atMs: number } | null>(null)
  const visualizerKeysDownRef = useRef(new Set<string>())
  /**
   * Set by the release that ends a scrub, to swallow the click the browser
   * dispatches right after it: pointerup has already cleared
   * `isSeekScrubbing` by then, so without this every left-button scrub ended
   * with an extra 20% press on top. The click follows its pointerup within
   * the same task, so the mark is dropped at the end of that task -- a
   * release off the button produces no click, and must not leave the next
   * genuine one swallowed.
   */
  const swallowScrubClickRef = useRef(false)
  const activeRef = useRef(activeSlots)
  activeRef.current = activeSlots
  // THE POOL is the ACTIVATED sets plus the set open in the Music Library,
  // which plays while it is open there and leaves the pool when another set
  // is opened, unless it was activated. Every pick and walk reads this; the
  // activated sets alone are what is persisted and what the player lights.
  const librarySlot = useSyncExternalStore(subscribeMusicLibrarySlot, readMusicLibrarySlot)
  const openLibrarySlot = librarySlot !== null && musicSets.some((set) => set.slot === librarySlot) ? librarySlot : musicSets[0]?.slot ?? null
  const poolSlots = useMemo(
    () => (openLibrarySlot === null || activeSlots.includes(openLibrarySlot) ? activeSlots : [...activeSlots, openLibrarySlot]),
    [activeSlots, openLibrarySlot],
  )
  const poolSlotsRef = useRef(poolSlots)
  poolSlotsRef.current = poolSlots
  // Written at once by setPoolFilter too, so a song chosen in the same
  // gesture that committed a filter is looked up in that filter's pool.
  const filterRef = useRef(poolFilter)
  filterRef.current = poolFilter

  const currentSongRef = useRef<MusicSongEntry | null>(null)

  // Back-stack of what has been played, so the rewind button's right-click can
  // walk backwards more than one song. A ref, not state: nothing renders from
  // it (the buttons look the same whether or not a previous song exists), and
  // it is written from async playback paths where a stale closure would lose
  // entries. Session-scoped -- a restart starts a fresh tally, with the
  // restored song as its first entry.
  const historyRef = useRef(emptyPlayHistory())

  // Guards the song-crossing that a scrub past either end of a track triggers.
  // The scrub interval keeps firing every 100 ms while the crossing's load is
  // still in flight, and without this each of those ticks would start its own
  // crossing and race the others to set the current song.
  const isCrossingSongRef = useRef(false)

  const refreshCountsRef = useRef(async () => {
    const c = await window.thockdownAudioPlayer?.getPlaylistCounts()
    if (c) setCounts(c)
  })

  // Sync player config whenever props change. The mute/bypass flags are
  // resolved into the graph's numbers HERE and nowhere else: the service keeps
  // taking plain 0-1 config and knows nothing about toggles, so every one of
  // its own uses of config.volume (the scrub dim, the resume-from-pause gain
  // restore, the fade-in ramp) stays silent while muted without any of them
  // needing to learn about mute.
  const effectiveVolume = isMuted ? 0 : volume
  const effectiveReverbAmount = isReverbBypassed ? 0 : reverbAmount
  useEffect(() => {
    musicPlayerService.setConfig({
      volume: effectiveVolume,
      reverbAmount: effectiveReverbAmount,
      reverbRoom,
    })
  }, [effectiveVolume, effectiveReverbAmount, reverbRoom])

  // Refresh playlist counts on mount.
  useEffect(() => {
    void window.thockdownAudioPlayer?.getPlaylistCounts().then((c) => {
      if (c) setCounts(c)
    })
  }, [])

  // Keep currentSongRef in sync so the onEnded closure can read it without going stale.
  useEffect(() => {
    currentSongRef.current = currentSong
  }, [currentSong])

  // Register "song ended" → auto-advance.
  useEffect(() => {
    musicPlayerService.onEnded(() => {
      const finished = currentSongRef.current
      if (finished) {
        void window.thockdownAudioPlayer?.afterPlay(finished.id)
      }
      void advanceToNextSong()
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ---------------------------------------------------------------- helpers

  /** Where in a track playback should begin, when not at the very start. */
  type StartPosition = { fromStart: number } | { fromEnd: number } | { fromFraction: number }

  /**
   * Start a song and put the player's state behind it.
   *
   * `recordInHistory` is false only when the caller has already moved the
   * back-stack cursor itself (walking backwards); recording there would
   * truncate the very entries being walked.
   */
  const playSong = useCallback(async (
    song: MusicSongEntry,
    options: { position?: StartPosition; recordInHistory?: boolean } = {},
  ) => {
    setCurrentSong(song)
    await musicPlayerService.play(song.filePath)
    if (options.recordInHistory !== false) {
      historyRef.current = pushPlayed(historyRef.current, song.id)
    }
    const { position } = options
    if (position && 'fromStart' in position) {
      musicPlayerService.setCurrentTime(position.fromStart)
    } else if (position && 'fromEnd' in position) {
      await musicPlayerService.setCurrentTimeFromEnd(position.fromEnd)
    } else if (position && 'fromFraction' in position) {
      await musicPlayerService.setCurrentTimeFraction(position.fromFraction)
    }
    // play() restores gain to the configured volume (it has to, for the
    // resume-from-pause case), which would undo the scrub dim mid-gesture --
    // so a crossing that happens during a hold re-applies it.
    if (isSeekScrubbing.current) musicPlayerService.beginScrub()
    setIsPlaying(true)
  }, [])

  /** Drop a song that no longer exists from both the database and the tally. */
  const purgeMissingSong = useCallback(async (songId: number) => {
    await window.thockdownAudioPlayer?.purgeSong(songId)
    historyRef.current = forgetSong(historyRef.current, songId)
    await refreshCountsRef.current()
  }, [])

  const advanceToNextSong = useCallback(async (
    slotsOverride?: PlaylistSlot[],
    startAtSec = 0,
  ) => {
    const slots = slotsOverride ?? poolSlotsRef.current
    if (slots.length === 0) {
      setIsPlaying(false)
      setCurrentSong(null)
      return
    }

    // Safety limit: avoid an infinite loop if every song in the pool is missing.
    const MAX_ATTEMPTS = 50
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const next = await window.thockdownAudioPlayer?.pickNextSong({ slots, filter: filterRef.current })
      if (!next) {
        setIsPlaying(false)
        setCurrentSong(null)
        return
      }
      try {
        await playSong(next, startAtSec > 0 ? { position: { fromStart: startAtSec } } : {})
        return
      } catch (err) {
        if (err instanceof MissingFileError) {
          // Silently purge the bad entry and try the next song.
          await purgeMissingSong(next.id)
          musicPlayerService.stop()
          continue
        }
        // Non-file-missing error (e.g. AbortError from rapid pause): surface it.
        throw err
      }
    }

    // Exhausted retries — give up.
    setIsPlaying(false)
    setCurrentSong(null)
  }, [playSong, purgeMissingSong])

  /**
   * Walk one song back through the tally. Returns false when there is nothing
   * behind the current song, so callers can leave the playhead where it is
   * rather than inventing a destination.
   *
   * Songs purged since they were played are skipped over rather than treated
   * as the end of the road -- the loop keeps stepping back past them, which is
   * what a listener means by "the one before this".
   */
  const playPreviousSong = useCallback(async (position?: StartPosition): Promise<boolean> => {
    for (;;) {
      const step = stepBack(historyRef.current)
      if (!step) return false

      const song = await window.thockdownAudioPlayer?.getSongById(step.songId)
      if (!song) {
        historyRef.current = forgetSong(historyRef.current, step.songId)
        continue
      }

      // Commit the cursor move before playing, so playSong does not re-record
      // (and thereby truncate) the entries being walked.
      historyRef.current = step.history
      try {
        await playSong(song, { position, recordInHistory: false })
        return true
      } catch (err) {
        if (err instanceof MissingFileError) {
          await purgeMissingSong(song.id)
          musicPlayerService.stop()
          continue
        }
        throw err
      }
    }
  }, [playSong, purgeMissingSong])

  // ---------------------------------------------------------------- restore last session

  // Restore the last-played song (paused, cued at its saved position) once the
  // parent finishes loading app state and supplies a real id. initialSongId
  // only ever transitions from null/undefined to a number once, so this runs
  // a single time per app launch.
  useEffect(() => {
    if (initialSongId == null) return
    let cancelled = false
    void (async () => {
      const song = await window.thockdownAudioPlayer?.getSongById(initialSongId)
      if (cancelled || !song) return
      pendingSeekSecRef.current = initialPositionSec ?? 0
      setCurrentSong(song)
      // Seed the tally with the restored song, so it is the floor a rewind
      // walks back to rather than a gap before the first song of this session.
      historyRef.current = pushPlayed(historyRef.current, song.id)
      if (initialWasPlaying) {
        try {
          await musicPlayerService.play(song.filePath)
          musicPlayerService.beginFadeIn(RESTORE_FADE_IN_SEC)
          if (pendingSeekSecRef.current) musicPlayerService.setCurrentTime(pendingSeekSecRef.current)
          pendingSeekSecRef.current = null
          setIsPlaying(true)
        } catch {
          // Playback may be refused this early (no user gesture yet). Leave
          // the song cued up and paused rather than treating it as missing.
          musicPlayerService.stop()
        }
      }
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialSongId])

  // The parent-owned snapshot follows the moments the position is saved at:
  // a track change and a pause (and a resume, which is the same effect). In
  // between, a save reads the live position itself (App's snapshot), so
  // nothing has to keep the position fresh while a track plays.
  const onPlaybackStateChangeRef = useRef(onPlaybackStateChange)
  onPlaybackStateChangeRef.current = onPlaybackStateChange
  useEffect(() => {
    if (!playbackStateRef) return
    playbackStateRef.current.songId = currentSong?.id ?? null
    playbackStateRef.current.wasPlaying = isPlaying
    playbackStateRef.current.positionSec = musicPlayerService.currentTime
    onPlaybackStateChangeRef.current?.()
  }, [playbackStateRef, currentSong, isPlaying])

  // ---------------------------------------------------------------- play / stop

  const handlePlayToggle = useCallback(async () => {
    if (isPlaying) {
      musicPlayerService.pause()
      setIsPlaying(false)
    } else {
      if (currentSong) {
        try {
          // Resume the current song.
          await musicPlayerService.play(currentSong.filePath)
          if (pendingSeekSecRef.current != null) {
            musicPlayerService.setCurrentTime(pendingSeekSecRef.current)
            pendingSeekSecRef.current = null
          }
          setIsPlaying(true)
        } catch (err) {
          if (err instanceof MissingFileError) {
            // File gone since last session — purge and pick a fresh song.
            await purgeMissingSong(currentSong.id)
            setCurrentSong(null)
            musicPlayerService.stop()
            await advanceToNextSong()
          } else {
            throw err
          }
        }
      } else {
        await advanceToNextSong()
      }
    }
  }, [isPlaying, currentSong, advanceToNextSong, purgeMissingSong])

  // ---------------------------------------------------------------- favorability button

  // The button is a toggle. Pressing it on an already-favourited song takes the
  // replay marker back off, which is a priority change only -- favorability
  // stays where it is, so toggling off does not walk back the earlier presses
  // that raised it.
  const handleFavoriteLeft = useCallback(async () => {
    if (!currentSong) return
    const api = window.thockdownAudioPlayer
    const updated = currentSong.priority === 0
      ? await api?.unfavoriteSong(currentSong.id)
      : await api?.favoriteSong(currentSong.id)
    if (updated) setCurrentSong(updated)
  }, [currentSong])

  const handleSkipRight = useCallback(async (event: MouseEvent) => {
    event.preventDefault()
    if (!currentSong) return
    await window.thockdownAudioPlayer?.skipSong(currentSong.id)
    if (currentSong.id != null) {
      await window.thockdownAudioPlayer?.afterPlay(currentSong.id)
    }
    await musicPlayerService.fadeOut()
    await advanceToNextSong()
  }, [currentSong, advanceToNextSong])

  const handleFavoriteContextMenu = useCallback((event: MouseEvent) => {
    event.preventDefault()
    // Right-click = skip; check for held right-click is handled by pointer events below.
    void handleSkipRight(event)
  }, [handleSkipRight])

  // Held right-click on the favorability button = purge song.
  const favHoldTimerRef = useRef<(() => void) | null>(null)
  const favPrimedRef = useRef(false)

  const handleFavPointerDown = useCallback((event: React.PointerEvent) => {
    if (event.button !== 2) return
    event.preventDefault()
    favPrimedRef.current = false
    favHoldTimerRef.current = armHold(() => {
      favPrimedRef.current = true
    }, HOLD_THRESHOLD_MS)
  }, [])

  const handleFavPointerUp = useCallback(async (event: React.PointerEvent) => {
    if (event.button !== 2) return
    if (favHoldTimerRef.current) {
      favHoldTimerRef.current()
      favHoldTimerRef.current = null
    }
    if (favPrimedRef.current && currentSong) {
      favPrimedRef.current = false
      musicPlayerService.stop()
      setIsPlaying(false)
      await purgeMissingSong(currentSong.id)
      setCurrentSong(null)
      // Pick the next song.
      await advanceToNextSong()
    }
    // Normal right-click handled by contextmenu event.
  }, [currentSong, advanceToNextSong, purgeMissingSong])

  // ---------------------------------------------------------------- seek buttons
  // Two direction-fixed buttons, rewind and forward, each owning its own way
  // through the music on every gesture:
  //   left-click        seek 20% of the track that way
  //   right-click       change song that way (see jumpSong)
  //   hold either       scrub 5% per 100 ms after a 200 ms delay
  // A scrub that runs off either end of the track carries the overshoot into
  // the neighbouring song rather than stalling against the file boundary, so a
  // held rewind walks backwards through the tally continuously.

  /**
   * Seek within the current track, continuing into the next or previous song
   * with whatever the track could not absorb.
   *
   * The forward crossing is deliberately the same path a song ending takes,
   * afterPlay included, because running off the end of a track IS that track
   * finishing as far as the library's priority bookkeeping is concerned.
   */
  const seekBy = useCallback(async (fraction: number) => {
    const overshootSec = musicPlayerService.seek(fraction)
    if (overshootSec === 0) return
    // A crossing is already loading; this tick's overshoot belongs to the track
    // being left behind, so dropping it is correct rather than merely safe.
    if (isCrossingSongRef.current) return

    isCrossingSongRef.current = true
    try {
      if (overshootSec > 0) {
        const finished = currentSongRef.current
        if (finished) await window.thockdownAudioPlayer?.afterPlay(finished.id)
        await advanceToNextSong(undefined, overshootSec)
      } else {
        // No previous song: the playhead stays pinned at 0, which is where
        // seek() already left it.
        await playPreviousSong({ fromEnd: -overshootSec })
      }
    } finally {
      isCrossingSongRef.current = false
    }
  }, [advanceToNextSong, playPreviousSong])

  /**
   * Play the adjacent song in the active pool's displayed order. The pool is
   * read ONCE and walked in `direction` from the current song: a song whose
   * file is gone is purged and the walk moves on to the next candidate of the
   * same list, so the walk is bounded by the pool itself and never re-reads it.
   */
  const playAdjacentSong = useCallback(async (direction: SeekDirection) => {
    const query = { slots: poolSlotsRef.current, filter: filterRef.current }
    const pool = await window.thockdownAudioPlayer?.getPool(query) ?? []
    const currentId = currentSongRef.current?.id
    let purgedMissingSong = false
    let candidateId = currentId
    for (let step = 0; step < pool.length; step += 1) {
      const target = adjacentSongInPool(pool, candidateId, direction)
      if (!target || target.id === currentId) break
      candidateId = target.id
      const song = await window.thockdownAudioPlayer?.rotatePoolTo(query, target.id)
      if (!song) continue
      try {
        await playSong(song)
        return
      } catch (err) {
        if (!(err instanceof MissingFileError)) throw err
        purgedMissingSong = true
        await purgeMissingSong(song.id)
        musicPlayerService.stop()
      }
    }
    if (purgedMissingSong) {
      setIsPlaying(false)
      setCurrentSong(null)
    }
  }, [playSong, purgeMissingSong])

  /**
   * Right-click, media keys and the visualizer's repeated arrow press all use
   * this command, so they move through the same active-pool ring.
   */
  const jumpSong = useCallback(async (direction: SeekDirection) => {
    if (isCrossingSongRef.current) return
    isCrossingSongRef.current = true
    try {
      await playAdjacentSong(direction)
    } finally {
      isCrossingSongRef.current = false
    }
  }, [playAdjacentSong])

  /**
   * Play a song chosen from the pool (the visualizer's song list, a song
   * clicked in the Music Library). The pool's order is rotated to it first
   * (`shared/musicPool.ts`), so the song that was playing and those skipped
   * over keep their places in the ring; nothing is counted as played, which
   * is why there is no afterPlay here. A song the pool does not hold (the
   * filter leaves it out) is played as given: the song playing belongs to the
   * pool while it plays, and the next pick comes from the pool as usual.
   */
  const playFromPool = useCallback(async (id: number, entry?: MusicSongEntry) => {
    if (isCrossingSongRef.current || currentSongRef.current?.id === id) return
    isCrossingSongRef.current = true
    try {
      const song = await window.thockdownAudioPlayer?.rotatePoolTo({ slots: poolSlotsRef.current, filter: filterRef.current }, id) ?? entry
      if (!song) return
      try {
        await playSong(song)
      } catch (err) {
        if (!(err instanceof MissingFileError)) throw err
        await purgeMissingSong(song.id)
        musicPlayerService.stop()
        await advanceToNextSong()
      }
    } finally {
      isCrossingSongRef.current = false
    }
  }, [playSong, purgeMissingSong, advanceToNextSong])

  const startSeekHold = useCallback((direction: SeekDirection) => {
    seekTimerRef.current = setTimeout(() => {
      seekTimerRef.current = null
      lastVisualizerSeekPressRef.current = null
      isSeekScrubbing.current = true
      musicPlayerService.beginScrub()
      void seekBy(direction * SEEK_HOLD_STEP)
      seekIntervalRef.current = setInterval(() => {
        void seekBy(direction * SEEK_HOLD_STEP)
      }, SEEK_INTERVAL_MS)
    }, SEEK_HOLD_DELAY_MS)
  }, [seekBy])

  const stopSeekScrub = useCallback(() => {
    if (seekTimerRef.current) {
      clearTimeout(seekTimerRef.current)
      seekTimerRef.current = null
    }
    if (seekIntervalRef.current) {
      clearInterval(seekIntervalRef.current)
      seekIntervalRef.current = null
    }
    if (isSeekScrubbing.current) {
      musicPlayerService.endScrub()
    }
    isSeekScrubbing.current = false
  }, [])

  const handleSeekPointerDown = useCallback((event: React.PointerEvent, direction: SeekDirection) => {
    if (event.button !== 0 && event.button !== 2) return
    event.preventDefault()
    startSeekHold(direction)
  }, [startSeekHold])

  /**
   * The right-click action fires from pointer-up rather than from the
   * contextmenu event, because contextmenu fires on press on some platforms
   * and on release on others -- and on the press-firing ones it would jump to
   * another song the instant a hold-to-scrub gesture began, before the scrub
   * had a chance to mark itself. Waiting for the release means the same code
   * decides between "this was a click" and "this was a hold" everywhere.
   */
  const handleSeekPointerUp = useCallback((event: React.PointerEvent, direction: SeekDirection) => {
    if (event.button !== 0 && event.button !== 2) return
    const wasScrubbing = isSeekScrubbing.current
    stopSeekScrub()
    if (wasScrubbing) {
      if (event.button === 0) {
        swallowScrubClickRef.current = true
        window.setTimeout(() => { swallowScrubClickRef.current = false }, 0)
      }
      return
    }
    if (event.button === 2) void jumpSong(direction)
  }, [stopSeekScrub, jumpSong])

  /**
   * A 20% press. Unlike the scrub above this never carries a leftover into the
   * neighbouring song -- resolveSeekPress turns a press that cannot complete
   * inside the track into a landmark instead, and this plays whichever one it
   * named. See that function for why the two gestures differ.
   */
  const handleSeekActivate = useCallback(async (direction: SeekDirection) => {
    // A hold that already scrubbed swallows the click that ends it, so a
    // release after scrubbing does not tack an extra 20% on top.
    if (swallowScrubClickRef.current) {
      swallowScrubClickRef.current = false
      return
    }
    if (isSeekScrubbing.current || isCrossingSongRef.current) return

    const outcome = resolveSeekPress(
      musicPlayerService.currentTime,
      musicPlayerService.currentDurationSec,
      direction * SEEK_CLICK_STEP,
    )

    if (outcome.kind === 'within') {
      await musicPlayerService.seekWithFade(outcome.timeSec)
      return
    }
    if (outcome.kind === 'restart') {
      await musicPlayerService.seekWithFade(0)
      return
    }

    isCrossingSongRef.current = true
    try {
      if (outcome.kind === 'next-song') {
        const finished = currentSongRef.current
        if (finished) await window.thockdownAudioPlayer?.afterPlay(finished.id)
        await advanceToNextSong()
        return
      }
      // No song behind this one: fall back to restarting, so the press still
      // does the nearest thing it can rather than nothing at all.
      const moved = await playPreviousSong({ fromFraction: outcome.entryFraction })
      if (!moved) musicPlayerService.setCurrentTime(0)
    } finally {
      isCrossingSongRef.current = false
    }
  }, [advanceToNextSong, playPreviousSong])

  const handleSeekContextMenu = useCallback((event: React.MouseEvent) => {
    // Suppress the native menu only; the action itself runs on pointer-up.
    event.preventDefault()
  }, [])

  // ---------------------------------------------------------------- playlist buttons

  /**
   * Change the activated sets. The song playing plays on whatever the change:
   * it belongs to the pool while it plays, and the next pick reads the new pool.
   */
  const selectSlot = useCallback(async (slot: PlaylistSlot, additive: boolean) => {
    const next = getNextActiveSlotsForSelection(activeSlotsRef.current, slot, additive)
    selectionVersionRef.current += 1
    activeSlotsRef.current = next
    onActiveSlotsChange(next)
  }, [onActiveSlotsChange])

  const keepOnlyQuickAccessSlots = useCallback(async (quickAccessSlots: readonly PlaylistSlot[]) => {
    const quick = new Set(quickAccessSlots)
    const nextActiveSlots = activeSlotsRef.current.filter((slot) => quick.has(slot))
    if (nextActiveSlots.length === activeSlotsRef.current.length) return
    activeSlotsRef.current = nextActiveSlots
    activeRef.current = nextActiveSlots
    onActiveSlotsChange(nextActiveSlots)
  }, [onActiveSlotsChange])

  const addPathsToMusicSet = useCallback(async (slot: PlaylistSlot, paths: string[]): Promise<boolean> => {
    if (paths.length === 0) return false
    const indexedCount = await withMusicIndex(async () => window.thockdownAudioPlayer?.addPaths(slot, paths))
    if (!indexedCount) return false
    await refreshCountsRef.current()
    return true
  }, [])

  const addToMusicSet = useCallback(async (slot: PlaylistSlot, source: 'files' | 'folder'): Promise<boolean> => {
    if (source === 'files') {
      const files = await window.thockdownAudioPlayer?.pickFiles()
      if (!files || files.length === 0) return false
      await withMusicIndex(async () => window.thockdownAudioPlayer?.addSongs(slot, files))
      await refreshCountsRef.current()
      return true
    }

    const folder = await window.thockdownAudioPlayer?.pickFolder()
    if (!folder) return false
    const indexedCount = await withMusicIndex(async () => window.thockdownAudioPlayer?.addFolder(slot, folder))
    if (!indexedCount) return false
    await refreshCountsRef.current()
    return true
  }, [])

  const handleSlotLeftClick = useCallback(async (event: MouseEvent, slot: PlaylistSlot) => {
    const additive = event.shiftKey
    if ((counts[slot] ?? 0) === 0) {
      const selectionVersion = selectionVersionRef.current
      if (await addToMusicSet(slot, 'files') && selectionVersion === selectionVersionRef.current) {
        await selectSlot(slot, additive)
      }
      return
    }
    await selectSlot(slot, additive)
  }, [counts, addToMusicSet, selectSlot])


  const handleSlotRightClick = useCallback(async (event: MouseEvent, slot: PlaylistSlot) => {
    event.preventDefault()
    // The release of a hold that opened the set list is not a right-click.
    if (heldSlotRef.current === slot) return
    await addToMusicSet(slot, 'files')
  }, [addToMusicSet])

  const handleSlotPointerDown = useCallback((event: React.PointerEvent, slot: PlaylistSlot) => {
    if (event.button !== 2) return
    event.preventDefault()
    heldSlotRef.current = null
    // A held right press opens the set's songs in the sidebar (the Music Library).
    holdTimerRef.current = armHold(() => {
      holdTimerRef.current = null
      heldSlotRef.current = slot
      openMusicLibrary(slot)
    }, HOLD_THRESHOLD_MS)
  }, [])

  /**
   * Take a set out of the activated sets (deactivated, purged or deleted) and
   * refresh the counts. The song playing plays on.
   */
  const leaveSet = useCallback(async (slot: PlaylistSlot) => {
    const nextActiveSlots = activeSlotsRef.current.filter((activeSlot) => activeSlot !== slot)
    activeSlotsRef.current = nextActiveSlots
    activeRef.current = nextActiveSlots
    onActiveSlotsChange(nextActiveSlots)
    await refreshCountsRef.current()
  }, [onActiveSlotsChange])

  /** Songs out of one set. The song playing plays on, even when it was among them. */
  const removeFromMusicSet = useCallback(async (slot: PlaylistSlot, songIds: number[]) => {
    await window.thockdownAudioPlayer?.removeFromSet(slot, songIds)
    await refreshCountsRef.current()
    const currentSong = currentSongRef.current
    if (!currentSong || !songIds.includes(currentSong.id)) return
    setCurrentSong({ ...currentSong, setIds: currentSong.setIds.filter((setId) => setId !== slot) })
  }, [])

  const purgeMusicSet = useCallback(async (slot: PlaylistSlot) => {
    const audioPlayer = window.thockdownAudioPlayer
    if (!audioPlayer) {
      console.error('[music-sets] cannot purge a set without the audio player bridge')
      return
    }
    await audioPlayer.clearPlaylist(slot)
    await leaveSet(slot)
  }, [leaveSet])

  const cancelSlotHold = useCallback(() => {
    if (holdTimerRef.current) {
      holdTimerRef.current()
      holdTimerRef.current = null
    }
  }, [])

  const handleSlotShiftRightClick = useCallback(async (event: MouseEvent, slot: PlaylistSlot) => {
    if (!event.shiftKey) return
    event.preventDefault()
    const selectionVersion = selectionVersionRef.current
    const added = await addToMusicSet(slot, 'folder')
    if (added && selectionVersion === selectionVersionRef.current) await selectSlot(slot, true)
  }, [addToMusicSet, selectSlot])

  // Combine shift+right-click vs plain right-click on slot buttons.
  const handleSlotContextMenu = useCallback(async (event: MouseEvent, slot: PlaylistSlot) => {
    if (event.shiftKey) {
      await handleSlotShiftRightClick(event, slot)
    } else {
      await handleSlotRightClick(event, slot)
    }
  }, [handleSlotShiftRightClick, handleSlotRightClick])

  const createMusicSet = useCallback(async (): Promise<PlaylistSlot | null> => {
    const audioPlayer = window.thockdownAudioPlayer
    if (!audioPlayer) {
      console.error('[music-sets] cannot create a set without the audio player bridge')
      return null
    }
    selectionVersionRef.current += 1
    const next = await audioPlayer.createMusicSet()
    onMusicSetsChange(next)
    await keepOnlyQuickAccessSlots(next.slice(0, MUSIC_SET_QUICK_ACCESS_COUNT).map((set) => set.slot))
    // A new set is appended (databaseService.ts's createMusicSet), so it is the last.
    return next.at(-1)?.slot ?? null
  }, [onMusicSetsChange, keepOnlyQuickAccessSlots])

  const renameMusicSet = useCallback(async (slot: PlaylistSlot, name: string) => {
    if (isFactoryMusicSet(slot)) return
    const nextName = name.trim().slice(0, 64)
    if (!nextName) return
    const audioPlayer = window.thockdownAudioPlayer
    if (!audioPlayer) {
      throw new Error('The audio player is unavailable.')
    }
    onMusicSetsChange(await audioPlayer.renameMusicSet(slot, nextName))
  }, [onMusicSetsChange])

  const reorderMusicSets = useCallback(async (draggedSlot: PlaylistSlot, targetSlot: PlaylistSlot) => {
    const audioPlayer = window.thockdownAudioPlayer
    if (!audioPlayer) {
      console.error('[music-sets] cannot reorder sets without the audio player bridge')
      return
    }
    selectionVersionRef.current += 1
    const next = await audioPlayer.moveMusicSet(draggedSlot, targetSlot)
    onMusicSetsChange(next)
    await keepOnlyQuickAccessSlots(next.slice(0, MUSIC_SET_QUICK_ACCESS_COUNT).map((set) => set.slot))
  }, [onMusicSetsChange, keepOnlyQuickAccessSlots])

  const deleteMusicSet = useCallback(async (slot: PlaylistSlot) => {
    if (isFactoryMusicSet(slot)) return
    const audioPlayer = window.thockdownAudioPlayer
    if (!audioPlayer) {
      console.error('[music-sets] cannot delete a set without the audio player bridge')
      return
    }
    selectionVersionRef.current += 1
    const nextSets = await audioPlayer.deleteMusicSet(slot)
    onMusicSetsChange(nextSets)
    await leaveSet(slot)
  }, [onMusicSetsChange, leaveSet])

  // ---------------------------------------------------------------- system media controls
  // The OS shows its own player for whatever this window is playing (the
  // Windows media flyout, media keys, the lock screen). Without Media Session
  // data it names the window and nothing else, and its previous/next buttons
  // do nothing. It gets the same song and the same three actions as the
  // transport here: play/pause, previous (walk back) and next (a fresh song).
  // The visualizer's level bars set a level outright, under the same
  // "adjusting turns it back on" rule as the wheel and the hold (written out
  // here rather than through unmuteForAdjust, which is declared below).
  const setLevel = useCallback((level: keyof SoundLevels, fraction: number) => {
    const value = Math.max(0, Math.min(1, fraction))
    if (level === 'volume') {
      if (isMuted) onMutedChange(false)
      onVolumeChange(value)
    } else {
      if (isReverbBypassed) onReverbBypassedChange(false)
      if (level === 'reverb') onReverbAmountChange(value)
      else onReverbRoomChange(value)
    }
  }, [isMuted, onMutedChange, isReverbBypassed, onReverbBypassedChange, onVolumeChange, onReverbAmountChange, onReverbRoomChange])

  const mediaActionsRef = useRef({ handlePlayToggle, jumpSong, playFromPool, selectSlot, setLevel, isPlaying })
  mediaActionsRef.current = { handlePlayToggle, jumpSong, playFromPool, selectSlot, setLevel, isPlaying }

  useEffect(() => {
    const session = navigator.mediaSession
    if (!session) return
    const actions: [MediaSessionAction, MediaSessionActionHandler][] = [
      ['play', () => { if (!mediaActionsRef.current.isPlaying) void mediaActionsRef.current.handlePlayToggle() }],
      ['pause', () => { if (mediaActionsRef.current.isPlaying) void mediaActionsRef.current.handlePlayToggle() }],
      ['previoustrack', () => { void mediaActionsRef.current.jumpSong(-1) }],
      ['nexttrack', () => { void mediaActionsRef.current.jumpSong(1) }],
    ]
    for (const [action, handler] of actions) session.setActionHandler(action, handler)
    return () => {
      for (const [action] of actions) session.setActionHandler(action, null)
    }
  }, [])

  useEffect(() => {
    const session = navigator.mediaSession
    if (!session) return
    session.metadata = currentSong
      ? new MediaMetadata({ title: songTitleText(currentSong), artist: songArtistText(currentSong), album: songAlbumText(currentSong) })
      : null
  }, [currentSong])

  // The same song and the same previous/next for the visualizer mode's
  // now-playing strip (sound/nowPlaying.ts). Through the ref, so the action
  // published once stays current.
  const publishedJumpSong = useCallback((direction: -1 | 1) => { void mediaActionsRef.current.jumpSong(direction) }, [])
  const publishedPlayFromPool = useCallback((id: number, entry?: MusicSongEntry) => { void mediaActionsRef.current.playFromPool(id, entry) }, [])
  const publishedSelectSlot = useCallback((slot: PlaylistSlot, additive: boolean) => {
    void mediaActionsRef.current.selectSlot(slot, additive)
  }, [])
  // A new filter applies from the next pick: the song playing plays on.
  const setPoolFilter = useCallback((filter: MusicPoolFilter) => {
    if (samePoolFilter(filter, filterRef.current)) return
    filterRef.current = filter
    onPoolFilterChange(filter)
  }, [onPoolFilterChange])
  const isPoolFiltered = !samePoolFilter(poolFilter, EMPTY_POOL_FILTER)
  const publishedPool = useMemo(() => ({ slots: poolSlots, active: activeSlots, counts, filter: poolFilter }), [poolSlots, activeSlots, counts, poolFilter])
  const publishedLevels = useMemo(() => ({ volume, reverb: reverbAmount, room: reverbRoom }), [volume, reverbAmount, reverbRoom])
  const publishedSetLevel = useCallback((level: keyof SoundLevels, fraction: number) => { mediaActionsRef.current.setLevel(level, fraction) }, [])
  useEffect(() => {
    publishNowPlaying({
      song: currentSong,
      jumpSong: publishedJumpSong,
      pool: publishedPool,
      musicSets,
      playFromPool: publishedPlayFromPool,
      selectSlot: publishedSelectSlot,
      createMusicSet,
      renameMusicSet,
      moveMusicSet: reorderMusicSets,
      deleteMusicSet,
      purgeMusicSet,
      leaveMusicSet: leaveSet,
      removeFromMusicSet,
      addToMusicSet,
      addPathsToMusicSet,
      setPoolFilter,
      levels: publishedLevels,
      setLevel: publishedSetLevel,
    })
  }, [
    currentSong,
    publishedJumpSong,
    publishedPool,
    musicSets,
    publishedPlayFromPool,
    publishedSelectSlot,
    createMusicSet,
    renameMusicSet,
    reorderMusicSets,
    deleteMusicSet,
    purgeMusicSet,
    leaveSet,
    removeFromMusicSet,
    addToMusicSet,
    addPathsToMusicSet,
    setPoolFilter,
    publishedLevels,
    publishedSetLevel,
  ])

  useEffect(() => {
    const session = navigator.mediaSession
    if (!session) return
    session.playbackState = currentSong ? (isPlaying ? 'playing' : 'paused') : 'none'
  }, [currentSong, isPlaying])

  // ---------------------------------------------------------------- song label

  const songLabel = currentSong
    ? `${currentSong.favorability} | ${songTitleText(currentSong)} (${songArtistText(currentSong)})`
    : 'No song'

  // ---------------------------------------------------------------- sound options
  // The headphones button swaps the bottom row's five music sets for the
  // six soundstages (the five factory stages and the custom one, played
  // through the published soundstage controls). It is a swap, not an overlay:
  // the row keeps its geometry, so nothing under the cursor moves and the
  // grid stays 2x6 in both states.
  //
  // Adjusting a level while its toggle is off turns the toggle back on. A
  // number that changes while nothing can be heard is a dead control.

  // Wheel and hold share the "adjusting turns it back on" rule, so they share
  // the intent that expresses it rather than each remembering to do it.
  const unmuteForAdjust = useCallback(() => {
    if (isMuted) onMutedChange(false)
  }, [isMuted, onMutedChange])

  const unbypassForAdjust = useCallback(() => {
    if (isReverbBypassed) onReverbBypassedChange(false)
  }, [isReverbBypassed, onReverbBypassedChange])

  // One wheel step per level, shared by the level's own readout and the
  // headphones button, so both obey the same "adjusting turns it back on" rule.
  const nudgeVolume = useCallback((deltaY: number, coarse: boolean) => {
    unmuteForAdjust()
    onVolumeChange(nudgeLevel(volume, deltaY, coarse))
  }, [volume, unmuteForAdjust, onVolumeChange])

  const nudgeReverb = useCallback((deltaY: number, coarse: boolean) => {
    unbypassForAdjust()
    onReverbAmountChange(nudgeLevel(reverbAmount, deltaY, coarse))
  }, [reverbAmount, unbypassForAdjust, onReverbAmountChange])

  const nudgeRoom = useCallback((deltaY: number, coarse: boolean) => {
    unbypassForAdjust()
    onReverbRoomChange(nudgeLevel(reverbRoom, deltaY, coarse))
  }, [reverbRoom, unbypassForAdjust, onReverbRoomChange])

  // The headphones button adjusts sound from the wheel whichever row is
  // showing: plain scroll for volume, Shift for reverb, Ctrl for room. The
  // modifiers pick the level here, so there is no coarse step. Native and non-passive so the page cannot scroll
  // under it, and so Ctrl+wheel cannot zoom the page instead.
  const soundOptionsButtonRef = useRef<HTMLButtonElement | null>(null)
  const handleSoundOptionsWheel = useCallback((event: WheelEvent) => {
    event.preventDefault()
    if (event.shiftKey) nudgeReverb(event.deltaY, false)
    else if (event.ctrlKey || event.metaKey) nudgeRoom(event.deltaY, false)
    else nudgeVolume(event.deltaY, false)
  }, [nudgeVolume, nudgeReverb, nudgeRoom])
  useNonPassiveWheel(soundOptionsButtonRef, handleSoundOptionsWheel)

  // The tooltip states the wheel mapping above with the live levels, so the
  // button teaches its own gesture. A muted/bypassed level still shows its
  // number (what adjusting would resume from) marked as off.
  const soundOptionsTooltip = [
    `[Scroll] Volume: ${toDisplayLevel(volume)}${isMuted ? ' (muted)' : ''}`,
    `[Shift] Reverb: ${toDisplayLevel(reverbAmount)}${isReverbBypassed ? ' (off)' : ''}`,
    `[Ctrl] Room: ${toDisplayLevel(reverbRoom)}${isReverbBypassed ? ' (off)' : ''}`,
    isMuted ? '[Right-click] Unmute' : '[Right-click] Mute',
  ].join('\n')

  // The hold gesture speaks in printed 0-99 levels; the graph wants fractions.
  const handleVolumeLevel = useCallback((display: number) => {
    onVolumeChange(fromDisplayLevel(display))
  }, [onVolumeChange])

  const volumeHoldControllerRef = useRef<HoldToAdjustKeyboardController | null>(null)
  const volumeDisplayRef = useRef(toDisplayLevel(volume))
  volumeDisplayRef.current = toDisplayLevel(volume)

  // The visualizer's Up/Down keys hold the volume through this controller.
  useHoldToAdjust({
    getValue: () => volumeDisplayRef.current,
    onChange: handleVolumeLevel,
    onHoldStart: unmuteForAdjust,
    min: 0,
    max: SOUND_LEVEL_MAX_DISPLAY,
  }, volumeHoldControllerRef)
  useEffect(() => {
    if (!isVisualizerMode) return
    const activeKeys = visualizerKeysDownRef.current
    const keyCode = (event: KeyboardEvent): string | null => {
      if (event.code === 'Space' || event.key === ' ') return 'Space'
      return ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key) ? event.key : null
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return
      // Typing in one of the visualizer's fields (the pool filter) is text.
      if (event.target instanceof Element && isTextEntryElement(event.target)) return
      const code = keyCode(event)
      if (!code) return
      event.preventDefault()
      event.stopImmediatePropagation()
      if (event.repeat || activeKeys.has(code)) return
      activeKeys.add(code)

      if (code === 'ArrowLeft') startSeekHold(-1)
      else if (code === 'ArrowRight') startSeekHold(1)
      else if (code === 'ArrowUp') volumeHoldControllerRef.current?.start(2)
      else if (code === 'ArrowDown') volumeHoldControllerRef.current?.start(0)
    }

    const onKeyUp = (event: KeyboardEvent) => {
      const code = keyCode(event)
      if (!code || !activeKeys.has(code)) return
      event.preventDefault()
      event.stopImmediatePropagation()
      activeKeys.delete(code)

      if (code === 'Space') {
        void handlePlayToggle()
      } else if (code === 'ArrowLeft' || code === 'ArrowRight') {
        const direction: SeekDirection = code === 'ArrowLeft' ? -1 : 1
        const wasScrubbing = isSeekScrubbing.current
        stopSeekScrub()
        if (wasScrubbing) return

        const now = performance.now()
        const lastPress = lastVisualizerSeekPressRef.current
        if (lastPress?.direction === direction && now - lastPress.atMs <= VISUALIZER_DOUBLE_PRESS_MS) {
          lastVisualizerSeekPressRef.current = null
          void jumpSong(direction)
        } else {
          lastVisualizerSeekPressRef.current = { direction, atMs: now }
          void handleSeekActivate(direction)
        }
      } else {
        volumeHoldControllerRef.current?.end()
      }
    }

    const onWindowBlur = () => {
      activeKeys.clear()
      lastVisualizerSeekPressRef.current = null
      stopSeekScrub()
      volumeHoldControllerRef.current?.cancel()
    }

    window.addEventListener('keydown', onKeyDown, true)
    window.addEventListener('keyup', onKeyUp, true)
    window.addEventListener('blur', onWindowBlur)
    return () => {
      window.removeEventListener('keydown', onKeyDown, true)
      window.removeEventListener('keyup', onKeyUp, true)
      window.removeEventListener('blur', onWindowBlur)
      onWindowBlur()
    }
  }, [isVisualizerMode, handlePlayToggle, startSeekHold, stopSeekScrub, jumpSong, handleSeekActivate])

  const soundstage = useSyncExternalStore(subscribeSoundstageControls, readSoundstageControls)

  // ---------------------------------------------------------------- render

  return (
    <div className="audio-controls" aria-label="Audio player controls">
      {/* Top row — playback controls */}
      <div
        className="audio-micro-grid"
        style={{ '--audio-grid-columns': AUDIO_GRID_COLUMNS } as React.CSSProperties}
      >
        {/* Play / pause — spans 2 columns */}
        <button
          type="button"
          className={`audio-ctrl-btn audio-play-btn${isPlaying ? ' is-active' : ''}`}
          data-tooltip={songLabel}
          aria-label={isPlaying ? 'Pause music' : 'Play music'}
          aria-pressed={isPlaying}
          onClick={() => { void handlePlayToggle() }}
          style={{ gridColumn: 'span 2' }}
        >
          <span
            className={`fa-solid ${isPlaying ? 'fa-pause' : 'fa-play'}`}
            aria-hidden="true"
          />
        </button>

        {/* Rewind — mirror of the forward button, always backwards */}
        <button
          type="button"
          className="audio-ctrl-btn"
          data-tooltip="Left-click: rewind 20%. Right-click: previous song. Hold: scrub back, crossing into the previous song."
          aria-label="Rewind or previous song"
          onClick={() => { void handleSeekActivate(-1) }}
          data-secondary-press="action"
          onContextMenu={handleSeekContextMenu}
          onPointerDown={(e) => handleSeekPointerDown(e, -1)}
          onPointerUp={(e) => handleSeekPointerUp(e, -1)}
          onPointerLeave={stopSeekScrub}
        >
          <span className="fa-solid fa-backward" aria-hidden="true" />
        </button>

        {/* Favorability / skip button. While a pool filter is in force (set in
            the visualizer), its left press clears the filter instead, and the
            button shows that state: a magnifying glass, pressed. */}
        <button
          type="button"
          className={`audio-ctrl-btn${isPoolFiltered || currentSong?.priority === 0 ? ' is-active' : ''}`}
          data-tooltip={isPoolFiltered
            ? 'Songs are filtered. Left-click: clear the filter. Right-click: skip. Hold right-click: purge.'
            : currentSong?.priority === 0
              ? 'Left-click: clear the replay marker. Right-click: skip. Hold right-click: purge.'
              : 'Left-click: favourite (replay next). Right-click: skip. Hold right-click: purge.'}
          aria-label={isPoolFiltered ? 'Clear song filter, or skip current song' : 'Favourite or skip current song'}
          aria-pressed={isPoolFiltered || currentSong?.priority === 0}
          onClick={() => { if (isPoolFiltered) setPoolFilter(EMPTY_POOL_FILTER); else void handleFavoriteLeft() }}
          data-secondary-press="action"
          onContextMenu={handleFavoriteContextMenu}
          onPointerDown={handleFavPointerDown}
          onPointerUp={(e) => { void handleFavPointerUp(e) }}
        >
          <span className={`fa-solid ${isPoolFiltered ? 'fa-magnifying-glass' : 'fa-heart'}`} aria-hidden="true" />
        </button>

        {/* Fast forward */}
        <button
          type="button"
          className="audio-ctrl-btn"
          data-tooltip="Left-click: forward 20%. Right-click: next song. Hold: scrub forward, crossing into the next song."
          aria-label="Fast forward or next song"
          onClick={() => { void handleSeekActivate(1) }}
          data-secondary-press="action"
          onContextMenu={handleSeekContextMenu}
          onPointerDown={(e) => handleSeekPointerDown(e, 1)}
          onPointerUp={(e) => handleSeekPointerUp(e, 1)}
          onPointerLeave={stopSeekScrub}
        >
          <span className="fa-solid fa-forward" aria-hidden="true" />
        </button>

        {/* Soundstage toggle: swaps the bottom row between sets and soundstages */}
        <button
          ref={soundOptionsButtonRef}
          type="button"
          className={`audio-ctrl-btn${isSoundOptionsOpen ? ' is-active' : ''}`}
          data-tooltip={soundOptionsTooltip}
          aria-label={isSoundOptionsOpen ? 'Show playlists' : 'Show soundstages'}
          aria-pressed={isSoundOptionsOpen}
          onClick={() => onSoundOptionsOpenChange(!isSoundOptionsOpen)}
          data-secondary-press="action"
          onContextMenu={(event) => {
            event.preventDefault()
            onMutedChange(!isMuted)
          }}
        >
          <span className="fa-solid fa-headphones" aria-hidden="true" />
        </button>

        {/* Bottom row — music sets, or the sound options in their place */}
        {isSoundOptionsOpen ? (
          <>
            {FACTORY_SOUNDSTAGES.map((stage) => (
              <button
                key={stage.id}
                type="button"
                className={`audio-ctrl-btn audio-sound-btn${soundstage.solid === stage.id ? ' is-active' : ''}`}
                data-tooltip={stage.name}
                aria-label={`${stage.name} soundstage`}
                aria-pressed={soundstage.solid === stage.id}
                onClick={() => soundstage.select(stage.id)}
              >
                <span className={stage.icon} aria-hidden="true" />
              </button>
            ))}
            <button
              type="button"
              className={`audio-ctrl-btn audio-sound-btn${soundstage.solid === 'custom' ? ' is-active' : ''}`}
              data-tooltip="Custom"
              aria-label="Custom soundstage"
              aria-pressed={soundstage.solid === 'custom'}
              onClick={() => soundstage.select('custom')}
            >
              <span className={CUSTOM_SOUNDSTAGE_ICON} aria-hidden="true" />
            </button>
          </>
        ) : (
          <>
          {musicSets.slice(0, MUSIC_SET_QUICK_ACCESS_COUNT).map((set) => {
            const slot = set.slot
            const count = counts[slot] ?? 0
            const isEmpty = count === 0
            const isActive = activeSlots.includes(slot)
            const icon = isFactoryMusicSet(slot) ? PLAYLIST_SLOT_ICONS[slot] : null
            return (
              <button
                key={slot}
                type="button"
                className={`audio-ctrl-btn audio-playlist-btn${isActive ? ' is-active' : ''}${isEmpty ? ' is-empty' : ''}`}
                data-tooltip={
                  isEmpty
                    ? `${set.name}: empty — click to add files`
                    : `${set.name}: ${count} song${count !== 1 ? 's' : ''}${isActive ? ' (active)' : ''}`
                }
                aria-label={set.name}
                aria-pressed={isActive}
                onClick={(event) => { void handleSlotLeftClick(event, slot) }}
                data-secondary-press="action"
                onContextMenu={(e) => { void handleSlotContextMenu(e, slot) }}
                onPointerDown={(e) => handleSlotPointerDown(e, slot)}
                onPointerUp={cancelSlotHold}
                onPointerCancel={cancelSlotHold}
                onMouseLeave={cancelSlotHold}
              >
                {icon
                  ? <span className={icon} aria-hidden="true" />
                  : <span className="audio-playlist-custom-label" aria-hidden="true">{musicSetMark(set.name)}</span>}
              </button>
            )
          })}
          <SoundscapesButton
            preferences={soundscapePreferences}
            onChange={onSoundscapePreferencesChange}
          />
          </>
        )}
      </div>
    </div>
  )
})

/**
 * The Soundscapes switch at the end of the playlist row, which is also the
 * Soundscapes master volume: a click turns soundscapes on or off, a wheel over
 * it nudges the level exactly like a music level readout (Shift: by 10), and
 * a right-click steps to the next soundscape -- every factory one, then the
 * user's own (nextSoundscapePreset) -- turning soundscapes on. Wheeling turns soundscapes on if it was off -- the same "adjusting
 * turns it back on" rule the music volume follows with mute.
 *
 * Its own component because it owns the ref its
 * native wheel listener is bound to. The playlist row unmounts while the
 * sound options are showing, and a listener bound from the parent would not
 * be re-bound to the new button when the row comes back.
 *
 * Its face is the soundscape a click would play -- the current settings, on or
 * off: a factory soundscape's icon, a custom one's number (as its button in the
 * options panel shows it), and the cloud-bolt when the settings match no saved
 * soundscape and so have no face of their own.
 */
function SoundscapesButton({
  preferences,
  onChange,
}: {
  preferences: SoundscapePreferences
  onChange: (preferences: SoundscapePreferences) => void
}) {
  const ref = useRef<HTMLButtonElement | null>(null)
  const handleWheel = useCallback((event: WheelEvent) => {
    event.preventDefault()
    if (event.deltaY === 0) return
    onChange({
      ...preferences,
      enabled: true,
      masterVolume: nudgeLevel(preferences.masterVolume, event.deltaY, event.shiftKey),
    })
  }, [preferences, onChange])
  useNonPassiveWheel(ref, handleWheel)

  const level = toDisplayLevel(preferences.masterVolume)
  const next = nextSoundscapePreset(preferences)
  // A null or unknown active id means the mix was hand-edited away from any
  // saved soundscape, so it has no name to show.
  const current = [...preferences.customPresets, ...SOUNDSCAPE_FACTORY_PRESETS]
    .find((preset) => preset.id === preferences.activePresetId)
  const customNumber = preferences.customPresets.findIndex((preset) => preset.id === preferences.activePresetId) + 1
  const tooltip = [
    `Soundscape: ${preferences.enabled ? (current?.name ?? 'Custom') : 'OFF'}`,
    `[Scroll] Volume: ${level}`,
    `[Right] ${next.name}`,
  ].join('\n')
  return (
    <button
      ref={ref}
      type="button"
      className={`audio-ctrl-btn audio-soundscapes-btn${preferences.enabled ? ' is-active' : ''}`}
      data-tooltip={tooltip}
      data-secondary-press="action"
      onContextMenu={(event) => {
        event.preventDefault()
        onChange(applySoundscapePreset(preferences, next))
      }}
      aria-label={preferences.enabled ? 'Turn soundscapes off' : 'Turn soundscapes on'}
      aria-pressed={preferences.enabled}
      onClick={() => onChange({ ...preferences, enabled: !preferences.enabled })}
    >
      {customNumber > 0
        ? <span className="options-loadout-index" aria-hidden="true">{customNumber}</span>
        : <span className={`fa-solid ${FACTORY_SOUNDSCAPE_ICONS[preferences.activePresetId ?? ''] ?? 'fa-cloud-bolt'}`} aria-hidden="true" />}
    </button>
  )
}
