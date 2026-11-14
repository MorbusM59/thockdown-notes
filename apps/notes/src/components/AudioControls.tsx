import { memo, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { FieldActionButton } from './FieldActionButton'
import type { MusicBarRow, MusicPoolFilter, MusicSet, MusicSongEntry, PlaylistSlot, PlaylistCountsResult } from '../shared/audioPlayer'
import { EMPTY_POOL_FILTER, samePoolFilter, songAlbumText, songArtistText, songTitleText } from '../shared/audioPlayer'
import {
  AUDIO_GRID_COLUMNS,
  emptyPlaylistCounts,
  getNextActiveSlotsForSelection,
  type SetSelection,
  isFactoryMusicSet,
} from '../shared/audioPlayer'
import { adjacentSongInPool } from '../shared/musicPool'
import { activeSoundscape, applySoundscapePreset, nextSoundscapePreset, type SoundscapePreferences } from '@thockdown/soundscape/soundscape'
import {
  fromDisplayLevel,
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
import { openMusicLibrary } from '../sidebar/musicLibraryView'
import { CompactScrollbarSlider } from '@thockdown/interaction/CompactScrollbarSlider'
import { musicPlayerService, MissingFileError, resolveSeekPress } from '../sound/MusicPlayerService'
import { publishNowPlaying, type SoundLevels } from '../sound/nowPlaying'
// Playback resumed from the previous session (the initialWasPlaying restore
// below) starts at silence and full reverb and ramps up over this span.
import { RESTORE_FADE_IN_SEC } from '@thockdown/soundscape/audioOutputBus'
import { armHold, HOLD_CONFIRM_MS } from '@thockdown/interaction/holdTiming'
import { readSoundstageControls, subscribeSoundstageControls } from '../sound/soundstageControls'
import { commitPoolFilterDraft, readShownPoolFilter, setPoolFilterDraft, subscribePoolFilterDraft } from '../visualizer/poolFilterDraft'
import { PresetMark } from '@thockdown/interaction/PresetMark'
import { isTextEntryElement } from '@thockdown/interaction/focusOwnership'
import { beginBackgroundWork } from '../shared/backgroundWork'

const VISUALIZER_DOUBLE_PRESS_MS = 300
const SEEK_HOLD_DELAY_MS = 200
const SEEK_INTERVAL_MS = 100
const SEEK_HOLD_STEP = 0.05
const SEEK_CLICK_STEP = 0.2
/** How far the Music button's right click skips ahead. */
const MUSIC_SKIP_SEC = 4 * 60
/** Less than this left in the song, and the right click plays the next one. */
const MUSIC_SKIP_TO_NEXT_SEC = 6 * 60

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
  /** What the second row shows. Owned by the parent so it survives a restart. */
  barRow: MusicBarRow
  onBarRowChange: (row: MusicBarRow) => void
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
  barRow,
  onBarRowChange,
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
  // Position to seek to once the restored song's first playback begins.
  const pendingSeekSecRef = useRef<number | null>(null)

  const seekTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const seekIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const isSeekScrubbing = useRef(false)
  const lastVisualizerSeekPressRef = useRef<{ direction: SeekDirection; atMs: number } | null>(null)
  const visualizerKeysDownRef = useRef(new Set<string>())
  const activeRef = useRef(activeSlots)
  activeRef.current = activeSlots
  // THE POOL is the activated sets: what the player and the Music Library
  // light, what is persisted, and what every pick and walk reads.
  const poolSlots = activeSlots
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

  // AN EMPTY SET IS NEVER ACTIVE, and a set becomes active when its first
  // song arrives. Every change to a set's songs ends in a count refresh, so
  // the rule is applied here, against the counts before and after, and
  // nowhere else. The first read (on mount) has no "before": it only takes
  // the empty sets out of what the last session left active.
  const countsRef = useRef<PlaylistCountsResult | null>(null)
  const onActiveSlotsChangeRef = useRef(onActiveSlotsChange)
  onActiveSlotsChangeRef.current = onActiveSlotsChange
  const refreshCountsRef = useRef(async () => {
    const c = await window.thockdownAudioPlayer?.getPlaylistCounts()
    if (!c) return
    const before = countsRef.current
    countsRef.current = c
    setCounts(c)
    const active = activeSlotsRef.current
    const filled = before
      ? (Object.keys(c).map(Number) as PlaylistSlot[]).filter((slot) => (c[slot] ?? 0) > 0 && (before[slot] ?? 0) === 0 && !active.includes(slot))
      : []
    const next = [...active.filter((slot) => (c[slot] ?? 0) > 0), ...filled]
    if (next.length === active.length && next.every((slot, index) => slot === active[index])) return
    activeSlotsRef.current = next
    onActiveSlotsChangeRef.current(next)
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
    void refreshCountsRef.current()
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

  // ---------------------------------------------------------------- seeking
  // The visualizer's arrow keys (below) seek and scrub:
  //   press             seek 20% of the track that way
  //   double press      change song that way (see jumpSong)
  //   hold              scrub 5% per 100 ms after a 200 ms delay
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



  /**
   * A 20% press. Unlike the scrub above this never carries a leftover into the
   * neighbouring song -- resolveSeekPress turns a press that cannot complete
   * inside the track into a landmark instead, and this plays whichever one it
   * named. See that function for why the two gestures differ.
   */
  const handleSeekActivate = useCallback(async (direction: SeekDirection) => {
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


  // ---------------------------------------------------------------- playlist buttons

  /**
   * Change the activated sets. The song playing plays on whatever the change:
   * it belongs to the pool while it plays, and the next pick reads the new pool.
   */
  const selectSlot = useCallback(async (slot: PlaylistSlot, selection: SetSelection) => {
    // An empty set cannot be active (see refreshCountsRef).
    if ((countsRef.current?.[slot] ?? 0) === 0) return
    const next = getNextActiveSlotsForSelection(activeSlotsRef.current, slot, selection)
    selectionVersionRef.current += 1
    activeSlotsRef.current = next
    onActiveSlotsChange(next)
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




  const createMusicSet = useCallback(async (): Promise<PlaylistSlot | null> => {
    const audioPlayer = window.thockdownAudioPlayer
    if (!audioPlayer) {
      console.error('[music-sets] cannot create a set without the audio player bridge')
      return null
    }
    selectionVersionRef.current += 1
    const next = await audioPlayer.createMusicSet()
    onMusicSetsChange(next)
    // A new set is appended (databaseService.ts's createMusicSet), so it is the last.
    return next.at(-1)?.slot ?? null
  }, [onMusicSetsChange])

  const renameMusicSet = useCallback(async (slot: PlaylistSlot, name: string) => {
    const nextName = name.trim().slice(0, 64)
    if (!nextName) return
    const audioPlayer = window.thockdownAudioPlayer
    if (!audioPlayer) {
      throw new Error('The audio player is unavailable.')
    }
    onMusicSetsChange(await audioPlayer.renameMusicSet(slot, nextName))
  }, [onMusicSetsChange])

  const setMusicSetIcon = useCallback(async (slot: PlaylistSlot, icon: string | null) => {
    const audioPlayer = window.thockdownAudioPlayer
    if (!audioPlayer) return
    onMusicSetsChange(await audioPlayer.setMusicSetIcon(slot, icon))
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
  }, [onMusicSetsChange])

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
  const publishedSelectSlot = useCallback((slot: PlaylistSlot, selection: SetSelection) => {
    void mediaActionsRef.current.selectSlot(slot, selection)
  }, [])
  // A new filter applies from the next pick: the song playing plays on.
  const setPoolFilter = useCallback((filter: MusicPoolFilter) => {
    if (samePoolFilter(filter, filterRef.current)) return
    filterRef.current = filter
    onPoolFilterChange(filter)
  }, [onPoolFilterChange])
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
      setMusicSetIcon,
      moveMusicSet: reorderMusicSets,
      deleteMusicSet,
      purgeMusicSet,
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
    setMusicSetIcon,
    reorderMusicSets,
    deleteMusicSet,
    purgeMusicSet,
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

  // ---------------------------------------------------------------- music button
  // A right click skips ahead MUSIC_SKIP_SEC, or plays the next song once less
  // than MUSIC_SKIP_TO_NEXT_SEC is left (a skip would land in the last two
  // minutes); a right HOLD plays the next song wherever the playhead is. The
  // click is taken on the release, so the one press decides between the two.
  const musicRightHoldRef = useRef<{ cancel: () => void; fired: boolean } | null>(null)
  const skipAhead = useCallback(async () => {
    if (isCrossingSongRef.current || !currentSongRef.current) return
    const left = musicPlayerService.currentDurationSec - musicPlayerService.currentTime
    if (left < MUSIC_SKIP_TO_NEXT_SEC) await jumpSong(1)
    else await musicPlayerService.seekWithFade(musicPlayerService.currentTime + MUSIC_SKIP_SEC)
  }, [jumpSong])
  const handleMusicPointerDown = useCallback((event: React.PointerEvent) => {
    if (event.button !== 2) return
    event.preventDefault()
    musicRightHoldRef.current?.cancel()
    const hold = { fired: false, cancel: () => {} }
    hold.cancel = armHold(() => {
      hold.fired = true
      void jumpSong(1)
    }, HOLD_CONFIRM_MS)
    musicRightHoldRef.current = hold
  }, [jumpSong])
  const handleMusicPointerUp = useCallback((event: React.PointerEvent) => {
    if (event.button !== 2) return
    const hold = musicRightHoldRef.current
    musicRightHoldRef.current = null
    if (!hold) return
    hold.cancel()
    if (!hold.fired) void skipAhead()
  }, [skipAhead])
  const cancelMusicHold = useCallback(() => {
    musicRightHoldRef.current?.cancel()
    musicRightHoldRef.current = null
  }, [])

  // Adjusting the volume while muted unmutes: a level that changes while
  // nothing can be heard is a dead control.
  const unmuteForAdjust = useCallback(() => {
    if (isMuted) onMutedChange(false)
  }, [isMuted, onMutedChange])

  const handleMusicSlider = useCallback((display: number) => {
    unmuteForAdjust()
    onVolumeChange(fromDisplayLevel(display))
  }, [unmuteForAdjust, onVolumeChange])

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

  // ---------------------------------------------------------------- render
  // Two rows of six. The top row is fixed: Music (two columns), Filter,
  // Soundstages, Soundscape (two columns). The second row shows the two volume
  // sliders, or in their place the stages or the pool filter: the two toggles
  // both claim it, so pressing one replaces the other, and pressing the one
  // that is showing gives the row back to the sliders.

  const soundstage = useSyncExternalStore(subscribeSoundstageControls, readSoundstageControls)
  const toggleRow = (row: MusicBarRow) => onBarRowChange(barRow === row ? 'levels' : row)
  const soundscape = activeSoundscape(soundscapePreferences)
  const nextSoundscape = nextSoundscapePreset(soundscapePreferences)
  const filterQuery = poolFilter.query.trim()

  return (
    <div className="audio-controls" aria-label="Audio player controls">
      <div
        className="audio-micro-grid"
        style={{ '--audio-grid-columns': AUDIO_GRID_COLUMNS } as React.CSSProperties}
      >
        <button
          type="button"
          className={`audio-ctrl-btn audio-wide-btn${isPlaying ? ' is-active' : ''}`}
          data-tooltip={`${songLabel}\n[Right] Skip forward\n[Hold right] Next song`}
          aria-label={isPlaying ? 'Pause music' : 'Play music'}
          aria-pressed={isPlaying}
          onClick={() => {
            // Nothing to play from: show the Songs view, where sets are filled and chosen.
            if (!isPlaying && activeSlots.length === 0) openMusicLibrary()
            else void handlePlayToggle()
          }}
          data-secondary-press="action"
          onContextMenu={(event) => event.preventDefault()}
          onPointerDown={handleMusicPointerDown}
          onPointerUp={handleMusicPointerUp}
          onPointerCancel={cancelMusicHold}
          onMouseLeave={cancelMusicHold}
        >
          <span className="fa-solid fa-music" aria-hidden="true" />
        </button>

        <button
          type="button"
          className={`audio-ctrl-btn${barRow === 'filter' ? ' is-active' : ''}`}
          data-tooltip={filterQuery ? `Filter: ${filterQuery}` : 'Filter'}
          aria-label="Filter songs"
          aria-pressed={barRow === 'filter'}
          onClick={() => toggleRow('filter')}
        >
          <span className="fa-solid fa-filter" aria-hidden="true" />
        </button>

        <button
          type="button"
          className={`audio-ctrl-btn${barRow === 'soundstages' ? ' is-active' : ''}`}
          data-tooltip="Soundstages"
          aria-label="Soundstages"
          aria-pressed={barRow === 'soundstages'}
          onClick={() => toggleRow('soundstages')}
        >
          <span className="fa-solid fa-headphones" aria-hidden="true" />
        </button>

        <button
          type="button"
          className={`audio-ctrl-btn audio-wide-btn${soundscapePreferences.enabled ? ' is-active' : ''}`}
          data-tooltip={`Soundscape: ${soundscape.name}\n[Right] ${nextSoundscape.name}`}
          aria-label={soundscapePreferences.enabled ? 'Stop the soundscape' : 'Play the soundscape'}
          aria-pressed={soundscapePreferences.enabled}
          onClick={() => onSoundscapePreferencesChange({ ...soundscapePreferences, enabled: !soundscapePreferences.enabled })}
          data-secondary-press="action"
          onContextMenu={(event) => {
            event.preventDefault()
            onSoundscapePreferencesChange(applySoundscapePreset(soundscapePreferences, nextSoundscape))
          }}
        >
          <span className="fa-solid fa-podcast" aria-hidden="true" />
        </button>

        {barRow === 'soundstages' ? (
          Array.from({ length: AUDIO_GRID_COLUMNS }, (_, index) => {
            const stage = soundstage.presets[index]
            if (!stage) return <span key={`empty-${index}`} aria-hidden="true" />
            const isActive = soundstage.activeId === stage.id
            return (
              <button
                key={stage.id}
                type="button"
                className={`audio-ctrl-btn audio-sound-btn${isActive ? ' is-active' : ''}`}
                data-tooltip={stage.name}
                aria-label={`${stage.name} soundstage`}
                aria-pressed={isActive}
                onClick={() => soundstage.select(stage.id)}
              >
                <PresetMark preset={stage} lettersClassName="audio-playlist-custom-label" />
              </button>
            )
          })
        ) : barRow === 'filter' ? (
          <MusicBarFilter />
        ) : (
          <>
            <div className="audio-slider-cell">
              <CompactScrollbarSlider
                id="music-bar-music-volume"
                value={toDisplayLevel(volume)}
                min={0}
                max={SOUND_LEVEL_MAX_DISPLAY}
                step={1}
                trackLabel="Music"
                ariaLabel="Music volume"
                dimmed={isMuted}
                onCommit={handleMusicSlider}
              />
            </div>
            <div className="audio-slider-cell">
              <CompactScrollbarSlider
                id="music-bar-ambient-volume"
                value={toDisplayLevel(soundscapePreferences.masterVolume)}
                min={0}
                max={SOUND_LEVEL_MAX_DISPLAY}
                step={1}
                trackLabel="Ambient"
                ariaLabel="Soundscape volume"
                onCommit={(display) => onSoundscapePreferencesChange({ ...soundscapePreferences, masterVolume: fromDisplayLevel(display) })}
              />
            </div>
          </>
        )}
      </div>
    </div>
  )
})

/**
 * The pool filter in the music bar's second row: the same filter as the
 * visualizer's field (`visualizer/poolFilterDraft.ts`), followed as typed by
 * anything showing the shown filter and handed to playback when the field
 * is left. Enter or Tab leaves it; Escape empties it first. It takes the
 * keyboard when it appears, because showing it is asking to type.
 */
function MusicBarFilter() {
  const filter = useSyncExternalStore(subscribePoolFilterDraft, readShownPoolFilter)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [isFocused, setIsFocused] = useState(false)
  return (
    <>
      <input
        ref={inputRef}
        className="audio-filter-field"
        type="text"
        value={filter.query}
        aria-label="Filter songs"
        spellCheck={false}
        autoComplete="off"
        autoFocus
        onChange={(event) => setPoolFilterDraft({ query: event.currentTarget.value })}
        onFocus={() => setIsFocused(true)}
        onBlur={() => {
          setIsFocused(false)
          commitPoolFilterDraft()
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === 'Tab') {
            event.preventDefault()
            event.currentTarget.blur()
          } else if (event.key === 'Escape') {
            event.preventDefault()
            setPoolFilterDraft(EMPTY_POOL_FILTER)
            event.currentTarget.blur()
          }
        }}
      />
      {/* The row's sixth column: the field's Enter while it is being typed
          in, and clearing the applied filter (committed at once, the field
          left alone) while it is not. */}
      <FieldActionButton
        className="audio-ctrl-btn"
        isFieldFocused={isFocused}
        hasValue={filter.query !== ''}
        onSubmit={() => inputRef.current?.blur()}
        onClear={() => {
          setPoolFilterDraft(EMPTY_POOL_FILTER)
          commitPoolFilterDraft()
        }}
      />
    </>
  )
}
