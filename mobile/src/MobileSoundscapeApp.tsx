/**
 * The whole mobile app: the desktop soundscape panel, plus what the desktop
 * keeps elsewhere -- the on/off switch and master volume (on the audio bar's
 * soundscape button there), export and import (the options panel's quick
 * actions there), and a clip of the current soundscape, which the desktop
 * does not have.
 *
 * As on the desktop (App.tsx), the engine follows the preferences state and
 * nothing else. The native session (backgroundAudioHost.ts) is driven by the
 * engine while this page runs; its notification and lock-screen controls
 * drive it while the page is paused, and the page FOLLOWS them through the
 * same preferences state on its return (followSession), so those controls
 * are more controls, not a second path to the engine.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CompactScrollbarSlider } from '../../src/components/CompactScrollbarSlider'
import { soundscapeConfiguration, soundscapeEngine } from '../../src/sound/SoundscapeEngine'
import { resumedOutputContext } from '../../src/sound/audioOutputBus'
import {
  SOUNDSCAPE_FACTORY_PRESETS,
  type SoundscapePreferences,
  type SoundscapeSettings,
} from '../../src/shared/soundscape'
import { exportSoundscapes, importSoundscapes } from '../../src/sidebar/soundscapeFileActions'
import {
  DARK_FACTORY_PRESETS,
  DARK_PRESET_ICONS,
  DARK_PRESET_THEMES,
  LIGHT_FACTORY_PRESETS,
  LIGHT_PRESET_ICONS,
  LIGHT_PRESET_THEMES,
} from '../../src/shared/presets'
import { OptionsSliderRows } from '../../src/sidebar/OptionsSliderRows'
import { OptionsSubsectionLabel } from '../../src/sidebar/OptionsSubsectionLabel'
import { applyDocumentTheme, themeFrame } from '../../src/shared/loadoutTheme'
import { ThemeBlendOverlays, ThemeGlazeLayers } from '../../src/components/ThemeLayers'
import { nativeSoundscape, type RegularMode, type SessionState, type SoundSource } from './backgroundAudioHost'
import { nativePlayback } from './playbackMode'
import {
  CLIP_MINUTES,
  loadClipMinutes,
  loadLook,
  loadPreferences,
  loadSchedule,
  loadScratch,
  saveClipMinutes,
  saveLook,
  saveSchedule,
  savePreferences,
  saveScratch,
  type MobileLook,
} from './preferencesStore'
import { currentEntryId, followSession, nextScratch, sessionEntries } from './sessionEntries'
import { allPresets, sanitizeSchedule, scheduleEvents, type Schedule } from './schedule'
import { ScheduleGrid } from './ScheduleGrid'
import { LookButton } from './LookButton'
import { helpFor } from './helpText'
import { SoundscapeControls, SubsectionHelp } from '../../src/sidebar/SoundscapeOptions'
import { PageScrollbar } from './PageScrollbar'
import { armHold, HOLD_CONFIRM_MS } from '../../src/shared/holdTiming'
import { installSoundscapeFiles } from './soundscapeFiles'
import { useStepDrag } from './useStepDrag'

installSoundscapeFiles()

const PRESETS = { light: LIGHT_FACTORY_PRESETS, dark: DARK_FACTORY_PRESETS }
const PRESET_ICONS = { light: LIGHT_PRESET_ICONS, dark: DARK_PRESET_ICONS }
const PRESET_NAMES = { light: LIGHT_PRESET_THEMES, dark: DARK_PRESET_THEMES }


/** A clip length as the button shows it: 5m, 1h. */
function clipLengthLabel(minutes: number): string {
  return minutes % 60 === 0 ? `${minutes / 60}h` : `${minutes}m`
}

/** The name a clip of the current soundscape is saved under. */
function clipName(preferences: SoundscapePreferences, minutes: number): string {
  const preset = [...preferences.customPresets, ...SOUNDSCAPE_FACTORY_PRESETS]
    .find((candidate) => candidate.id === preferences.activePresetId)
  return `${preset?.name ?? 'Soundscape'} - ${minutes} min`.replace(/[^\w .-]+/g, '')
}

