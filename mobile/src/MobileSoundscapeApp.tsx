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
import { useCallback, useEffect, useState } from 'react'
import { SoundscapeControls } from '../../src/sidebar/SoundscapeOptions'
import { CompactScrollbarSlider } from '../../src/components/CompactScrollbarSlider'
import { soundscapeEngine } from '../../src/sound/SoundscapeEngine'
import { resumedOutputContext } from '../../src/sound/audioOutputBus'
import {
  SOUNDSCAPE_FACTORY_PRESETS,
  isSoundscapeAudible,
  type SoundscapePreferences,
} from '../../src/shared/soundscape'
import { backgroundAudioHost } from './backgroundAudioHost'
import { loadPreferences, savePreferences } from './preferencesStore'

function sessionTitle(preferences: SoundscapePreferences): string {
  const preset = [...preferences.customPresets, ...SOUNDSCAPE_FACTORY_PRESETS]
    .find((candidate) => candidate.id === preferences.activePresetId)
  return preset?.name ?? 'Custom soundscape'
}

export function MobileSoundscapeApp() {
  const [preferences, setPreferences] = useState<SoundscapePreferences>(loadPreferences)

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

  const handleChange = useCallback((next: SoundscapePreferences) => setPreferences(next), [])

  return (
    <div className="mobile-soundscape-shell notes-sidebar">
      <div className="mobile-soundscape-master">
        <button
          type="button"
          className={`btn-icon${preferences.enabled ? ' is-active' : ''}`}
          aria-pressed={preferences.enabled}
          aria-label={preferences.enabled ? 'Turn soundscape off' : 'Turn soundscape on'}
          onClick={() => setPreferences((current) => ({ ...current, enabled: !current.enabled }))}
        >
          <span className="fa-solid fa-power-off" aria-hidden="true" />
        </button>
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
      </div>
      <div className="options-content sidebar-options-content mode-edit">
        <SoundscapeControls preferences={preferences} onChange={handleChange} />
      </div>
    </div>
  )
}
