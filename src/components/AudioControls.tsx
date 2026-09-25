import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MouseEvent } from 'react'
import type { MusicSongEntry, PlaylistSlot, PlaylistCountsResult } from '../shared/audioPlayer'
import {
  AUDIO_GRID_COLUMNS,
  emptyPlaylistCounts,
  getNextActiveSlotsForToggle,
  PLAYLIST_BUTTON_SLOTS,
  PLAYLIST_SLOT_ICONS,
  PLAYLIST_SLOT_THEMES,
  shouldStopCurrentSongOnSlotToggle,
} from '../shared/audioPlayer'
import { applyAmbientPreset, nextAmbientPreset, type AmbientPreferences } from '../shared/ambientSound'
import {
  fromDisplayLevel,
  nudgeLevel,
  reverbIcon,
  roomIcon,
  SOUND_LEVEL_MAX_DISPLAY,
  toDisplayLevel,
  volumeIcon,
} from '../shared/musicSoundOptions'
import {
  emptyPlayHistory,
  forgetSong,
  pushPlayed,
  stepBack,
} from '../shared/musicPlayHistory'
import { useHoldToAdjust } from '../shared/useHoldToAdjust'
import { useNonPassiveWheel } from '../shared/useNonPassiveWheel'
import { musicPlayerService, MissingFileError, resolveSeekPress } from '../sound/MusicPlayerService'
import { armHold, HOLD_COMMIT_MS } from '../shared/holdTiming'

// Purging a song from the library and clearing a playlist slot are both
// "I know this is not undoable" -- the app's COMMIT threshold
// (`shared/holdTiming.ts`), which also announces the completion in the
// cursor. Was 700ms of its own.
const HOLD_THRESHOLD_MS = HOLD_COMMIT_MS

// Fade-in duration (seconds) for playback resumed from the previous
// session (see the initialWasPlaying restore below) -- starts at silence
// and full reverb, ramping up to the persisted volume/reverb over this
// span, rather than jumping straight in at launch.
const RESTORE_PLAYBACK_FADE_IN_SEC = 10



/** Latest playback snapshot, kept fresh by AudioControls for the parent to read on save. */
export interface MusicPlaybackSnapshot {
  songId: number | null
  positionSec: number
  wasPlaying: boolean
}

