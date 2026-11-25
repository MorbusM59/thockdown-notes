/**
 * THE DASHBOARD, the phone's first tab: where what plays is PICKED. The other
 * tabs create and edit the choices (sets, soundscapes, schedules,
 * soundstages); here each is one grid of the choices, a tap making one the
 * active one. Its dock (DashboardDock) holds the transport and the volumes.
 *
 * The phone has no right press, so the desktop music bar's right-click skip
 * is a button of its own here.
 */
import { type ReactNode, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { OptionsFixedSection } from '@thockdown/interaction/OptionsFixedSection'
import { CompactScrollbarSlider } from '@thockdown/interaction/CompactScrollbarSlider'
import { armHold, HOLD_CONFIRM_MS } from '@thockdown/interaction/holdTiming'
import { SetMark } from '@thockdown/visualizer/library/MusicSetRow'
import { pressMusicSet } from '@thockdown/visualizer/sound/setPress'
import { readNowPlaying, subscribeNowPlaying } from '@thockdown/visualizer/sound/nowPlaying'
import { SoundscapeMark } from '@thockdown/soundscape/SoundscapeOptions'
import { orderedSoundscapePresets, type SoundscapePreferences, type SoundscapePreset } from '@thockdown/soundscape/soundscape'
import { FieldActionButton } from '@thockdown/interaction/FieldActionButton'
import { commitPoolFilterDraft, readShownPoolFilter, setPoolFilterQuery, subscribePoolFilterDraft, togglePoolFilter } from '@thockdown/visualizer/visualizer/poolFilterDraft'
import { songAlbumText, songArtistText, songTitleText, type MusicSongEntry } from '@thockdown/visualizer/shared/audioPlayer'
import { musicListening } from '@thockdown/visualizer/sound/musicListening'
import { pauseMusic, readMusicChannel, readMusicPlaying, setMusicChannel, startMusic, subscribeMusicPlaying } from './mobileMusicPlayer'

/** The music sets: a tap puts a set in the pool or takes it out, a hold makes it the only one (setPress.ts, as everywhere); neither starts playback. */
export function DashboardSets() {
  const nowPlaying = useSyncExternalStore(subscribeNowPlaying, readNowPlaying)
  const active = nowPlaying.pool?.active ?? []
  if (nowPlaying.musicSets.length === 0) return null
  return (
    <OptionsFixedSection heading="Song Sets" iconClass="fa-compact-disc">
      <div className="options-loadout-grid" role="group" aria-label="Song Sets">
        {nowPlaying.musicSets.map((set) => {
          const isActive = active.includes(set.slot)
          return (
            <button
              key={set.slot}
              type="button"
              className={`btn-icon options-color-swatch options-loadout-btn${isActive ? ' is-active' : ''}`}
              aria-label={`${set.name}, ${isActive ? 'in the pool' : 'not in the pool'}: tap to toggle, hold to make it the only set`}
              aria-pressed={isActive}
              data-secondary-press="none"
              onPointerDown={(event) => pressMusicSet(event.nativeEvent, {
                toggle: () => nowPlaying.selectSlot(set.slot, 'toggle'),
                hold: () => nowPlaying.selectSlot(set.slot, 'solo'),
              })}
              onContextMenu={(event) => event.preventDefault()}
            >
              <SetMark set={set} />
            </button>
          )
        })}
      </div>
    </OptionsFixedSection>
  )
}

/** The soundscapes: a tap picks the one the play button starts, and crossfades into it while a soundscape is heard. */
export function DashboardSoundscapes({ preferences, onPick }: { preferences: SoundscapePreferences; onPick: (preset: SoundscapePreset) => void }) {
  return (
    <OptionsFixedSection heading="Soundscape" iconClass="fa-podcast">
      <div className="options-loadout-grid" role="group" aria-label="Soundscapes">
        {orderedSoundscapePresets(preferences).map((preset) => {
          const isActive = preferences.activePresetId === preset.id
          return (
            <button
              key={preset.id}
              type="button"
              className={`btn-icon options-color-swatch options-loadout-btn${isActive ? ' is-active' : ''}`}
              aria-label={preset.name}
              aria-pressed={isActive}
              onClick={() => onPick(preset)}
            >
              <SoundscapeMark preset={preset} />
            </button>
          )
        })}
      </div>
    </OptionsFixedSection>
  )
}

/** A button whose tap does one thing and whose hold another; the click after a hold is swallowed. */
export function TapHoldButton({ label, active, className = '', onTap, onHold, children }: { label: string; active: boolean; className?: string; onTap: () => void; onHold: () => void; children: ReactNode }) {
  const holdRef = useRef<(() => void) | null>(null)
  const swallowRef = useRef(false)
  useEffect(() => () => holdRef.current?.(), [])
  const end = () => {
    holdRef.current?.()
    holdRef.current = null
  }
  return (
    <button
      type="button"
      className={`btn-icon options-color-swatch options-loadout-btn${className ? ` ${className}` : ''}${active ? ' is-active' : ''}`}
      aria-label={label}
      aria-pressed={active}
      data-secondary-press="none"
      onClick={() => {
        if (swallowRef.current) {
          swallowRef.current = false
          return
        }
        onTap()
      }}
      onPointerDown={() => {
        swallowRef.current = false
        end()
        holdRef.current = armHold(() => {
          holdRef.current = null
          swallowRef.current = true
          onHold()
        }, HOLD_CONFIRM_MS)
      }}
      onPointerUp={end}
      onPointerCancel={end}
      onPointerLeave={end}
      onContextMenu={(event) => event.preventDefault()}
    >
      {children}
    </button>
  )
}

/** Seconds as the music bar reads them: m:ss, or h:mm:ss from an hour. */
function clockText(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds))
  const h = Math.floor(whole / 3600)
  const m = Math.floor((whole % 3600) / 60)
  const sec = String(whole % 60).padStart(2, '0')
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`
}

/**
 * The song that plays, drawn as the soundscape dock's name cell across the
 * whole row: its title, then its artist and album.
 */
function SongName({ song }: { song: MusicSongEntry | null }) {
  const title = song ? songTitleText(song) : 'no song'
  const detail = song ? `${songArtistText(song)} (${songAlbumText(song)})` : null
  return (
    <div className={`options-curve-cell options-curve-display options-dock-entry-name mobile-dock-song${detail ? ' has-detail' : ''}`} aria-label={detail ? `${title}, ${detail}` : title}>
      {detail ? (<>
        <span className="options-dock-entry-title">{title}</span>
        <span className="options-dock-entry-detail">{detail}</span>
      </>) : title}
    </div>
  )
}

/**
 * Where the song is: a slider across the row, as the volumes are, reading
 * its position and length and seeking on a press, between chips stepping to
 * the previous and the next song. Read once a second while the music plays
 * (a clock in seconds changes no oftener), and on every change of song.
 */
/**
 * The song's position. It ticks as often as moves the thumb about a pixel
 * (the song's length over the track's width, between 50 ms and a second),
 * so it glides rather than jumping once a second. A drag shows where the
 * finger is and seeks once, on release; until the music reports a time near
 * the seek, the thumb stays where it was let go rather than snapping back.
 * Keyed by the song, so a new song starts with nothing held.
 */
function SongProgress({ playing, jumpSong }: { playing: boolean; jumpSong: (direction: -1 | 1) => void }) {
  const listening = musicListening()
  const duration = listening.currentDurationSec
  const rowRef = useRef<HTMLDivElement | null>(null)
  const [, setTick] = useState(0)
  // Where the thumb is held: during a drag, and after a seek until the music catches up.
  const [held, setHeld] = useState<number | null>(null)
  const heldRef = useRef<number | null>(null)
  const draggingRef = useRef(false)
  const hold = (seconds: number | null) => {
    heldRef.current = seconds
    setHeld(seconds)
  }
  useEffect(() => {
    if (!playing || duration <= 0) return
    const trackPx = Math.max(1, rowRef.current?.offsetWidth ?? 1)
    const intervalMs = Math.min(1000, Math.max(50, (duration * 1000) / trackPx))
    const timer = window.setInterval(() => {
      // A seek has landed once the music reports a time within a second of it.
      const target = heldRef.current
      if (target !== null && !draggingRef.current && Math.abs(musicListening().currentTime - target) < 1) hold(null)
      setTick((tick) => tick + 1)
    }, intervalMs)
    return () => window.clearInterval(timer)
  }, [playing, duration])
  const heard = Math.min(listening.currentTime, duration)
  const seek = (seconds: number) => {
    hold(seconds)
    if (duration > 0) listening.setCurrentTimeFraction(seconds / duration)
  }
  const position = held ?? heard
  return (
    <div ref={rowRef} className="options-slider-row mobile-dock-slider-row" role="group" aria-label="Song position">
      <button type="button" className="btn-icon options-color-swatch options-loadout-btn mobile-dock-chip" aria-label="Previous song" onClick={() => jumpSong(-1)}>
        <span className="fa-solid fa-backward-step" aria-hidden="true" />
      </button>
      <CompactScrollbarSlider
        id="mobile-dashboard-song-position"
        value={position}
        min={0}
        max={Math.max(1, duration)}
        step={1}
        trackLabel={duration > 0 ? `${clockText(position)} / ${clockText(duration)}` : ''}
        ariaLabel="Song position"
        formatValue={clockText}
        disabled={duration <= 0}
        onDraggingChange={(dragging) => {
          draggingRef.current = dragging
          if (!dragging && heldRef.current !== null) seek(heldRef.current)
        }}
        onCommit={(seconds) => {
          if (draggingRef.current) hold(seconds)
          else seek(seconds)
        }}
      />
      <button type="button" className="btn-icon options-color-swatch options-loadout-btn mobile-dock-chip" aria-label="Next song" onClick={() => jumpSong(1)}>
        <span className="fa-solid fa-forward-step" aria-hidden="true" />
      </button>
    </div>
  )
}

/** The help button every dock ends with, bottom right: help mode shows each tab's help section in place of its controls. */
export function DockHelpButton({ active, onToggle }: { active: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      className={`btn-icon options-color-swatch options-loadout-btn mobile-dock-help${active ? ' is-active' : ''}`}
      aria-pressed={active}
      aria-label={active ? 'Close the help' : 'Help: explain this tab'}
      onClick={onToggle}
    >
      <span className="fa-solid fa-circle-question" aria-hidden="true" />
    </button>
  )
}

/** A dock row holding only the help button, for a dock with no button row of its own (or a tab with no dock). */
export function DockHelpRow(props: { active: boolean; onToggle: () => void }) {
  return (
    <div className="options-loadout-grid" role="group" aria-label="Help">
      <DockHelpButton {...props} />
    </div>
  )
}

/**
 * The pool filter's row, shown while the filter is on: the field across five
 * columns and the field's action button in the sixth, which applies what is
 * typed and leaves the field while it is being typed in, and otherwise clears
 * the filter. Typing reaches the song list at once and playback when the
 * field is left (poolFilterDraft.ts), as on the desktop's music bar.
 */
function DashboardFilter() {
  const filter = useSyncExternalStore(subscribePoolFilterDraft, readShownPoolFilter)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [isFocused, setIsFocused] = useState(false)
  return (
    <div className="mobile-dock-field-row" role="group" aria-label="Filter songs">
      <input
        ref={inputRef}
        className="options-curve-cell options-curve-field mobile-dock-field"
        type="text"
        value={filter.query}
        placeholder="Filter songs..."
        aria-label="Filter songs"
        spellCheck={false}
        autoComplete="off"
        onChange={(event) => setPoolFilterQuery(event.currentTarget.value)}
        onFocus={() => setIsFocused(true)}
        onBlur={() => {
          setIsFocused(false)
          commitPoolFilterDraft()
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            event.currentTarget.blur()
          }
        }}
      />
      <FieldActionButton
        className="btn-icon options-color-swatch options-loadout-btn mobile-dock-chip"
        icon="fa-filter"
        submitLabel="Filter"
        isFieldFocused={isFocused}
        hasValue={filter.query !== ''}
        onSubmit={() => inputRef.current?.blur()}
        onClear={() => {
          setPoolFilterQuery('')
          commitPoolFilterDraft()
        }}
      />
    </div>
  )
}

/**
 * The dashboard's dock, top to bottom: the two volumes; while the music
 * channel is in the mix, the filter's switch between them (a square chip),
 * the pool filter's row while the filter is on, the song across the row and
 * where it is; then the button row: the schedule's switch, the music
 * channel, the mix's transport two cells wide, the soundscape channel, and
 * help.
 *
 * The TRANSPORT is the whole mix's: a tap plays or pauses the music and the
 * soundscape together, a hold stops them (the soundscape hands back to the
 * schedule). Playing, it shows the timer's time left, or play without a
 * timer; otherwise pause or stop. The CHANNEL buttons switch the music and
 * the soundscape in and out of the mix: switched out, a channel is silent
 * whoever plays it, and carries on unheard.
 */
export function DashboardDock({ toggles, timeLeft, soundscape, onSoundscapeTransport, onStop, soundscapeChannel, onSoundscapeChannel, soundscapeVolume, onSoundscapeVolume, schedule, scheduleHeard, onScheduleToggle, help, onHelpToggle }: {
  /** The toggle row (DashboardToggleRow.tsx), above the volumes. */
  toggles: ReactNode
  /** The timer's time left (h:mm:ss), or null without one. */
  timeLeft: string | null
  /** The schedule is on; it plays now (it is what is heard). */
  schedule: boolean
  scheduleHeard: boolean
  onScheduleToggle: () => void
  /** Regular mode: the soundscape as the transport plays, pauses and stops it. */
  soundscape: 'playing' | 'paused' | 'stopped'
  onSoundscapeTransport: (mode: 'playing' | 'paused') => void
  /** Stops the soundscape (regular mode STOPPED); the transport pauses the music with it. */
  onStop: () => void
  soundscapeChannel: boolean
  onSoundscapeChannel: (on: boolean) => void
  soundscapeVolume: number
  onSoundscapeVolume: (volume: number) => void
  help: boolean
  onHelpToggle: () => void
}) {
  const musicPlaying = useSyncExternalStore(subscribeMusicPlaying, readMusicPlaying)
  const musicChannel = useSyncExternalStore(subscribeMusicPlaying, readMusicChannel)
  const nowPlaying = useSyncExternalStore(subscribeNowPlaying, readNowPlaying)
  const filter = useSyncExternalStore(subscribePoolFilterDraft, readShownPoolFilter)
  // The mix plays while either does; it is stopped only with the soundscape stopped and the music not playing.
  const mix = musicPlaying || soundscape === 'playing' ? 'playing' : soundscape === 'stopped' ? 'stopped' : 'paused'
  return (
    <div className="mobile-dashboard-dock">
      {toggles}
      <div className="options-slider-row mobile-dock-slider-row">
        <CompactScrollbarSlider
          id="mobile-dashboard-music-volume"
          value={Math.round((nowPlaying.levels?.volume ?? 1) * 100)}
          min={0}
          max={100}
          step={1}
          trackLabel="music"
          ariaLabel="Music volume"
          formatValue={(value) => `${value}%`}
          onCommit={(value) => nowPlaying.setLevel('volume', value / 100)}
        />
        {musicChannel ? (
          <button
            type="button"
            className={`btn-icon options-color-swatch options-loadout-btn mobile-dock-chip${filter.enabled ? ' is-active' : ''}`}
            aria-pressed={filter.enabled}
            aria-label={filter.enabled ? 'Filter on: tap to switch it off' : 'Filter off: tap to switch it on'}
            onClick={togglePoolFilter}
          >
            <span className="fa-solid fa-filter" aria-hidden="true" />
          </button>
        ) : null}
        <CompactScrollbarSlider
          id="mobile-dashboard-soundscape-volume"
          value={Math.round(soundscapeVolume * 100)}
          min={0}
          max={100}
          step={1}
          trackLabel="soundscape"
          ariaLabel="Soundscape volume"
          formatValue={(value) => `${value}%`}
          onCommit={(value) => onSoundscapeVolume(value / 100)}
        />
      </div>
      {musicChannel ? (<>
        {filter.enabled ? <DashboardFilter /> : null}
        <SongName song={nowPlaying.song} />
        <SongProgress key={nowPlaying.song?.id ?? 'none'} playing={musicPlaying} jumpSong={nowPlaying.jumpSong} />
      </>) : null}
      <div className="options-loadout-grid" role="group" aria-label="Play">
        <button
          type="button"
          className={`btn-icon options-color-swatch options-loadout-btn${schedule ? ' is-active' : ''}${scheduleHeard ? ' is-heard' : ''}`}
          aria-pressed={schedule}
          aria-label={`Schedule ${schedule ? 'on' : 'off'}${scheduleHeard ? ', playing now' : ''}`}
          onClick={onScheduleToggle}
        >
          <span className="fa-solid fa-clock" aria-hidden="true" />
        </button>
        <button
          type="button"
          className={`btn-icon options-color-swatch options-loadout-btn${musicChannel ? ' is-active' : ''}`}
          aria-pressed={musicChannel}
          aria-label={`Music channel ${musicChannel ? 'on' : 'off'}`}
          onClick={() => {
            // Switched in while the mix plays, the music joins it at once.
            if (!musicChannel && mix === 'playing') void startMusic()
            setMusicChannel(!musicChannel)
          }}
        >
          <span className="fa-solid fa-compact-disc" aria-hidden="true" />
        </button>
        <TapHoldButton
          label={`Playback ${mix}${timeLeft ? `, ${timeLeft} left` : ''}: tap to ${mix === 'playing' ? 'pause' : 'play'}${mix === 'stopped' ? '' : ', hold to stop'}`}
          active={mix === 'playing'}
          className="mobile-dock-transport"
          onTap={() => {
            if (mix === 'playing') {
              pauseMusic()
              if (soundscape === 'playing') onSoundscapeTransport('paused')
            } else {
              void startMusic()
              onSoundscapeTransport('playing')
            }
          }}
          onHold={() => {
            pauseMusic()
            onStop()
          }}
        >
          {mix === 'playing' && timeLeft
            ? <span className="mobile-dock-transport-time" aria-hidden="true">{timeLeft}</span>
            : <span className={`fa-solid ${mix === 'playing' ? 'fa-play' : mix === 'paused' ? 'fa-pause' : 'fa-stop'}`} aria-hidden="true" />}
        </TapHoldButton>
        <button
          type="button"
          className={`btn-icon options-color-swatch options-loadout-btn${soundscapeChannel ? ' is-active' : ''}`}
          aria-pressed={soundscapeChannel}
          aria-label={`Soundscape channel ${soundscapeChannel ? 'on' : 'off'}`}
          onClick={() => {
            // Switched in while the mix plays, the soundscape joins it at once
            // rather than waiting for the next press of play.
            if (!soundscapeChannel && mix === 'playing' && soundscape !== 'playing') onSoundscapeTransport('playing')
            onSoundscapeChannel(!soundscapeChannel)
          }}
        >
          <span className="fa-solid fa-podcast" aria-hidden="true" />
        </button>
        <DockHelpButton active={help} onToggle={onHelpToggle} />
      </div>
    </div>
  )
}
