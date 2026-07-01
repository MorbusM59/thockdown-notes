import { memo, useCallback, useEffect, useRef, useState } from 'react'
import type { MouseEvent } from 'react'
import type { MusicSongEntry, PlaylistSlot, PlaylistCountsResult } from '../shared/audioPlayer'
import { PLAYLIST_SLOT_ICONS } from '../shared/audioPlayer'
import { musicPlayerService, MissingFileError } from '../sound/MusicPlayerService'

// Duration (ms) a pointer must be held to trigger the "arm for clear" action.
const HOLD_THRESHOLD_MS = 700

const SLOTS: PlaylistSlot[] = [1, 2, 3, 4, 5]

export interface AudioControlsProps {
  /** 0–1 volume for the music player. */
  volume: number
  reverbAmount: number
  reverbRoom: number
  /** Which playlist slots are currently toggled active. */
  activeSlots: PlaylistSlot[]
  onActiveSlotsChange: (slots: PlaylistSlot[]) => void
  /** Called when the options panel should open to the Music section. */
  onOpenMusicOptions: () => void
}

export const AudioControls = memo(function AudioControls({
  volume,
  reverbAmount,
  reverbRoom,
  activeSlots,
  onActiveSlotsChange,
  onOpenMusicOptions,
}: AudioControlsProps) {
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentSong, setCurrentSong] = useState<MusicSongEntry | null>(null)
  const [counts, setCounts] = useState<PlaylistCountsResult>({ 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 })
  // Slot button that is currently "armed" for clearing (held right-click)
  const [armedSlot, setArmedSlot] = useState<PlaylistSlot | null>(null)

  const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const seekTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const seekIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const isSeekScrubbing = useRef(false)
  const activeRef = useRef(activeSlots)
  activeRef.current = activeSlots

  const currentSongRef = useRef<MusicSongEntry | null>(null)

  const refreshCountsRef = useRef(async () => {
    const c = await window.measlyAudioPlayer?.getPlaylistCounts()
    if (c) setCounts(c)
  })

  // Sync player config whenever props change.
  useEffect(() => {
    musicPlayerService.setConfig({ volume, reverbAmount, reverbRoom })
  }, [volume, reverbAmount, reverbRoom])

  // Refresh playlist counts on mount.
  useEffect(() => {
    void window.measlyAudioPlayer?.getPlaylistCounts().then((c) => {
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
        void window.measlyAudioPlayer?.afterPlay(finished.id)
      }
      void advanceToNextSong()
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ---------------------------------------------------------------- helpers

  const advanceToNextSong = useCallback(async () => {
    const slots = activeRef.current
    if (slots.length === 0) {
      setIsPlaying(false)
      setCurrentSong(null)
      return
    }

    // Safety limit: avoid an infinite loop if every song in the pool is missing.
    const MAX_ATTEMPTS = 50
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const next = await window.measlyAudioPlayer?.pickNextSong(slots)
      if (!next) {
        setIsPlaying(false)
        setCurrentSong(null)
        return
      }
      try {
        setCurrentSong(next)
        await musicPlayerService.play(next.filePath)
        setIsPlaying(true)
        return
      } catch (err) {
        if (err instanceof MissingFileError) {
          // Silently purge the bad entry and try the next song.
          await window.measlyAudioPlayer?.purgeSong(next.id)
          await refreshCountsRef.current()
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
  }, [])

  const refreshCounts = useCallback(async () => {
    await refreshCountsRef.current()
  }, [])

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
          setIsPlaying(true)
        } catch (err) {
          if (err instanceof MissingFileError) {
            // File gone since last session — purge and pick a fresh song.
            await window.measlyAudioPlayer?.purgeSong(currentSong.id)
            setCurrentSong(null)
            musicPlayerService.stop()
            await refreshCountsRef.current()
            await advanceToNextSong()
          } else {
            throw err
          }
        }
      } else {
        await advanceToNextSong()
      }
    }
  }, [isPlaying, currentSong, advanceToNextSong, refreshCounts])

  // ---------------------------------------------------------------- favorability button

  const handleFavoriteLeft = useCallback(async () => {
    if (!currentSong) return
    const updated = await window.measlyAudioPlayer?.favoriteSong(currentSong.id)
    if (updated) setCurrentSong(updated)
    // Priority set to 0 = replay immediately on next advance; do nothing more here.
  }, [currentSong])

  const handleSkipRight = useCallback(async (event: MouseEvent) => {
    event.preventDefault()
    if (!currentSong) return
    await window.measlyAudioPlayer?.skipSong(currentSong.id)
    if (currentSong.id != null) {
      // Mark the old song as played so it gets deprioritized.
      await window.measlyAudioPlayer?.afterPlay(currentSong.id)
    }
    await advanceToNextSong()
  }, [currentSong, advanceToNextSong])

  const handleFavoriteContextMenu = useCallback((event: MouseEvent) => {
    event.preventDefault()
    // Right-click = skip; check for held right-click is handled by pointer events below.
    void handleSkipRight(event)
  }, [handleSkipRight])

  // Held right-click on the favorability button = purge song.
  const favHoldTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const favArmedRef = useRef(false)

  const handleFavPointerDown = useCallback((event: React.PointerEvent) => {
    if (event.button !== 2) return
    event.preventDefault()
    favArmedRef.current = false
    favHoldTimerRef.current = setTimeout(() => {
      favArmedRef.current = true
    }, HOLD_THRESHOLD_MS)
  }, [])

  const handleFavPointerUp = useCallback(async (event: React.PointerEvent) => {
    if (event.button !== 2) return
    if (favHoldTimerRef.current) {
      clearTimeout(favHoldTimerRef.current)
      favHoldTimerRef.current = null
    }
    if (favArmedRef.current && currentSong) {
      favArmedRef.current = false
      musicPlayerService.stop()
      setIsPlaying(false)
      await window.measlyAudioPlayer?.purgeSong(currentSong.id)
      setCurrentSong(null)
      await refreshCounts()
      // Pick the next song.
      await advanceToNextSong()
    }
    // Normal right-click handled by contextmenu event.
  }, [currentSong, advanceToNextSong, refreshCounts])

  // ---------------------------------------------------------------- seek button
  // Left-click: +20%.  Right-click: −20%.
  // Hold either button: ±5% per 100 ms after a 200 ms initial delay.

  const SEEK_HOLD_DELAY_MS = 200
  const SEEK_INTERVAL_MS = 100
  const SEEK_HOLD_STEP = 0.05
  const SEEK_CLICK_STEP = 0.2

  const stopSeekScrub = useCallback(() => {
    if (seekTimerRef.current) {
      clearTimeout(seekTimerRef.current)
      seekTimerRef.current = null
    }
    if (seekIntervalRef.current) {
      clearInterval(seekIntervalRef.current)
      seekIntervalRef.current = null
    }
    isSeekScrubbing.current = false
  }, [])

  const handleSeekPointerDown = useCallback((event: React.PointerEvent) => {
    if (event.button !== 0 && event.button !== 2) return
    event.preventDefault()
    const direction = event.button === 0 ? 1 : -1
    seekTimerRef.current = setTimeout(() => {
      isSeekScrubbing.current = true
      musicPlayerService.seek(direction * SEEK_HOLD_STEP)
      seekIntervalRef.current = setInterval(() => {
        musicPlayerService.seek(direction * SEEK_HOLD_STEP)
      }, SEEK_INTERVAL_MS)
    }, SEEK_HOLD_DELAY_MS)
  }, [])

  const handleSeekPointerUp = useCallback((event: React.PointerEvent) => {
    if (event.button !== 0 && event.button !== 2) return
    stopSeekScrub()
  }, [stopSeekScrub])

  const handleSeekClick = useCallback(() => {
    if (isSeekScrubbing.current) return
    musicPlayerService.seek(SEEK_CLICK_STEP)
  }, [])

  const handleSeekContextMenu = useCallback((event: React.MouseEvent) => {
    event.preventDefault()
    if (isSeekScrubbing.current) return
    musicPlayerService.seek(-SEEK_CLICK_STEP)
  }, [])

  // ---------------------------------------------------------------- playlist buttons

  const handleSlotLeftClick = useCallback(async (slot: PlaylistSlot) => {
    if (counts[slot] === 0) {
      // Empty playlist: open file picker.
      const files = await window.measlyAudioPlayer?.pickFiles()
      if (files && files.length > 0) {
        await window.measlyAudioPlayer?.addSongs(slot, files)
        await refreshCounts()
        // Auto-toggle the slot on after first add.
        if (!activeSlots.includes(slot)) {
          onActiveSlotsChange([...activeSlots, slot])
        }
      }
      return
    }
    // Toggle the slot in/out of the active pool.
    const next = activeSlots.includes(slot)
      ? activeSlots.filter((s) => s !== slot)
      : [...activeSlots, slot]
    onActiveSlotsChange(next)
  }, [counts, activeSlots, onActiveSlotsChange, refreshCounts])

  const handleSlotRightClick = useCallback(async (event: MouseEvent, slot: PlaylistSlot) => {
    event.preventDefault()
    if (armedSlot === slot) return // Already armed — wait for pointer-up.
    // Normal right-click = add more files.
    const files = await window.measlyAudioPlayer?.pickFiles()
    if (files && files.length > 0) {
      await window.measlyAudioPlayer?.addSongs(slot, files)
      await refreshCounts()
    }
  }, [armedSlot, refreshCounts])

  const handleSlotPointerDown = useCallback((event: React.PointerEvent, slot: PlaylistSlot) => {
    if (event.button !== 2) return
    event.preventDefault()
    holdTimerRef.current = setTimeout(() => {
      setArmedSlot(slot)
    }, HOLD_THRESHOLD_MS)
  }, [])

  const handleSlotPointerUp = useCallback(async (event: React.PointerEvent, slot: PlaylistSlot) => {
    if (event.button !== 2) return
    if (holdTimerRef.current) {
      clearTimeout(holdTimerRef.current)
      holdTimerRef.current = null
    }
    if (armedSlot === slot) {
      setArmedSlot(null)
      await window.measlyAudioPlayer?.clearPlaylist(slot)
      await refreshCounts()
      // Remove this slot from active set if it was active.
      onActiveSlotsChange(activeSlots.filter((s) => s !== slot))
      // If current song was from this slot, stop and pick next.
      if (currentSong?.playlistSlot === slot) {
        musicPlayerService.stop()
        setIsPlaying(false)
        setCurrentSong(null)
        await advanceToNextSong()
      }
    }
  }, [armedSlot, activeSlots, currentSong, onActiveSlotsChange, refreshCounts, advanceToNextSong])

  const handleSlotShiftRightClick = useCallback(async (event: MouseEvent, slot: PlaylistSlot) => {
    if (!event.shiftKey) return
    event.preventDefault()
    const folder = await window.measlyAudioPlayer?.pickFolder()
    if (!folder) return
    const files = await window.measlyAudioPlayer?.scanFolderForAudio(folder)
    if (files && files.length > 0) {
      await window.measlyAudioPlayer?.addSongs(slot, files)
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

  // ---------------------------------------------------------------- render

  return (
    <div className="audio-controls" aria-label="Audio player controls">
      {/* Top row — playback controls */}
      <div className="audio-micro-grid">
        {/* Play / stop — spans 2 columns */}
        <button
          type="button"
          className={`audio-ctrl-btn audio-play-btn${isPlaying ? ' is-active' : ''}`}
          title={isPlaying ? `Stop — ${songLabel}` : `Play — ${songLabel}`}
          aria-label={isPlaying ? 'Stop music' : 'Play music'}
          aria-pressed={isPlaying}
          onClick={() => { void handlePlayToggle() }}
          style={{ gridColumn: 'span 2' }}
        >
          <span
            className={`fa-solid ${isPlaying ? 'fa-stop' : 'fa-play'}`}
            aria-hidden="true"
          />
          <span className="audio-song-label" aria-hidden="true">{songLabel}</span>
        </button>

        {/* Favorability / skip button */}
        <button
          type="button"
          className={`audio-ctrl-btn${currentSong?.priority === 0 ? ' is-active' : ''}`}
          title="Left-click: favourite (replay next). Right-click: skip. Hold right-click: purge."
          aria-label="Favourite or skip current song"
          aria-pressed={currentSong?.priority === 0}
          onClick={() => { void handleFavoriteLeft() }}
          onContextMenu={handleFavoriteContextMenu}
          onPointerDown={handleFavPointerDown}
          onPointerUp={(e) => { void handleFavPointerUp(e) }}
        >
          <span className="fa-solid fa-heart" aria-hidden="true" />
        </button>

        {/* Seek button — left-click: +20%, right-click: −20%, hold: ±5%/100 ms */}
        <button
          type="button"
          className="audio-ctrl-btn"
          title="Left-click: forward 20%. Right-click: rewind 20%. Hold: scrub ±5%/100 ms."
          aria-label="Seek forward or backward"
          onClick={handleSeekClick}
          onContextMenu={handleSeekContextMenu}
          onPointerDown={handleSeekPointerDown}
          onPointerUp={handleSeekPointerUp}
          onPointerLeave={stopSeekScrub}
        >
          <span className="fa-solid fa-forward-step" aria-hidden="true" />
        </button>

        {/* Options toggle */}
        <button
          type="button"
          className="audio-ctrl-btn"
          title="Music options"
          aria-label="Open music options"
          onClick={onOpenMusicOptions}
        >
          <span className="fa-solid fa-sliders" aria-hidden="true" />
        </button>

        {/* Bottom row — playlist slot buttons */}
        {SLOTS.map((slot) => {
          const isEmpty = counts[slot] === 0
          const isActive = activeSlots.includes(slot)
          const isArmed = armedSlot === slot
          return (
            <button
              key={slot}
              type="button"
              className={`audio-ctrl-btn audio-playlist-btn${isActive ? ' is-active' : ''}${isArmed ? ' is-armed' : ''}${isEmpty ? ' is-empty' : ''}`}
              title={
                isEmpty
                  ? `Playlist ${slot}: empty — click to add files`
                  : isArmed
                    ? `Playlist ${slot}: release to clear all ${counts[slot]} songs`
                    : `Playlist ${slot}: ${counts[slot]} song${counts[slot] !== 1 ? 's' : ''}${isActive ? ' (active)' : ''}`
              }
              aria-label={`Playlist ${slot}`}
              aria-pressed={isActive}
              onClick={() => { void handleSlotLeftClick(slot) }}
              onContextMenu={(e) => { void handleSlotContextMenu(e, slot) }}
              onPointerDown={(e) => handleSlotPointerDown(e, slot)}
              onPointerUp={(e) => { void handleSlotPointerUp(e, slot) }}
            >
              <span className={PLAYLIST_SLOT_ICONS[slot]} aria-hidden="true" />
            </button>
          )
        })}
      </div>
    </div>
  )
})
