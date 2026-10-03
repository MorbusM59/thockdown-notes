/**
 * SoundscapeEngine -- runs the soundscape by driving a PLAYBACK. The engine
 * only opens and closes it, sends it new settings (with whether they are a
 * change of soundscape, to be crossfaded), and sets its volume. The sound
 * itself is shared by every playback: the generator
 * (src/sound/soundscape-generator.js) and the mix's settings
 * (soundscapeMix.ts, soundscapeSpace.ts). Where and how it is played is the
 * playback's business:
 * - on desktop, LIVE (soundscapeLivePlayback.ts, the default): the generator
 *   as an AudioWorklet and the browser's own nodes for the mix, so a slider
 *   is heard at the next audio block;
 * - on Android, rendered AHEAD in the app's native service: a
 *   JavaScriptSandbox runs the renderer (soundscapeRenderAhead.ts) and
 *   Android's own audio output plays it (mobile/src/nativeSoundscapePlayback.ts,
 *   installed with usePlayback). A web page's JavaScript is paused in the
 *   background and its audio stalls on an app switch; that service's is not
 *   and does not.
 *
 * The listener's master volume and the on/off fade are the playback's,
 * applied at its output, so they never wait on audio rendered ahead. The
 * soundscape's OWN volume is not: it is applied inside
 * the generator, in the same configuration as the channels it belongs to,
 * because a switch from one soundscape to another changes both at once and
 * must change them together.
 *
 * The playback exists only while something is audible: it is opened on the
 * first audible `apply` and closed after a short fade once nothing is.
 */
import {
  isSoundscapeAudible,
  type SoundscapePreferences,
  type SoundscapeSettings,
} from '../shared/soundscape';
import { toGeneratorConfiguration } from '../shared/soundscapeDsp';
import type { ConfigureMessage } from './soundscapeRenderAhead';
import { createLivePlayback } from './soundscapeLivePlayback';

/** How long the output takes to fade out before it is closed. */
const SOUNDSCAPE_DISCONNECT_MS = 180;

/** A running soundscape: a renderer and an output, wherever they are. */
export interface SoundscapePlayback {
  /**
   * New settings for the renderer, spliced in near the playhead: with
   * `transitionSec` 0 a settings change (a short crossfade within one
   * soundscape), otherwise a change of soundscape crossfaded over that long.
   */
  configure(configuration: ConfigureMessage, transitionSec: number): void;
  /** The listener's volume (0..1); the output glides to it over about `timeConstantSec`. */
  setVolume(volume: number, timeConstantSec: number): void;
  close(): void;
}

export interface SoundscapePlaybackHandlers {
  /** The playback stopped and will not play again; the engine closes it, and the next apply opens a new one. */
  onFailure(message: string): void;
}

export type SoundscapePlaybackFactory = (handlers: SoundscapePlaybackHandlers) => Promise<SoundscapePlayback>;

/**
 * The renderer's configuration for `settings`, exactly as the engine sends
 * it. Exported so the mobile app can hand the native session the same
 * configuration for each soundscape its media controls step to: the native
 * renderer skips a configuration identical to the one in force, so the
 * engine's own send that follows does not re-render it.
 */
export function soundscapeConfiguration(settings: SoundscapeSettings): ConfigureMessage {
  return {
    type: 'configure',
    generator: { type: 'configure', ...toGeneratorConfiguration(settings) },
    space: settings.space,
  };
}

/** The fade on a volume change, and the faster one on the way out. */
const VOLUME_TIME_CONSTANT_SEC = 0.08;
const FADE_OUT_TIME_CONSTANT_SEC = 0.025;
/**
 * A change of SOUNDSCAPE (another one chosen) crossfades at least this
 * long, where a settings change within one is a splice of a few
 * milliseconds. Longer fades (the mobile app's schedule) are the session's.
 */
export const SOUNDSCAPE_SWITCH_SEC = 2;

