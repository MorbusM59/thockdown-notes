/**
 * The whole mobile app: the desktop soundscape panel, plus the two controls
 * the desktop keeps elsewhere (the on/off switch and master volume live on the
 * audio bar's soundscape button there).
 *
 * As on the desktop (App.tsx), the engine follows the preferences state and
 * nothing else, and so does the background-playback session: both are
 * derived from the same state in one effect, so the notification can never
 * say a soundscape is playing when the engine has stopped, or the reverse.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { SoundscapeControls } from '../../src/sidebar/SoundscapeOptions'
import { CompactScrollbarSlider } from '../../src/components/CompactScrollbarSlider'
import { soundscapeEngine } from '../../src/sound/SoundscapeEngine'
import { resumedOutputContext } from '../../src/sound/audioOutputBus'
import {
  SOUNDSCAPE_FACTORY_PRESETS,
  isSoundscapeAudible,
  type SoundscapePreferences,
} from '../../src/shared/soundscape'
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
import { backgroundAudioHost } from './backgroundAudioHost'
import { PlaybackDiagnostics } from './PlaybackDiagnostics'
// Chooses the native playback where the device supports it.
import './playbackMode'
import { loadLook, loadPreferences, saveLook, savePreferences, type MobileLook } from './preferencesStore'

const PRESETS = { light: LIGHT_FACTORY_PRESETS, dark: DARK_FACTORY_PRESETS }
const PRESET_ICONS = { light: LIGHT_PRESET_ICONS, dark: DARK_PRESET_ICONS }
const PRESET_NAMES = { light: LIGHT_PRESET_THEMES, dark: DARK_PRESET_THEMES }


function sessionTitle(preferences: SoundscapePreferences): string {
  const preset = [...preferences.customPresets, ...SOUNDSCAPE_FACTORY_PRESETS]
    .find((candidate) => candidate.id === preferences.activePresetId)
  return preset?.name ?? 'Custom soundscape'
}

export function MobileSoundscapeApp() {
  const [preferences, setPreferences] = useState<SoundscapePreferences>(loadPreferences)
  // The look is one of the desktop's factory visual presets, drawn through
  // the same shared theme code the desktop uses (shared/loadoutTheme.ts).
  const [look, setLook] = useState<MobileLook>(loadLook)
  const loadout = PRESETS[look.mode][look.preset[look.mode]]
  const theme = useMemo(() => themeFrame(loadout, { reduceVisualEffects: false, isPreviewMode: false }), [loadout])

  useEffect(() => {
    soundscapeEngine.apply(preferences)
    savePreferences(preferences)
    if (isSoundscapeAudible(preferences)) void backgroundAudioHost.start({ title: sessionTitle(preferences) })
    else void backgroundAudioHost.stop()
  }, [preferences])

  // The notification's stop control turns the soundscape off through the
  // same state every other control writes, so it is one more control, not a
  // second path to the engine.
  useEffect(() => {
    const handle = backgroundAudioHost.addListener('stopRequested', () => {
      setPreferences((current) => ({ ...current, enabled: false }))
    })
    return () => { void handle.then((h) => h.remove()) }
  }, [])

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
                <PlaybackDiagnostics />
              </div>
            </div>
          </div>
        </div>
        <ThemeBlendOverlays theme={theme} />
      </div>
    </div>
  )
}