export interface AudioControlsProps {
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
  /** Which playlist slots are currently toggled active. */
  activeSlots: PlaylistSlot[]
  onActiveSlotsChange: (slots: PlaylistSlot[]) => void
  /**
   * Procedural ambience preferences. The player shows only the on/off switch
   * and the master volume (a wheel over that switch); everything else is in
   * the settings panel.
   */
  ambientPreferences: AmbientPreferences
  onAmbientPreferencesChange: (preferences: AmbientPreferences) => void
  /**
   * Whether the bottom row is showing the sound options instead of the
   * playlist buckets. Owned by the parent so it survives a restart.
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
}

export const AudioControls = memo(function AudioControls({
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
  ambientPreferences,
  onAmbientPreferencesChange,
  isSoundOptionsOpen,
  onSoundOptionsOpenChange,
  initialSongId,
  initialPositionSec,
  initialWasPlaying,
  playbackStateRef,
}: AudioControlsProps) {
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentSong, setCurrentSong] = useState<MusicSongEntry | null>(null)
  const [counts, setCounts] = useState<PlaylistCountsResult>(emptyPlaylistCounts)
  // Slot button that is currently "primed" for clearing (held right-click)
  const [primedSlot, setPrimedSlot] = useState<PlaylistSlot | null>(null)
  // Position to seek to once the restored song's first playback begins.
  const pendingSeekSecRef = useRef<number | null>(null)

  const holdTimerRef = useRef<(() => void) | null>(null)
  const seekTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const seekIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const isSeekScrubbing = useRef(false)
  const activeRef = useRef(activeSlots)
  activeRef.current = activeSlots

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
    const slots = slotsOverride ?? activeRef.current
    if (slots.length === 0) {
      setIsPlaying(false)
      setCurrentSong(null)
      return
    }

    // Safety limit: avoid an infinite loop if every song in the pool is missing.
    const MAX_ATTEMPTS = 50
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const next = await window.thockdownAudioPlayer?.pickNextSong(slots)
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

  const refreshCounts = useCallback(async () => {
    await refreshCountsRef.current()
  }, [])

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
          musicPlayerService.beginFadeIn(RESTORE_PLAYBACK_FADE_IN_SEC)
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

  // Keep the parent-owned snapshot fresh so it can be persisted at any time
  // (e.g. on the debounced app-state save, or on quit).
  useEffect(() => {
    if (!playbackStateRef) return
    playbackStateRef.current.songId = currentSong?.id ?? null
    playbackStateRef.current.wasPlaying = isPlaying
    playbackStateRef.current.positionSec = musicPlayerService.currentTime
  }, [playbackStateRef, currentSong, isPlaying])

  // While playing, periodically refresh the saved position. Position isn't
  // reactive state — polling avoids a re-render on every audio frame.
  useEffect(() => {
    if (!playbackStateRef || !isPlaying) return
    const id = setInterval(() => {
      playbackStateRef.current.positionSec = musicPlayerService.currentTime
    }, 3000)
    return () => clearInterval(id)
  }, [playbackStateRef, isPlaying])

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

  // Deliberately NOT one of holdTiming.ts's two thresholds: this is when a
  // held seek starts REPEATING, not when a gesture completes. Nothing is
  // confirmed at 200ms here, so there is nothing to acknowledge either.
  const SEEK_HOLD_DELAY_MS = 200
  const SEEK_INTERVAL_MS = 100
  const SEEK_HOLD_STEP = 0.05
  const SEEK_CLICK_STEP = 0.2

  /** +1 seeks forward, -1 rewinds. */
  type SeekDirection = 1 | -1

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
   * Right-click: change song.
   *
   * Backward walks the tally. Forward does NOT walk it the other way -- it
   * always picks a fresh random song, exactly as if the current one had
   * reached its end, which is the whole of what "skip to the end of this
   * song" means. That asymmetry is intentional: the tally exists to let a
   * listener return to something, not to pre-decide what comes next.
   */
  const jumpSong = useCallback(async (direction: SeekDirection) => {
    if (isCrossingSongRef.current) return
    isCrossingSongRef.current = true
    try {
      if (direction === -1) {
        await playPreviousSong()
        return
      }
      const finished = currentSongRef.current
      if (finished) await window.thockdownAudioPlayer?.afterPlay(finished.id)
      await advanceToNextSong()
    } finally {
      isCrossingSongRef.current = false
    }
  }, [advanceToNextSong, playPreviousSong])

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
    seekTimerRef.current = setTimeout(() => {
      isSeekScrubbing.current = true
      musicPlayerService.beginScrub()
      void seekBy(direction * SEEK_HOLD_STEP)
      seekIntervalRef.current = setInterval(() => {
        void seekBy(direction * SEEK_HOLD_STEP)
      }, SEEK_INTERVAL_MS)
    }, SEEK_HOLD_DELAY_MS)
  }, [seekBy])

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
    if (wasScrubbing) return
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
    if (isSeekScrubbing.current || isCrossingSongRef.current) return

    const outcome = resolveSeekPress(
      musicPlayerService.currentTime,
      musicPlayerService.currentDurationSec,
      direction * SEEK_CLICK_STEP,
    )

    if (outcome.kind === 'within') {
      musicPlayerService.setCurrentTime(outcome.timeSec)
      return
    }
    if (outcome.kind === 'restart') {
      musicPlayerService.setCurrentTime(0)
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

  const handleSlotLeftClick = useCallback(async (slot: PlaylistSlot) => {
    if (counts[slot] === 0) {
      // Empty playlist: open file picker.
      const files = await window.thockdownAudioPlayer?.pickFiles()
      if (files && files.length > 0) {
        await window.thockdownAudioPlayer?.addSongs(slot, files)
        await refreshCounts()
        // Auto-toggle the slot on after first add.
        if (!activeSlots.includes(slot)) {
          onActiveSlotsChange([...activeSlots, slot])
        }
      }
      return
    }
    // Toggle the slot in/out of the active pool.
    const next = getNextActiveSlotsForToggle(activeSlots, slot)
    const isDeactivating = activeSlots.includes(slot) && !next.includes(slot)

    onActiveSlotsChange(next)

    if (isDeactivating && shouldStopCurrentSongOnSlotToggle({
      currentSongSlot: currentSong?.playlistSlot,
      activeSlots,
      toggledSlot: slot,
    })) {
      musicPlayerService.stop()
      setIsPlaying(false)
      setCurrentSong(null)
      await advanceToNextSong(next)
    }
  }, [activeSlots, counts, currentSong, onActiveSlotsChange, advanceToNextSong, refreshCounts])

  const handleSlotRightClick = useCallback(async (event: MouseEvent, slot: PlaylistSlot) => {
    event.preventDefault()
    if (primedSlot === slot) return // Already primed — wait for pointer-up.
    // Normal right-click = add more files.
    const files = await window.thockdownAudioPlayer?.pickFiles()
    if (files && files.length > 0) {
      await window.thockdownAudioPlayer?.addSongs(slot, files)
      await refreshCounts()
    }
  }, [primedSlot, refreshCounts])

  const handleSlotPointerDown = useCallback((event: React.PointerEvent, slot: PlaylistSlot) => {
    if (event.button !== 2) return
    event.preventDefault()
    holdTimerRef.current = armHold(() => {
      setPrimedSlot(slot)
    }, HOLD_THRESHOLD_MS)
  }, [])

  const handleSlotPointerUp = useCallback(async (event: React.PointerEvent, slot: PlaylistSlot) => {
    if (event.button !== 2) return
    if (holdTimerRef.current) {
      holdTimerRef.current()
      holdTimerRef.current = null
    }
    if (primedSlot === slot) {
      setPrimedSlot(null)
      const nextActiveSlots = activeSlots.filter((s) => s !== slot)
      await window.thockdownAudioPlayer?.clearPlaylist(slot)
      await refreshCounts()
      // Remove this slot from active set if it was active.
      onActiveSlotsChange(nextActiveSlots)
      // If current song was from this slot, stop and pick next.
      if (currentSong?.playlistSlot === slot) {
        musicPlayerService.stop()
        setIsPlaying(false)
        setCurrentSong(null)
        await advanceToNextSong(nextActiveSlots)
      }
    }
  }, [primedSlot, activeSlots, currentSong, onActiveSlotsChange, refreshCounts, advanceToNextSong])

  const handleSlotPointerLeave = useCallback((slot: PlaylistSlot) => {
    if (holdTimerRef.current) {
      holdTimerRef.current()
      holdTimerRef.current = null
    }
    if (primedSlot === slot) setPrimedSlot(null)
  }, [primedSlot])

  const handleSlotShiftRightClick = useCallback(async (event: MouseEvent, slot: PlaylistSlot) => {
    if (!event.shiftKey) return
    event.preventDefault()
    const folder = await window.thockdownAudioPlayer?.pickFolder()
    if (!folder) return
    const files = await window.thockdownAudioPlayer?.scanFolderForAudio(folder)
    if (files && files.length > 0) {
      await window.thockdownAudioPlayer?.addSongs(slot, files)
      await refreshCounts()
      if (!activeSlots.includes(slot)) {
        onActiveSlotsChange([...activeSlots, slot])
      }
    }
  }, [activeSlots, onActiveSlotsChange, refreshCounts])

  // Combine shift+right-click vs plain right-click on slot buttons.
  const handleSlotContextMenu = useCallback(async (event: MouseEvent, slot: PlaylistSlot) => {
    if (event.shiftKey) {
      await handleSlotShiftRightClick(event, slot)
    } else {
      await handleSlotRightClick(event, slot)
    }
  }, [handleSlotShiftRightClick, handleSlotRightClick])

  // ---------------------------------------------------------------- song label

  const songLabel = currentSong
    ? `${currentSong.favorability} | ${currentSong.title || '?'}${currentSong.artist ? ` (${currentSong.artist})` : ''}`
    : 'No song'

  // ---------------------------------------------------------------- sound options
  // The headphones button swaps the bottom row's six playlist buckets for six
  // sound controls. It is a swap, not an overlay: the row keeps its geometry,
  // so nothing under the cursor moves and the grid stays 2x6 in both states.
  //
  // Adjusting a level while its toggle is off turns the toggle back on. A
  // number that changes while nothing can be heard is a dead control, and the
  // toggle button remains the way to silence it again deliberately.
  //
  // These three switches light (is-active) when they are OFF -- see volumeIcon's
  // note in musicSoundOptions.ts. The highlight marks what deviates from plain
  // listening, so an unattended row reads as "nothing is muted" at a glance.

  const handleMuteToggle = useCallback(() => {
    onMutedChange(!isMuted)
  }, [isMuted, onMutedChange])

  const handleReverbBypassToggle = useCallback(() => {
    onReverbBypassedChange(!isReverbBypassed)
  }, [isReverbBypassed, onReverbBypassedChange])

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

  const handleVolumeWheel = useCallback((event: WheelEvent) => {
    event.preventDefault()
    nudgeVolume(event.deltaY, event.shiftKey)
  }, [nudgeVolume])

  const handleReverbWheel = useCallback((event: WheelEvent) => {
    event.preventDefault()
    nudgeReverb(event.deltaY, event.shiftKey)
  }, [nudgeReverb])

  const handleRoomWheel = useCallback((event: WheelEvent) => {
    event.preventDefault()
    nudgeRoom(event.deltaY, event.shiftKey)
  }, [nudgeRoom])

  // The headphones button adjusts sound from the wheel whichever row is
  // showing: plain scroll for volume, Shift for reverb, Ctrl for room. The
  // modifiers pick the level here, so there is no coarse step -- the readouts
  // keep Shift-for-ten. Native and non-passive for the same reason as the
  // readouts (see SoundLevelButton), and also so Ctrl+wheel cannot zoom the
  // page instead.
  const soundOptionsButtonRef = useRef<HTMLButtonElement | null>(null)
  const handleSoundOptionsWheel = useCallback((event: WheelEvent) => {
    event.preventDefault()
    if (event.shiftKey) nudgeReverb(event.deltaY, false)
    else if (event.ctrlKey || event.metaKey) nudgeRoom(event.deltaY, false)
    else nudgeVolume(event.deltaY, false)
  }, [nudgeVolume, nudgeReverb, nudgeRoom])
  useNonPassiveWheel(soundOptionsButtonRef, handleSoundOptionsWheel)

  // The hold gesture speaks in printed 0-99 levels; the graph wants fractions.
  const handleVolumeLevel = useCallback((display: number) => {
    onVolumeChange(fromDisplayLevel(display))
  }, [onVolumeChange])

  const handleReverbLevel = useCallback((display: number) => {
    onReverbAmountChange(fromDisplayLevel(display))
  }, [onReverbAmountChange])

  const handleRoomLevel = useCallback((display: number) => {
    onReverbRoomChange(fromDisplayLevel(display))
  }, [onReverbRoomChange])

  const volumeGlyph = useMemo(() => volumeIcon(volume, isMuted), [volume, isMuted])
  const reverbGlyph = useMemo(() => reverbIcon(isReverbBypassed), [isReverbBypassed])
  const roomGlyph = useMemo(() => roomIcon(reverbRoom, isReverbBypassed), [reverbRoom, isReverbBypassed])

  // ---------------------------------------------------------------- render

  return (
    <div className="audio-controls" aria-label="Audio player controls">
      {/* Top row — playback controls */}
      <div
        className="audio-micro-grid"
        style={{ '--audio-grid-columns': AUDIO_GRID_COLUMNS } as React.CSSProperties}
      >
        {/* Play / stop — spans 2 columns */}
        <button
          type="button"
          className={`audio-ctrl-btn audio-play-btn${isPlaying ? ' is-active' : ''}`}
          data-tooltip={songLabel}
          aria-label={isPlaying ? 'Stop music' : 'Play music'}
          aria-pressed={isPlaying}
          onClick={() => { void handlePlayToggle() }}
          style={{ gridColumn: 'span 2' }}
        >
          <span
            className={`fa-solid ${isPlaying ? 'fa-stop' : 'fa-play'}`}
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

        {/* Favorability / skip button */}
        <button
          type="button"
          className={`audio-ctrl-btn${currentSong?.priority === 0 ? ' is-active' : ''}`}
          data-tooltip={currentSong?.priority === 0
            ? 'Left-click: clear the replay marker. Right-click: skip. Hold right-click: purge.'
            : 'Left-click: favourite (replay next). Right-click: skip. Hold right-click: purge.'}
          aria-label="Favourite or skip current song"
          aria-pressed={currentSong?.priority === 0}
          onClick={() => { void handleFavoriteLeft() }}
          data-secondary-press="action"
          onContextMenu={handleFavoriteContextMenu}
          onPointerDown={handleFavPointerDown}
          onPointerUp={(e) => { void handleFavPointerUp(e) }}
        >
          <span className="fa-solid fa-heart" aria-hidden="true" />
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

        {/* Sound-options toggle: swaps the bottom row between buckets and levels */}
        <button
          ref={soundOptionsButtonRef}
          type="button"
          className={`audio-ctrl-btn${isSoundOptionsOpen ? ' is-active' : ''}`}
          data-tooltip={isSoundOptionsOpen ? 'Back to playlists' : 'Sound options'}
          aria-label={isSoundOptionsOpen ? 'Show playlists' : 'Show sound options'}
          aria-pressed={isSoundOptionsOpen}
          onClick={() => onSoundOptionsOpenChange(!isSoundOptionsOpen)}
        >
          <span className="fa-solid fa-headphones" aria-hidden="true" />
        </button>

        {/* Bottom row — playlist buckets, or the sound options in their place */}
        {isSoundOptionsOpen ? (
          <>
            <button
              type="button"
              className={`audio-ctrl-btn audio-sound-btn${isMuted ? ' is-active' : ''}`}
              data-tooltip={isMuted ? `Muted — click to restore volume ${toDisplayLevel(volume)}` : 'Mute'}
              aria-label={isMuted ? 'Unmute music' : 'Mute music'}
              aria-pressed={isMuted}
              onClick={handleMuteToggle}
            >
              <span className={volumeGlyph} aria-hidden="true" />
            </button>

            <SoundLevelButton
              value={volume}
              onWheel={handleVolumeWheel}
              onLevelChange={handleVolumeLevel}
              onAdjustStart={unmuteForAdjust}
              label="Music volume"
              tooltip="Volume — scroll to adjust (Shift: by 10). Hold left to lower, right to raise."
              isDimmed={isMuted}
            />

            <button
              type="button"
              className={`audio-ctrl-btn audio-sound-btn${isReverbBypassed ? ' is-active' : ''}`}
              data-tooltip={isReverbBypassed ? `Reverb off — click to restore ${toDisplayLevel(reverbAmount)}` : 'Turn reverb off'}
              aria-label={isReverbBypassed ? 'Enable reverb' : 'Disable reverb'}
              aria-pressed={isReverbBypassed}
              onClick={handleReverbBypassToggle}
            >
              <span className={reverbGlyph} aria-hidden="true" />
            </button>

            <SoundLevelButton
              value={reverbAmount}
              onWheel={handleReverbWheel}
              onLevelChange={handleReverbLevel}
              onAdjustStart={unbypassForAdjust}
              label="Music reverb amount"
              tooltip="Reverb — scroll to adjust (Shift: by 10). Hold left to lower, right to raise."
              isDimmed={isReverbBypassed}
            />

            <button
              type="button"
              className={`audio-ctrl-btn audio-sound-btn${isReverbBypassed ? ' is-active' : ''}`}
              data-tooltip={isReverbBypassed ? 'Reverb off — click to restore' : `Room size ${toDisplayLevel(reverbRoom)} — click to turn reverb off`}
              aria-label={isReverbBypassed ? 'Enable reverb' : 'Disable reverb'}
              aria-pressed={isReverbBypassed}
              onClick={handleReverbBypassToggle}
            >
              <span className={roomGlyph} aria-hidden="true" />
            </button>

            <SoundLevelButton
              value={reverbRoom}
              onWheel={handleRoomWheel}
              onLevelChange={handleRoomLevel}
              onAdjustStart={unbypassForAdjust}
              label="Music reverb room size"
              tooltip="Room size — scroll to adjust (Shift: by 10). Hold left to lower, right to raise."
              isDimmed={isReverbBypassed}
            />
          </>
        ) : (
          <>
          {PLAYLIST_BUTTON_SLOTS.map((slot) => {
            const isEmpty = counts[slot] === 0
            const isActive = activeSlots.includes(slot)
            const isPrimed = primedSlot === slot
            return (
              <button
                key={slot}
                type="button"
                className={`audio-ctrl-btn audio-playlist-btn${isActive ? ' is-active' : ''}${isPrimed ? ' is-primed' : ''}${isEmpty ? ' is-empty' : ''}`}
                data-tooltip={
                  isEmpty
                    ? `${PLAYLIST_SLOT_THEMES[slot]}: empty — click to add files`
                    : isPrimed
                      ? `${PLAYLIST_SLOT_THEMES[slot]}: release to clear all ${counts[slot]} songs`
                      : `${PLAYLIST_SLOT_THEMES[slot]}: ${counts[slot]} song${counts[slot] !== 1 ? 's' : ''}${isActive ? ' (active)' : ''}`
                }
                aria-label={PLAYLIST_SLOT_THEMES[slot]}
                aria-pressed={isActive}
                onClick={() => { void handleSlotLeftClick(slot) }}
                data-secondary-press="action"
                onContextMenu={(e) => { void handleSlotContextMenu(e, slot) }}
                onPointerDown={(e) => handleSlotPointerDown(e, slot)}
                onPointerUp={(e) => { void handleSlotPointerUp(e, slot) }}
                onPointerLeave={() => handleSlotPointerLeave(slot)}
              >
                <span className={PLAYLIST_SLOT_ICONS[slot]} aria-hidden="true" />
              </button>
            )
          })}
          <AmbientNoiseButton
            preferences={ambientPreferences}
            onChange={onAmbientPreferencesChange}
          />
          </>
        )}
      </div>
    </div>
  )
})