export class SoundscapeEngine {
  private playbackFactory: SoundscapePlaybackFactory = createLivePlayback;
  private playback: SoundscapePlayback | null = null;
  /**
   * The last configuration sent, serialised. Rendered ahead (Android), each
   * one re-renders from near the playhead, so a change that does not touch
   * it (master volume, on/off) must not send one.
   */
  private sentConfiguration: string | null = null;
  /** The soundscape the sent configuration was chosen as: another one is a change of soundscape, not of settings. */
  private sentPresetId: string | null = null;
  private volumeTarget = -1;
  private preferences: SoundscapePreferences | null = null;
  private starting: Promise<void> | null = null;
  private disconnectTimer: number | null = null;

  /** Play through `factory`'s playbacks from the next start on (the mobile app's native one). */
  usePlayback(factory: SoundscapePlaybackFactory): void {
    this.playbackFactory = factory;
  }

  apply(preferences: SoundscapePreferences): void {
    this.preferences = preferences;
    if (!isSoundscapeAudible(preferences)) {
      this.fadeOutAndClose();
      return;
    }
    if (this.disconnectTimer !== null) {
      window.clearTimeout(this.disconnectTimer);
      this.disconnectTimer = null;
    }
    if (this.playback) {
      this.update(preferences);
      return;
    }
    if (!this.starting) {
      this.starting = this.start().finally(() => {
        this.starting = null;
      });
    }
  }

  private async start(): Promise<void> {
    let playback: SoundscapePlayback | null = null;
    try {
      playback = await this.playbackFactory({
        onFailure: (message) => {
          console.error(message);
          // It does not play again, so it is torn down now rather than after
          // a fade: with it gone, the next apply() opens a new one.
          if (this.playback === playback) this.teardown();
        },
      });
      const preferences = this.preferences;
      if (!preferences || !isSoundscapeAudible(preferences)) {
        playback.close();
        return;
      }
      this.playback = playback;
      this.sentConfiguration = null;
      this.volumeTarget = -1;
      this.update(preferences);
    } catch (error) {
      playback?.close();
      console.error(`Unable to start soundscape audio: ${String(error)}`);
    }
  }

  private update(preferences: SoundscapePreferences): void {
    const playback = this.playback;
    if (!playback) return;
    if (this.volumeTarget !== preferences.masterVolume) {
      playback.setVolume(preferences.masterVolume, VOLUME_TIME_CONSTANT_SEC);
      this.volumeTarget = preferences.masterVolume;
    }
    const configuration = soundscapeConfiguration(preferences.settings);
    const serialised = JSON.stringify(configuration);
    if (serialised !== this.sentConfiguration) {
      // The first configuration of a playback starts it (its fade-in is
      // the output's); after that, choosing another soundscape is a
      // transition, and anything else a settings change.
      const switching = this.sentConfiguration !== null
        && preferences.activePresetId !== null
        && preferences.activePresetId !== this.sentPresetId;
      playback.configure(configuration, switching ? SOUNDSCAPE_SWITCH_SEC : 0);
      this.sentConfiguration = serialised;
    }
    this.sentPresetId = preferences.activePresetId;
  }

  private fadeOutAndClose(): void {
    const playback = this.playback;
    if (!playback) return;
    if (this.volumeTarget !== 0) {
      playback.setVolume(0, FADE_OUT_TIME_CONSTANT_SEC);
      this.volumeTarget = 0;
    }
    if (this.disconnectTimer !== null) window.clearTimeout(this.disconnectTimer);
    this.disconnectTimer = window.setTimeout(() => {
      this.disconnectTimer = null;
      const latest = this.preferences;
      if (latest && isSoundscapeAudible(latest)) return;
      this.teardown();
    }, SOUNDSCAPE_DISCONNECT_MS);
  }

  private teardown(): void {
    if (this.disconnectTimer !== null) window.clearTimeout(this.disconnectTimer);
    this.disconnectTimer = null;
    this.playback?.close();
    this.playback = null;
    this.sentConfiguration = null;
    this.sentPresetId = null;
    this.volumeTarget = -1;
  }
}

export const soundscapeEngine = new SoundscapeEngine();
