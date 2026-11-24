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
import { OptionsSliderRows } from '@thockdown/interaction/OptionsSliderRows'
import { CompactScrollbarSlider } from '@thockdown/interaction/CompactScrollbarSlider'
import { armHold, HOLD_CONFIRM_MS } from '@thockdown/interaction/holdTiming'
import { SetMark } from '@thockdown/visualizer/library/MusicSetRow'
import { pressMusicSet } from '@thockdown/visualizer/sound/setPress'
import { readNowPlaying, subscribeNowPlaying } from '@thockdown/visualizer/sound/nowPlaying'
import { SoundscapeMark } from '@thockdown/soundscape/SoundscapeOptions'
import { orderedSoundscapePresets, type SoundscapePreferences, type SoundscapePreset } from '@thockdown/soundscape/soundscape'
import { FieldActionButton } from '@thockdown/interaction/FieldActionButton'
import { EMPTY_POOL_FILTER } from '@thockdown/visualizer/shared/audioPlayer'
import { commitPoolFilterDraft, readShownPoolFilter, setPoolFilterDraft, setPoolFilterQuery, subscribePoolFilterDraft, togglePoolFilter } from '@thockdown/visualizer/visualizer/poolFilterDraft'
import { readMusicPlaying, skipMusic, subscribeMusicPlaying, toggleMusic } from './mobileMusicPlayer'

/** The music sets: a tap puts a set in the pool or takes it out, a hold plays it alone (setPress.ts, as everywhere). */
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
              aria-label={`${set.name}, ${isActive ? 'in the pool' : 'not in the pool'}: tap to toggle, hold to play it alone`}
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

/** The soundscapes: a tap plays one. */
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
function TapHoldButton({ label, active, icon, onTap, onHold, className = '' }: { label: string; active: boolean; icon: string; onTap: () => void; onHold: () => void; className?: string }) {
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
      className={`btn-icon options-color-swatch options-loadout-btn${active ? ' is-active' : ''}${className}`}
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
    <div className="options-loadout-grid mobile-dashboard-filter" role="group" aria-label="Filter songs">
      <input
        ref={inputRef}
        className="options-curve-cell options-curve-field mobile-dashboard-filter-field"
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
        className="btn-icon options-color-swatch options-loadout-btn"
        icon="fa-filter"
        submitLabel="Filter"
        isFieldFocused={isFocused}
        hasValue={filter.query !== ''}
        onSubmit={() => inputRef.current?.blur()}
        onClear={() => {
          setPoolFilterDraft(EMPTY_POOL_FILTER)
          commitPoolFilterDraft()
        }}
      />
    </div>
  )
}

/**
 * The dashboard's dock: the two volumes, the pool filter while it is on, and
 * the button row: the filter's switch, skip, the music, the soundscape (a
 * tap plays or pauses, a hold stops it and hands back to the schedule), the
 * schedule's switch, and help.
 */
export function DashboardDock({ soundscape, onSoundscapeTap, onSoundscapeHold, soundscapeVolume, onSoundscapeVolume, schedule, scheduleHeard, onScheduleToggle, help, onHelpToggle }: {
  /** The schedule is on; it plays now (it is what is heard). */
  schedule: boolean
  scheduleHeard: boolean
  onScheduleToggle: () => void
  soundscape: 'playing' | 'paused' | 'stopped'
  onSoundscapeTap: () => void
  onSoundscapeHold: () => void
  soundscapeVolume: number
  onSoundscapeVolume: (volume: number) => void
  help: boolean
  onHelpToggle: () => void
}) {
  const musicPlaying = useSyncExternalStore(subscribeMusicPlaying, readMusicPlaying)
  const nowPlaying = useSyncExternalStore(subscribeNowPlaying, readNowPlaying)
  const filter = useSyncExternalStore(subscribePoolFilterDraft, readShownPoolFilter)
  return (
    <div className="mobile-dashboard-dock">
      <OptionsSliderRows>
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
      </OptionsSliderRows>
      {filter.enabled ? <DashboardFilter /> : null}
      <div className="options-loadout-grid" role="group" aria-label="Play">
        <button
          type="button"
          className={`btn-icon options-color-swatch options-loadout-btn${filter.enabled ? ' is-active' : ''}`}
          aria-pressed={filter.enabled}
          aria-label={filter.enabled ? 'Filter on: tap to switch it off' : 'Filter off: tap to switch it on'}
          onClick={togglePoolFilter}
        >
          <span className="fa-solid fa-filter" aria-hidden="true" />
        </button>
        <button type="button" className="btn-icon options-color-swatch options-loadout-btn" aria-label="Next song" onClick={skipMusic}>
          <span className="fa-solid fa-forward-step" aria-hidden="true" />
        </button>
        <button
          type="button"
          className={`btn-icon options-color-swatch options-loadout-btn${musicPlaying ? ' is-active' : ''}`}
          aria-pressed={musicPlaying}
          aria-label={`Music ${musicPlaying ? 'playing: tap to pause' : 'paused: tap to play'}`}
          onClick={toggleMusic}
        >
          <span className="fa-solid fa-compact-disc" aria-hidden="true" />
        </button>
        <TapHoldButton
          label={`Soundscape ${soundscape}: tap to ${soundscape === 'playing' ? 'pause' : 'play'}${soundscape === 'stopped' ? '' : ', hold to stop'}`}
          active={soundscape === 'playing'}
          icon="fa-podcast"
          onTap={onSoundscapeTap}
          onHold={onSoundscapeHold}
        />
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
