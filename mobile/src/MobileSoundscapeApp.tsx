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
import { SoundscapeControls } from '../../src/sidebar/SoundscapeOptions'
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
  loadScratch,
  saveLook,
  savePreferences,
  saveScratch,
  type MobileLook,
} from './preferencesStore'
import { currentEntryId, followSession, nextScratch, sessionEntries } from './sessionEntries'
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
  // Whether the native session plays (playbackMode.ts); the engine is not
  // started before that is settled, or its first start would open the web
  // playback instead.
  const [native, setNative] = useState<boolean | null>(null)
  const [clipProgress, setClipProgress] = useState<number | null>(null)

  useEffect(() => { void nativePlayback.then(setNative) }, [])

  useEffect(() => {
    savePreferences(preferences)
    setScratch((current) => nextScratch(preferences, current))
    if (native !== null) soundscapeEngine.apply(preferences)
  }, [preferences, native])

  useEffect(() => saveScratch(scratch), [scratch])

  // What the media controls step through, published whenever it changes.
  const customPresets = preferences.customPresets
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
    const follow = (state: SessionState) => setPreferences((current) => followSession(current, scratchRef.current, state))
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

  const handleChange = useCallback((next: SoundscapePreferences) => setPreferences(next), [])

  // The desktop's frame, outermost first (see shared/loadoutTheme.ts), so the
  // shared stylesheet and theme variables land where they expect to.
  return (
    <div className="app-root" style={theme.rootVariables}>
      <div className="app-saturate-wrapper" style={{ ...theme.wrapperStyle, position: 'fixed', inset: 0 }}>
        <ThemeGlazeLayers glaze={theme.glaze} radialAboveLinear={loadout.glaze.radialAboveLinear} />
        <div className="app-sheen">
          <div className={`app-shell mobile-app-shell${theme.shadowFlip ? ' shadow-flip' : ''}`} style={theme.shellVariables}>
            <div className="mobile-soundscape-shell notes-sidebar">
              <div className="options-content sidebar-options-content mode-edit">
                <div className="utility-setting-slider-stack" aria-label="Master controls">
                  <OptionsSubsectionLabel>Master</OptionsSubsectionLabel>
                  <div className="options-loadout-grid" role="group" aria-label="Soundscape and display mode">
                    <button
                      type="button"
                      className={`btn-icon options-color-swatch options-loadout-btn${preferences.enabled ? ' is-active' : ''}`}
                      aria-pressed={preferences.enabled}
                      aria-label={preferences.enabled ? 'Turn soundscape off' : 'Turn soundscape on'}
                      onClick={() => setPreferences((current) => ({ ...current, enabled: !current.enabled }))}
                    >
                      <span className="fa-solid fa-power-off" aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      className="btn-icon options-color-swatch options-loadout-btn"
                      aria-label="Export your soundscapes"
                      aria-disabled={!native || preferences.customPresets.length === 0}
                      onClick={() => {
                        if (native && preferences.customPresets.length > 0) void exportSoundscapes(preferences.customPresets, 'my-soundscapes')
                      }}
                    >
                      <span className="fa-solid fa-file-export" aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      className="btn-icon options-color-swatch options-loadout-btn"
                      aria-label="Import soundscapes"
                      aria-disabled={!native}
                      onClick={() => {
                        if (!native) return
                        void importSoundscapes(preferences).then((next) => { if (next) setPreferences(next) })
                      }}
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
                    <button
                      type="button"
                      className={`btn-icon options-color-swatch options-loadout-btn${look.mode === 'dark' ? ' is-active' : ''}`}
                      style={{ gridColumn: 6 }}
                      aria-pressed={look.mode === 'dark'}
                      aria-label="Dark mode"
                      onClick={() => setLook((current) => ({ ...current, mode: current.mode === 'dark' ? 'light' : 'dark' }))}
                    >
                      <span className="fa-solid fa-moon" aria-hidden="true" />
                    </button>
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
                  <div className="options-loadout-grid" role="group" aria-label="Visual presets">
                    {PRESETS[look.mode].map((_, index) => (
                      <button
                        key={`${look.mode}-${index}`}
                        type="button"
                        className={`btn-icon options-color-swatch options-loadout-btn${look.preset[look.mode] === index ? ' is-active' : ''}`}
                        aria-label={PRESET_NAMES[look.mode][index]}
                        aria-pressed={look.preset[look.mode] === index}
                        onClick={() => setLook((current) => ({ ...current, preset: { ...current.preset, [current.mode]: index } }))}
                      >
                        <span className={PRESET_ICONS[look.mode][index]} aria-hidden="true" />
                      </button>
                    ))}
                  </div>
                </div>
                <SoundscapeControls preferences={preferences} onChange={handleChange} />
              </div>
            </div>
          </div>
        </div>
        <ThemeBlendOverlays theme={theme} />
      </div>
    </div>
  )
}
