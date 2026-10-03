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
import { nativeSoundscape, type SessionState } from './backgroundAudioHost'
import { nativePlayback } from './playbackMode'
import {
  loadLook,
  loadPreferences,
  loadSchedule,
  loadScratch,
  saveLook,
  saveSchedule,
  savePreferences,
  saveScratch,
  type MobileLook,
} from './preferencesStore'
import { currentEntryId, followSession, nextScratch, sessionEntries } from './sessionEntries'
import { allPresets, sanitizeSchedule, scheduleEvents, scheduledPresetAt, type Schedule } from './schedule'
import { ScheduleGrid } from './ScheduleGrid'
import { LookButton } from './LookButton'
import { helpFor } from './helpText'
import { SoundscapeControls, SubsectionHelp } from '../../src/sidebar/SoundscapeOptions'
import { PageScrollbar } from './PageScrollbar'
import { armHold, HOLD_CONFIRM_MS } from '../../src/shared/holdTiming'
import { installSoundscapeFiles } from './soundscapeFiles'

installSoundscapeFiles()

/** How long a clip is. */
const CLIP_SECONDS = 5 * 60

const PRESETS = { light: LIGHT_FACTORY_PRESETS, dark: DARK_FACTORY_PRESETS }
const PRESET_ICONS = { light: LIGHT_PRESET_ICONS, dark: DARK_PRESET_ICONS }
const PRESET_NAMES = { light: LIGHT_PRESET_THEMES, dark: DARK_PRESET_THEMES }


/** The name a clip of the current soundscape is saved under. */
function clipName(preferences: SoundscapePreferences): string {
  const preset = [...preferences.customPresets, ...SOUNDSCAPE_FACTORY_PRESETS]
    .find((candidate) => candidate.id === preferences.activePresetId)
  return `${preset?.name ?? 'Soundscape'} - ${CLIP_SECONDS / 60} min`.replace(/[^\w .-]+/g, '')
}

