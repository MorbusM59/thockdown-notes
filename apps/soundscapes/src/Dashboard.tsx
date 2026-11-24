/**
 * THE DASHBOARD, the phone's first tab: where what plays is PICKED. The other
 * tabs create and edit the choices (sets, soundscapes, schedules,
 * soundstages); here each is one grid of the choices, a tap making one the
 * active one. Its dock (DashboardDock) holds the transport and the volumes.
 *
 * The phone has no right press, so the desktop music bar's right-click skip
 * is a HOLD on the music button here, as a hold stops the soundscape.
 */
import { useEffect, useRef, useSyncExternalStore } from 'react'
import { OptionsSubsectionLabel } from '@thockdown/interaction/OptionsSubsectionLabel'
import { OptionsSliderRows } from '@thockdown/interaction/OptionsSliderRows'
import { CompactScrollbarSlider } from '@thockdown/interaction/CompactScrollbarSlider'
import { armHold, HOLD_CONFIRM_MS } from '@thockdown/interaction/holdTiming'
import { SetMark } from '@thockdown/visualizer/library/MusicSetRow'
import { pressMusicSet } from '@thockdown/visualizer/sound/setPress'
import { readNowPlaying, subscribeNowPlaying } from '@thockdown/visualizer/sound/nowPlaying'
import { SoundscapeMark } from '@thockdown/soundscape/SoundscapeOptions'
import { orderedSoundscapePresets, type SoundscapePreferences, type SoundscapePreset } from '@thockdown/soundscape/soundscape'
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

/**
 * The dashboard's dock: the music and the soundscape, each a button showing
 * its state (a tap plays or pauses; a hold skips the song, or stops the
 * soundscape and hands back to the schedule), and the schedule's switch;
 * then their two volumes.
 */
export function DashboardDock({ soundscape, onSoundscapeTap, onSoundscapeHold, soundscapeVolume, onSoundscapeVolume, schedule, scheduleHeard, onScheduleToggle }: {
  /** The schedule is on; it plays now (it is what is heard). */
  schedule: boolean
  scheduleHeard: boolean
  onScheduleToggle: () => void
  soundscape: 'playing' | 'paused' | 'stopped'
  onSoundscapeTap: () => void
  onSoundscapeHold: () => void
  soundscapeVolume: number
  onSoundscapeVolume: (volume: number) => void
}) {
  const musicPlaying = useSyncExternalStore(subscribeMusicPlaying, readMusicPlaying)
  const nowPlaying = useSyncExternalStore(subscribeNowPlaying, readNowPlaying)
  return (
    <div className="mobile-dashboard-dock">
      <div className="options-loadout-grid" role="group" aria-label="Play">
        <TapHoldButton
          label={`Music ${musicPlaying ? 'playing' : 'paused'}: tap to ${musicPlaying ? 'pause' : 'play'}, hold for the next song`}
          active={musicPlaying}
          icon={musicPlaying ? 'fa-music' : 'fa-pause'}
          onTap={toggleMusic}
          onHold={skipMusic}
        />
        <TapHoldButton
          label={`Soundscape ${soundscape}: tap to ${soundscape === 'playing' ? 'pause' : 'play'}${soundscape === 'stopped' ? '' : ', hold to stop'}`}
          active={soundscape === 'playing'}
          icon={soundscape === 'playing' ? 'fa-podcast' : soundscape === 'paused' ? 'fa-pause' : 'fa-stop'}
          className=" mobile-dock-soundscape"
          onTap={onSoundscapeTap}
          onHold={onSoundscapeHold}
        />
        <button
          type="button"
          className={`btn-icon options-color-swatch options-loadout-btn mobile-dock-schedule${schedule ? ' is-active' : ''}${scheduleHeard ? ' is-heard' : ''}`}
          aria-pressed={schedule}
          aria-label={`Schedule ${schedule ? 'on' : 'off'}${scheduleHeard ? ', playing now' : ''}`}
          onClick={onScheduleToggle}
        >
          <span className="fa-solid fa-clock" aria-hidden="true" />
        </button>
      </div>
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
    </div>
  )
}
