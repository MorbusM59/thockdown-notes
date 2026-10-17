import { describe, expect, it } from 'vitest';
import { SoundscapeEngine, SOUNDSCAPE_SWITCH_SEC } from './SoundscapeEngine';
import { DEFAULT_SOUNDSCAPE_PREFERENCES, SOUNDSCAPE_FACTORY_PRESETS, applySoundscapePreset, type SoundscapePreferences } from './soundscape';

async function engineWithLog() {
  const transitions: number[] = [];
  const engine = new SoundscapeEngine();
  engine.usePlayback(async () => ({
    configure: (_configuration, transitionSec) => { transitions.push(transitionSec); },
    setVolume: () => {},
    close: () => {},
  }));
  return { engine, transitions };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function withChannel(preferences: SoundscapePreferences, enabled: boolean, activePresetId: string | null): SoundscapePreferences {
  const [first, ...rest] = preferences.settings.channels;
  return { ...preferences, activePresetId, settings: { ...preferences.settings, channels: [{ ...first, enabled }, ...rest] } };
}

describe('SoundscapeEngine: a change of soundscape against a change of settings', () => {
  const preset = SOUNDSCAPE_FACTORY_PRESETS[0];
  const start = applySoundscapePreset({ ...DEFAULT_SOUNDSCAPE_PREFERENCES, enabled: true }, preset);

  it('turning a channel off and on again is a settings change both ways, never a crossfade into a new voice', async () => {
    const { engine, transitions } = await engineWithLog();
    engine.apply(start);
    await flush();
    engine.apply(withChannel(start, false, null));
    engine.apply(withChannel(start, true, preset.id));
    expect(transitions).toEqual([0, 0, 0]);
  });

  it('choosing another preset, also after editing off one, is a transition', async () => {
    const { engine, transitions } = await engineWithLog();
    engine.apply(start);
    await flush();
    engine.apply(withChannel(start, false, null));
    engine.apply(applySoundscapePreset(start, SOUNDSCAPE_FACTORY_PRESETS[1]));
    expect(transitions).toEqual([0, 0, SOUNDSCAPE_SWITCH_SEC]);
  });
});