export function MobileSoundscapeApp() {
  const [preferences, setPreferences] = useState<SoundscapePreferences>(loadPreferences)
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
  // The soundscape picked up for filling schedule slots (ScheduleGrid); not persisted.
  const [pickedPresetId, setPickedPresetId] = useState<string | null>(null)
  const pageScrollerRef = useRef<HTMLDivElement | null>(null)
  // HELP MODE: every subsection shows an explanation in place of its
  // controls (helpText.ts). A tap anywhere but the page's scrollbar ends it
  // and does nothing else -- the controls it would have reached are not on
  // the screen -- so its click is swallowed.
  const [helpMode, setHelpMode] = useState(false)
  // The click to swallow outlives help mode: ending it puts the controls
  // back before the tap's click arrives, so the listener that swallows it
  // cannot be one that help mode ending removes.
  const swallowHelpClickRef = useRef(false)
  useEffect(() => {
    const swallow = (event: MouseEvent) => {
      if (!swallowHelpClickRef.current) return
      swallowHelpClickRef.current = false
      event.preventDefault()
      event.stopPropagation()
    }
    // A tap that ended help mode but produced no click (it became a drag)
    // must not swallow the next one.
    const reset = () => { swallowHelpClickRef.current = false }
    window.addEventListener('click', swallow, { capture: true })
    window.addEventListener('pointerdown', reset, { capture: true })
    return () => {
      window.removeEventListener('click', swallow, { capture: true })
      window.removeEventListener('pointerdown', reset, { capture: true })
    }
  }, [])
  useEffect(() => {
    if (!helpMode) return undefined
    const end = (event: PointerEvent) => {
      if (event.target instanceof Element && event.target.closest('.mobile-scrollbar-slot')) return
      swallowHelpClickRef.current = true
      setHelpMode(false)
    }
    window.addEventListener('pointerdown', end, { capture: true })
    return () => window.removeEventListener('pointerdown', end, { capture: true })
  }, [helpMode])
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

  // Follow the media controls: when they are pressed, and on coming back to
  // the foreground, since a report made while this page was paused may not
  // have reached it.
  const scratchRef = useRef(scratch)
  scratchRef.current = scratch
  useEffect(() => {
    if (!native) return undefined
    const follow = (state: SessionState) => {
      setPreferences((current) => followSession(current, scratchRef.current, state))
      setSchedule((current) => (current.enabled === state.scheduleEnabled ? current : { ...current, enabled: state.scheduleEnabled }))
    }
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
      seconds: CLIP_SECONDS,
      name: clipName(preferences),
    })
  }

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

  // A soundscape chosen or changed by hand turns the schedule off and plays
  // on for as long as it is left.
  const preferencesRef = useRef(preferences)
  preferencesRef.current = preferences
  const handleChange = useCallback((next: SoundscapePreferences) => {
    if (next.settings !== preferencesRef.current.settings) {
      setSchedule((current) => (current.enabled ? { ...current, enabled: false } : current))
    }
    setPreferences(next)
  }, [])

  // The power button: a tap pauses whatever plays, or plays; a long press
  // turns the schedule on or off. Playing outside a scheduled run is a
  // choice by hand, so it turns the schedule off; resuming a paused run is
  // not. The click after a long press is swallowed.
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
    if (preferences.enabled) {
      setPreferences((current) => ({ ...current, enabled: false }))
      return
    }
    const now = new Date()
    if (schedule.enabled && scheduledPresetAt(events, (now.getHours() * 60) + now.getMinutes()) === null) {
      setSchedule((current) => ({ ...current, enabled: false }))
    }
    setPreferences((current) => ({ ...current, enabled: true }))
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
              <div ref={pageScrollerRef} className="options-content sidebar-options-content mode-edit thockdown-custom-scrollbar mobile-page-scroller">
                <div className="utility-setting-slider-stack" aria-label="Master controls">
                  <OptionsSubsectionLabel>Master</OptionsSubsectionLabel>
                  {helpMode ? <SubsectionHelp text={helpFor('Master')!} /> : (<>
                  <div className="options-loadout-grid" role="group" aria-label="Soundscape and display mode">
                    <button
                      type="button"
                      className={`btn-icon options-color-swatch options-loadout-btn${preferences.enabled || schedule.enabled ? ' is-active' : ''}`}
                      aria-pressed={preferences.enabled}
                      data-secondary-press="none"
                      aria-label={`${preferences.enabled ? 'Pause' : 'Play'} soundscape; hold to turn the schedule ${schedule.enabled ? 'off' : 'on'}`}
                      onClick={tapPower}
                      onPointerDown={() => {
                        swallowPowerClickRef.current = false
                        powerHoldRef.current?.()
                        powerHoldRef.current = armHold(() => {
                          powerHoldRef.current = null
                          swallowPowerClickRef.current = true
                          void toggleSchedule()
                        }, HOLD_CONFIRM_MS)
                      }}
                      onPointerUp={() => { powerHoldRef.current?.(); powerHoldRef.current = null }}
                      onPointerCancel={() => { powerHoldRef.current?.(); powerHoldRef.current = null }}
                      onPointerLeave={() => { powerHoldRef.current?.(); powerHoldRef.current = null }}
                      onContextMenu={(event) => event.preventDefault()}
                    >
                      <span className={`fa-solid ${schedule.enabled ? 'fa-clock' : 'fa-power-off'}`} aria-hidden="true" />
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
                      <span className="fa-solid fa-file-import" aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      className={`btn-icon options-color-swatch options-loadout-btn${clipProgress !== null ? ' is-active' : ''}`}
                      aria-label={clipProgress !== null
                        ? `Rendering a ${CLIP_SECONDS / 60} minute clip, ${Math.round(clipProgress * 100)}%: press to cancel`
                        : `Save a ${CLIP_SECONDS / 60} minute clip of this soundscape`}
                      aria-disabled={!native}
                      onClick={toggleClip}
                    >
                      {clipProgress !== null
                        ? <span className="mobile-clip-progress" aria-hidden="true">{Math.round(clipProgress * 100)}%</span>
                        : <span className="fa-solid fa-file-audio" aria-hidden="true" />}
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
                  {helpMode ? <SubsectionHelp text={helpFor('Schedule')!} /> : <ScheduleGrid
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
