/**
 * THE DASHBOARD, the phone's first tab: where what plays is PICKED. The other
 * tabs create and edit the choices (sets, soundscapes, schedules,
 * soundstages); here each is one grid of the choices, a tap making one the
 * active one. Its dock (DashboardDock) holds the transport and the volumes.
 *
 * The phone has no right press, so the desktop music bar's right-click skip
 * is a button of its own here.
 */
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { OptionsSubsectionLabel } from '@thockdown/interaction/OptionsSubsectionLabel'
import { CompactScrollbarSlider } from '@thockdown/interaction/CompactScrollbarSlider'
import { armHold, HOLD_CONFIRM_MS } from '@thockdown/interaction/holdTiming'
import { SetMark } from '@thockdown/visualizer/library/MusicSetRow'
import { pressMusicSet } from '@thockdown/visualizer/sound/setPress'
import { readNowPlaying, subscribeNowPlaying } from '@thockdown/visualizer/sound/nowPlaying'
import { SoundscapeMark } from '@thockdown/soundscape/SoundscapeOptions'
import { orderedSoundscapePresets, type SoundscapePreferences, type SoundscapePreset } from '@thockdown/soundscape/soundscape'
import { FieldActionButton } from '@thockdown/interaction/FieldActionButton'
import { commitPoolFilterDraft, readShownPoolFilter, setPoolFilterQuery, subscribePoolFilterDraft, togglePoolFilter } from '@thockdown/visualizer/visualizer/poolFilterDraft'
import { pauseMusic, readMusicChannel, readMusicPlaying, setMusicChannel, skipMusic, startMusic, subscribeMusicPlaying } from './mobileMusicPlayer'

/** The music sets: a tap puts a set in the pool or takes it out, a hold makes it the only one (setPress.ts, as everywhere); neither starts playback. */
export function DashboardSets() {
  const nowPlaying = useSyncExternalStore(subscribeNowPlaying, readNowPlaying)
  const active = nowPlaying.pool?.active ?? []
  if (nowPlaying.musicSets.length === 0) return null
  return (
    <div className="utility-setting-slider-stack" aria-label="Music sets">
      <OptionsSubsectionLabel>Music</OptionsSubsectionLabel>
      <div className="options-loadout-grid" role="group" aria-label="Music sets">
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
    </div>
  )
}

/** The soundscapes: a tap picks the one the play button starts, and crossfades into it while a soundscape is heard. */
export function DashboardSoundscapes({ preferences, onPick }: { preferences: SoundscapePreferences; onPick: (preset: SoundscapePreset) => void }) {
  return (
    <div className="utility-setting-slider-stack" aria-label="Soundscapes">
      <OptionsSubsectionLabel>Soundscape</OptionsSubsectionLabel>
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
    </div>
  )
}

/** A button whose tap does one thing and whose hold another; the click after a hold is swallowed. */
function TapHoldButton({ label, active, icon, onTap, onHold }: { label: string; active: boolean; icon: string; onTap: () => void; onHold: () => void }) {
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
      className={`btn-icon options-color-swatch options-loadout-btn${active ? ' is-active' : ''}`}
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
      <span className={`fa-solid ${icon}`} aria-hidden="true" />
    </button>
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
        // Switching an empty filter on is asking to type; one with a query is taken as it stands.
        autoFocus={filter.query === ''}
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
 * The dashboard's dock. On top the two volumes with the filter's switch
 * between them, a square chip; the pool filter's row below them while it is
 * on; then the button row: skip, the music channel, the mix's transport, the
 * soundscape channel, the schedule's switch, and help.
 *
 * The TRANSPORT is the whole mix's: a tap plays or pauses the music and the
 * soundscape together, a hold stops them (the soundscape hands back to the
 * schedule). The CHANNEL buttons switch the music and the soundscape in and
 * out of the mix: switched out, a channel is silent whoever plays it, and
 * carries on unheard.
 */
export function DashboardDock({ soundscape, onSoundscapeTransport, onStop, soundscapeChannel, onSoundscapeChannel, soundscapeVolume, onSoundscapeVolume, schedule, scheduleHeard, onScheduleToggle, help, onHelpToggle }: {
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
      <div className="options-slider-row mobile-dock-volumes">
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
        <button
          type="button"
          className={`btn-icon options-color-swatch options-loadout-btn mobile-dock-chip${filter.enabled ? ' is-active' : ''}`}
          aria-pressed={filter.enabled}
          aria-label={filter.enabled ? 'Filter on: tap to switch it off' : 'Filter off: tap to switch it on'}
          onClick={togglePoolFilter}
        >
          <span className="fa-solid fa-filter" aria-hidden="true" />
        </button>
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
      {filter.enabled ? <DashboardFilter /> : null}
      <div className="options-loadout-grid" role="group" aria-label="Play">
        <button type="button" className="btn-icon options-color-swatch options-loadout-btn" aria-label="Next song" onClick={skipMusic}>
          <span className="fa-solid fa-forward-step" aria-hidden="true" />
        </button>
        <button
          type="button"
          className={`btn-icon options-color-swatch options-loadout-btn${musicChannel ? ' is-active' : ''}`}
          aria-pressed={musicChannel}
          aria-label={`Music channel ${musicChannel ? 'on' : 'off'}`}
          onClick={() => setMusicChannel(!musicChannel)}
        >
          <span className="fa-solid fa-compact-disc" aria-hidden="true" />
        </button>
        <TapHoldButton
          label={`Playback ${mix}: tap to ${mix === 'playing' ? 'pause' : 'play'}${mix === 'stopped' ? '' : ', hold to stop'}`}
          active={mix === 'playing'}
          icon={mix === 'playing' ? 'fa-play' : mix === 'paused' ? 'fa-pause' : 'fa-stop'}
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
        />
        <button
          type="button"
          className={`btn-icon options-color-swatch options-loadout-btn${soundscapeChannel ? ' is-active' : ''}`}
          aria-pressed={soundscapeChannel}
          aria-label={`Soundscape channel ${soundscapeChannel ? 'on' : 'off'}`}
          onClick={() => onSoundscapeChannel(!soundscapeChannel)}
        >
          <span className="fa-solid fa-podcast" aria-hidden="true" />
        </button>
        <button
          type="button"
          className={`btn-icon options-color-swatch options-loadout-btn${schedule ? ' is-active' : ''}${scheduleHeard ? ' is-heard' : ''}`}
          aria-pressed={schedule}
          aria-label={`Schedule ${schedule ? 'on' : 'off'}${scheduleHeard ? ', playing now' : ''}`}
          onClick={onScheduleToggle}
        >
          <span className="fa-solid fa-clock" aria-hidden="true" />
        </button>
        <DockHelpButton active={help} onToggle={onHelpToggle} />
      </div>
    </div>
  )
}