/**
 * One of the three numeric level buttons in the sound-options row: prints a
 * 0-99 readout and takes a wheel over it.
 *
 * It exists as its own component purely so each readout owns the ref that
 * `useNonPassiveWheel` needs. The listener has to be native and non-passive
 * (React's delegated synthetic wheel runs late enough that the browser can
 * already have nudged the nearest scrollable ancestor -- the sidebar, here --
 * before preventDefault lands), and a hook cannot be called in a loop.
 *
 * Pressing it holds to sweep the value (left down, right up) on the same
 * motion curve the app scrolls with -- see shared/holdToAdjust.ts for why that
 * curve rather than a linear ramp. It stays a div with `tabIndex={-1}` rather
 * than a button because there is no discrete click action to expose: every
 * gesture on it is continuous, and its value is announced through the slider
 * role above.
 */
function SoundLevelButton({
  value,
  onWheel,
  onLevelChange,
  onAdjustStart,
  label,
  tooltip,
  isDimmed,
}: {
  value: number
  onWheel: (event: WheelEvent) => void
  /** Called with a new 0-99 display level while the button is held. */
  onLevelChange: (displayLevel: number) => void
  /** Runs when a hold begins, before the first change (used to un-mute). */
  onAdjustStart: () => void
  label: string
  tooltip: string
  isDimmed: boolean
}) {
  const ref = useRef<HTMLDivElement | null>(null)
  useNonPassiveWheel(ref, onWheel)

  const display = toDisplayLevel(value)
  const displayRef = useRef(display)
  displayRef.current = display

  // Press and hold to sweep the value on the app's own motion curve; see
  // shared/holdToAdjust.ts. Left lowers, right raises.
  const holdHandlers = useHoldToAdjust({
    getValue: () => displayRef.current,
    onChange: onLevelChange,
    onHoldStart: onAdjustStart,
    min: 0,
    max: SOUND_LEVEL_MAX_DISPLAY,
  })

  return (
    <div
      ref={ref}
      className={`audio-ctrl-btn audio-sound-level${isDimmed ? ' is-dimmed' : ''}`}
      role="slider"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={SOUND_LEVEL_MAX_DISPLAY}
      aria-valuenow={display}
      tabIndex={-1}
      data-tooltip={tooltip}
      {...holdHandlers}
    >
      {display}
    </div>
  )
}