export function MobileSoundscapeApp() {
  // Regular mode starts STOPPED: closing the app stops it (the session's
  // rule), so a stored `enabled` describes a session that no longer exists.
  // A session that outlived this page says otherwise when asked (getState).
  const [preferences, setPreferences] = useState<SoundscapePreferences>(() => ({ ...loadPreferences(), enabled: false }))
  const [regular, setRegular] = useState<RegularMode>('stopped')
  const [source, setSource] = useState<SoundSource>('none')
  // The look is one of the desktop's factory visual presets, drawn through
  // the same shared theme code the desktop uses (shared/loadoutTheme.ts).
  const [look, setLook] = useState<MobileLook>(loadLook)
  const loadout = PRESETS[look.mode][look.preset[look.mode]]
  const theme = useMemo(() => themeFrame(loadout, { reduceVisualEffects: false, isPreviewMode: false }), [loadout])

  const [scratch, setScratch] = useState<SoundscapeSettings | null>(loadScratch)
  const customPresets = preferences.customPresets
  // Whether the native session plays (playbackMode.ts); the engine is not
  // started before that is settled, or its first start would open the web
  // playback instead.
  const [native, setNative] = useState<boolean | null>(null)
  const [clipProgress, setClipProgress] = useState<number | null>(null)
  const [clipMinutes, setClipMinutes] = useState(loadClipMinutes)
  // The soundscape picked up for filling schedule slots (ScheduleGrid); not persisted.
  const [pickedPresetId, setPickedPresetId] = useState<string | null>(null)
  const pageScrollerRef = useRef<HTMLDivElement | null>(null)
  // HELP MODE: every subsection shows an explanation in place of its
  // controls (helpText.ts). Nothing on the page acts while it is up, so the
  // page scrolls under a finger like any page (`is-help`), and the system's
  // back gesture ends it (takeBack, below).
  const [helpMode, setHelpMode] = useState(false)
  // While help is up, the system's back gesture closes it rather than
  // leaving the app.
  useEffect(() => {
    if (!native || !helpMode) return undefined
    void nativeSoundscape!.takeBack({ taken: true })
    const handle = nativeSoundscape!.addListener('back', () => setHelpMode(false))
    return () => {
      void nativeSoundscape!.takeBack({ taken: false })
      void handle.then((h) => h.remove())
    }
  }, [native, helpMode])
  const help = helpMode ? helpFor : undefined
  // Pressing anything that does not act on the picked-up soundscape puts it
  // down, and the press then does what it always does. Decided on the press
  // (capture phase, before any control's own handler), so the control sees
  // the state the reader now expects.
  useEffect(() => {
    if (pickedPresetId === null) return undefined
    const putDown = (event: PointerEvent) => {
      if (event.target instanceof Element && event.target.closest('[data-pick-target]')) return
      setPickedPresetId(null)
    }
    window.addEventListener('pointerdown', putDown, { capture: true })
    return () => window.removeEventListener('pointerdown', putDown, { capture: true })
  }, [pickedPresetId])

  useEffect(() => { void nativePlayback.then(setNative) }, [])

  useEffect(() => {
    savePreferences(preferences)
    setScratch((current) => nextScratch(preferences, current))
    if (native !== null) soundscapeEngine.apply(preferences)
  }, [preferences, native])

  useEffect(() => saveScratch(scratch), [scratch])

  // The daily schedule (schedule.ts). Its events are worked out here and
  // handed to the native session, which runs them with or without this page.
  const [schedule, setSchedule] = useState<Schedule>(() => loadSchedule(preferences.customPresets))
  useEffect(() => saveSchedule(schedule), [schedule])
  // A deleted soundscape empties the slots that held it.
  useEffect(() => setSchedule((current) => sanitizeSchedule(current, customPresets)), [customPresets])
  const events = useMemo(() => scheduleEvents(schedule), [schedule])
  useEffect(() => {
    if (!native) return
    const named = new Set(events.map((event) => event.presetId))
    void nativeSoundscape!.setSchedule({
      enabled: schedule.enabled,
      masterVolume: preferences.masterVolume,
      events,
      entries: allPresets(customPresets)
        .filter((preset) => named.has(preset.id))
        .map((preset) => ({ id: preset.id, name: preset.name, configuration: JSON.stringify(soundscapeConfiguration(preset.settings)) })),
    })
  }, [native, schedule.enabled, events, customPresets, preferences.masterVolume])

  // What the media controls step through, published whenever it changes.
  const entries = useMemo(() => sessionEntries(customPresets, scratch), [customPresets, scratch])
  const currentId = currentEntryId(preferences, scratch)
  useEffect(() => {
    if (!native) return
    void nativeSoundscape!.publish({ entries, currentId, masterVolume: preferences.masterVolume })
  }, [native, entries, currentId, preferences.masterVolume])

  // Follow the session: when a media control, the schedule or the system
  // changes it, on a stop's outcome, at startup, and on coming back to the
  // foreground, since a report made while this page was paused may not have
  // reached it.
  const scratchRef = useRef(scratch)
  scratchRef.current = scratch
  const followRef = useRef<((state: SessionState) => void) | null>(null)
  useEffect(() => {
    if (!native) return undefined
    const follow = (state: SessionState) => {
      setRegular(state.regular)
      setSource(state.source)
      setPreferences((current) => followSession(current, scratchRef.current, state))
      setSchedule((current) => (current.enabled === state.scheduleEnabled ? current : { ...current, enabled: state.scheduleEnabled }))
    }
    followRef.current = follow
    void nativeSoundscape!.getState().then(follow)
    const handles = [
      nativeSoundscape!.addListener('sessionChanged', follow),
      nativeSoundscape!.addListener('clipProgress', ({ fraction }) => setClipProgress(fraction)),
      nativeSoundscape!.addListener('clipFinished', () => setClipProgress(null)),
    ]
    const catchUp = () => {
      if (document.visibilityState === 'visible') void nativeSoundscape!.getState().then(follow)
    }
    document.addEventListener('visibilitychange', catchUp)
    return () => {
      document.removeEventListener('visibilitychange', catchUp)
      for (const handle of handles) void handle.then((h) => h.remove())
    }
  }, [native])

  const toggleClip = () => {
    if (!native) return
    if (clipProgress !== null) {
      void nativeSoundscape!.cancelClip()
      return
    }
    setClipProgress(0)
    void nativeSoundscape!.renderClip({
      configuration: JSON.stringify(soundscapeConfiguration(preferences.settings)),
      seconds: clipMinutes * 60,
      name: clipName(preferences, clipMinutes),
    })
  }
  // A drag up or down on the clip button steps through the lengths,
  // stopping at either end; not while a clip is being made.
  const clipDrag = useStepDrag({
    begin: () => CLIP_MINUTES.indexOf(clipMinutes as typeof CLIP_MINUTES[number]),
    step: (base, steps) => {
      if (clipProgress !== null) return
      const minutes = CLIP_MINUTES[Math.max(0, Math.min(CLIP_MINUTES.length - 1, base + steps))]
      if (minutes === clipMinutes) return
      setClipMinutes(minutes)
      saveClipMinutes(minutes)
    },
    tap: toggleClip,
  })

  // A browser (not the native shell, which allows playback without a
  // gesture) keeps the audio context suspended until the first touch.
  useEffect(() => {
    const unlock = () => { void resumedOutputContext() }
    window.addEventListener('pointerdown', unlock, { once: true, capture: true })
    return () => window.removeEventListener('pointerdown', unlock, { capture: true })
  }, [])

  useEffect(() => {
    applyDocumentTheme(document.documentElement, loadout)
    saveLook(look)
  }, [loadout, look])

  // REGULAR MODE (see SoundscapeSession.java for how it and the schedule
  // decide what is heard). Set here for what this page does; the session's
  // own changes arrive through `follow`. PLAYING runs the engine; PAUSED and
  // STOPPED close it, and the session tells a pause from a stop.
  const setRegularMode = useCallback((mode: RegularMode) => {
    setRegular(mode)
    if (mode !== 'stopped') setSource('regular')
    setPreferences((current) => (current.enabled === (mode === 'playing') ? current : { ...current, enabled: mode === 'playing' }))
  }, [])

  // A soundscape chosen or changed in the panel is played: regular mode,
  // overruling the schedule (which a long press on the power button hands
  // back to).
  const handleChange = useCallback((next: SoundscapePreferences) => {
    setPreferences({ ...next, enabled: true })
    setRegular('playing')
    setSource('regular')
  }, [])

  // The power button: a tap plays or pauses regular mode; a long press stops
  // it, handing back to the schedule. The click after a long press is
  // swallowed.
  // The files button: a tap imports, a long press exports (with the same
  // swallowed click after it as the power button).
  const filesHoldRef = useRef<(() => void) | null>(null)
  const swallowFilesClickRef = useRef(false)
  useEffect(() => () => filesHoldRef.current?.(), [])
  const powerHoldRef = useRef<(() => void) | null>(null)
  const swallowPowerClickRef = useRef(false)
  useEffect(() => () => powerHoldRef.current?.(), [])
  const tapPower = () => {
    if (swallowPowerClickRef.current) {
      swallowPowerClickRef.current = false
      return
    }
    setRegularMode(regular === 'playing' ? 'paused' : 'playing')
  }
  const stopRegular = () => {
    if (regular === 'stopped') return
    setRegularMode('stopped')
    // What takes over is the session's to work out (the schedule's run, or
    // nothing); it answers with the outcome.
    if (native) void nativeSoundscape!.stop().then((state) => followRef.current?.(state))
  }
  const toggleSchedule = async () => {
    if (schedule.enabled) {
      setSchedule((current) => ({ ...current, enabled: false }))
      return
    }
    // The schedule needs exact alarms; without them it cannot act on time.
    if (native && !(await nativeSoundscape!.ensureExactAlarms()).granted) return
    setSchedule((current) => ({ ...current, enabled: true }))
  }

  // The desktop's frame, outermost first (see shared/loadoutTheme.ts), so the
  // shared stylesheet and theme variables land where they expect to.
  return (
    <div className="app-root" style={theme.rootVariables}>
      <div className="app-saturate-wrapper" style={{ ...theme.wrapperStyle, position: 'fixed', inset: 0 }}>
        <ThemeGlazeLayers glaze={theme.glaze} radialAboveLinear={loadout.glaze.radialAboveLinear} />
        <div className="app-sheen">
          <div className={`app-shell mobile-app-shell${theme.shadowFlip ? ' shadow-flip' : ''}`} style={theme.shellVariables}>
            <div className="mobile-page">
            <div className="mobile-soundscape-shell notes-sidebar">
              <div ref={pageScrollerRef} className={`options-content sidebar-options-content mode-edit thockdown-custom-scrollbar mobile-page-scroller${helpMode ? ' is-help' : ''}`}>
                <div className="utility-setting-slider-stack" aria-label="Master controls">
                  <OptionsSubsectionLabel>Master</OptionsSubsectionLabel>
                  {helpMode ? <SubsectionHelp paragraphs={helpFor('Master')!} /> : (<>
                  <div className="options-loadout-grid" role="group" aria-label="Soundscape and display mode">
                    <button
                      type="button"
                      className={`btn-icon options-color-swatch options-loadout-btn${regular !== 'stopped' ? ' is-active' : ''}`}
                      aria-pressed={regular !== 'stopped'}
                      data-secondary-press="none"
                      aria-label={`Soundscape ${regular}: tap to ${regular === 'playing' ? 'pause' : 'play'}${regular === 'stopped' ? '' : ', hold to stop'}`}
                      onClick={tapPower}
                      onPointerDown={() => {
                        swallowPowerClickRef.current = false
                        powerHoldRef.current?.()
                        powerHoldRef.current = armHold(() => {
                          powerHoldRef.current = null
                          swallowPowerClickRef.current = true
                          stopRegular()
                        }, HOLD_CONFIRM_MS)
                      }}
                      onPointerUp={() => { powerHoldRef.current?.(); powerHoldRef.current = null }}
                      onPointerCancel={() => { powerHoldRef.current?.(); powerHoldRef.current = null }}
                      onPointerLeave={() => { powerHoldRef.current?.(); powerHoldRef.current = null }}
                      onContextMenu={(event) => event.preventDefault()}
                    >
                      {/* The state it is in, not the one a press goes to. */}
                      <span className={`fa-solid ${regular === 'playing' ? 'fa-play' : regular === 'paused' ? 'fa-pause' : 'fa-stop'}`} aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      className={`btn-icon options-color-swatch options-loadout-btn${schedule.enabled ? ' is-active' : ''}${source === 'schedule' ? ' is-heard' : ''}`}
                      aria-pressed={schedule.enabled}
                      aria-label={`Schedule ${schedule.enabled ? 'on' : 'off'}${source === 'schedule' ? ', playing now' : ''}`}
                      onClick={() => { void toggleSchedule() }}
                    >
                      <span className="fa-solid fa-clock" aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      className={`btn-icon options-color-swatch options-loadout-btn${helpMode ? ' is-active' : ''}`}
                      aria-pressed={helpMode}
                      aria-label="Help: explain the controls"
                      onClick={() => setHelpMode(true)}
                    >
                      <span className="fa-solid fa-circle-question" aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      className="btn-icon options-color-swatch options-loadout-btn"
                      aria-label="Import soundscapes; hold to export yours"
                      aria-disabled={!native}
                      data-secondary-press="none"
                      onClick={() => {
                        if (swallowFilesClickRef.current) {
                          swallowFilesClickRef.current = false
                          return
                        }
                        if (!native) return
                        void importSoundscapes(preferences).then((next) => { if (next) setPreferences(next) })
                      }}
                      onPointerDown={() => {
                        swallowFilesClickRef.current = false
                        filesHoldRef.current?.()
                        filesHoldRef.current = armHold(() => {
                          filesHoldRef.current = null
                          swallowFilesClickRef.current = true
                          if (native && preferences.customPresets.length > 0) void exportSoundscapes(preferences.customPresets, 'my-soundscapes')
                        }, HOLD_CONFIRM_MS)
                      }}
                      onPointerUp={() => { filesHoldRef.current?.(); filesHoldRef.current = null }}
                      onPointerCancel={() => { filesHoldRef.current?.(); filesHoldRef.current = null }}
                      onPointerLeave={() => { filesHoldRef.current?.(); filesHoldRef.current = null }}
                      onContextMenu={(event) => event.preventDefault()}
                    >
                      <span className="fa-solid fa-rotate" aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      className={`btn-icon options-color-swatch options-loadout-btn${clipProgress !== null ? ' is-active' : ''}`}
                      aria-label={clipProgress !== null
                        ? `Rendering a ${clipMinutes} minute clip, ${Math.round(clipProgress * 100)}%: press to cancel`
                        : `Save a ${clipMinutes} minute clip of this soundscape; drag up or down to change its length`}
                      aria-disabled={!native}
                      data-secondary-press="none"
                      {...clipDrag.handlers}
                    >
                      {clipProgress !== null
                        ? <span className="mobile-clip-progress" aria-hidden="true">{Math.round(clipProgress * 100)}%</span>
                        : clipDrag.adjusting
                          ? <span className="mobile-clip-progress" aria-hidden="true">{clipLengthLabel(clipMinutes)}</span>
                          : <span className="fa-solid fa-circle-down" aria-hidden="true" />}
                    </button>
                    <LookButton
                      look={look}
                      presetCount={PRESETS[look.mode].length}
                      icon={PRESET_ICONS[look.mode][look.preset[look.mode]]}
                      presetName={PRESET_NAMES[look.mode][look.preset[look.mode]]}
                      onChange={setLook}
                    />
                  </div>
                  <OptionsSliderRows>
                    <CompactScrollbarSlider
                      id="mobile-soundscape-master-volume"
                      value={Math.round(preferences.masterVolume * 100)}
                      min={0}
                      max={100}
                      step={1}
                      trackLabel="volume"
                      ariaLabel="Soundscape volume"
                      formatValue={(value) => `${value}%`}
                      onCommit={(value) => setPreferences((current) => ({ ...current, masterVolume: value / 100 }))}
                    />
                  </OptionsSliderRows>
                  </>)}
                </div>
                <div className="utility-setting-slider-stack" aria-label="Schedule">
                  <OptionsSubsectionLabel>Schedule</OptionsSubsectionLabel>
                  {helpMode ? <SubsectionHelp paragraphs={helpFor('Schedule')!} /> : <ScheduleGrid
                    schedule={schedule}
                    customPresets={customPresets}
                    pickedPresetId={pickedPresetId}
                    onChange={setSchedule}
                  />}
                </div>
                <SoundscapeControls
                  preferences={preferences}
                  onChange={handleChange}
                  pickedPresetId={pickedPresetId}
                  onPickPreset={setPickedPresetId}
                  help={help}
                />
              </div>
            </div>
            <PageScrollbar scrollerRef={pageScrollerRef} />
            </div>
          </div>
        </div>
        <ThemeBlendOverlays theme={theme} />
      </div>
    </div>
  )
}