/**
 * The ambient-noise switch at the end of the playlist row, which is also the
 * ambient master volume: a click turns ambient sound on or off, a wheel over
 * it nudges the level exactly like a music level readout (Shift: by 10), and
 * a right-click steps to the next soundscape -- the user's own, or the
 * factory ones if there are none (nextAmbientPreset) -- turning ambient on. Wheeling turns ambient sound on if it was off -- the same "adjusting
 * turns it back on" rule the music volume follows with mute.
 *
 * Its own component for the reason SoundLevelButton is: it owns the ref its
 * native wheel listener is bound to. The playlist row unmounts while the
 * sound options are showing, and a listener bound from the parent would not
 * be re-bound to the new button when the row comes back.
 */
function AmbientNoiseButton({
  preferences,
  onChange,
}: {
  preferences: AmbientPreferences
  onChange: (preferences: AmbientPreferences) => void
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
  const next = nextAmbientPreset(preferences)
  return (
    <button
      ref={ref}
      type="button"
      className={`audio-ctrl-btn audio-ambient-noise-btn${preferences.enabled ? ' is-active' : ''}`}
      data-tooltip={`Ambient noise ${preferences.enabled ? `on, volume ${level}` : 'off'} — click to turn ${preferences.enabled ? 'off' : 'on'}. Scroll to adjust volume (Shift: by 10). Right-click for the next soundscape (${next.name}).`}
      data-secondary-press="action"
      onContextMenu={(event) => {
        event.preventDefault()
        onChange(applyAmbientPreset(preferences, next))
      }}
      aria-label={preferences.enabled ? 'Turn ambient noise off' : 'Turn ambient noise on'}
      aria-pressed={preferences.enabled}
      onClick={() => onChange({ ...preferences, enabled: !preferences.enabled })}
    >
      <span className="fa-solid fa-cloud-bolt" aria-hidden="true" />
    </button>
  )
}
