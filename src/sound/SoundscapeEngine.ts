/**
 * SoundscapeEngine -- runs the soundscape by driving a PLAYBACK: something
 * that renders the finished audio ahead of time and plays it. The engine
 * only opens and closes it, sends it new settings, and sets its volume.
 *
 * Rendering is always the same code (soundscapeRenderAhead.ts: the
 * generator, src/sound/soundscape-generator.js, and the mix,
 * soundscapeMix.ts) keeping ten seconds of finished audio queued at an
 * output; where it runs is the playback's business:
 * - on desktop, in a worker, played by the player worklet into the shared
 *   output limiter where the music joins it (soundscapeWebPlayback.ts, the
 *   default);
 * - on Android, in the app's native service: a JavaScriptSandbox runs the
 *   same renderer and Android's own audio output plays it
 *   (mobile/src/nativeSoundscapePlayback.ts, installed with usePlayback).
 *   A web page's JavaScript is paused in the background; that service's is
 *   not, and neither is its audio.
 *
 * The listener's master volume and the on/off fade are the playback's,
 * applied live at its output, so they never wait on the audio already
 * rendered ahead. The soundscape's OWN volume is not: it is applied inside
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
} from '../shared/soundscape';
import { toGeneratorConfiguration } from '../shared/soundscapeDsp';
import type { ConfigureMessage } from './soundscapeRenderAhead';
import { createWebPlayback } from './soundscapeWebPlayback';

/** How long the output takes to fade out before it is closed. */
const SOUNDSCAPE_DISCONNECT_MS = 180;

/**
 * What playback looks like from the output, for diagnosing dropouts: its
 * own account of its queue and of the silence it had to play, and, where
 * the platform reports it, the audio device's.
 */
export interface SoundscapePlaybackStats {
  /** Seconds the output has played since it opened, or null where it does not say. */
  playedSec: number | null;
  /** Seconds of audio queued at the output, past what it has played. */
  queuedSec: number;
  /** Seconds the output played as silence for want of queued audio, and how many separate times. */
  outputDrySec: number;
  outputDryEvents: number;
  /**
   * The audio device's underruns: silence it played because the output did
   * not deliver in time. Null where the platform does not report them.
   */
  deviceUnderruns: number | null;
  /** How often the output had to rebuild its device stream, and the last error that made it; null where not reported. */
  outputRestarts: number | null;
  lastOutputError: number | null;
}

/** A running soundscape: a renderer and an output, wherever they are. */
export interface SoundscapePlayback {
  /** New settings for the renderer; spliced in near the playhead. */
  configure(configuration: ConfigureMessage): void;
  /** The listener's volume (0..1); the output glides to it over about `timeConstantSec`. */
  setVolume(volume: number, timeConstantSec: number): void;
  close(): void;
}

export interface SoundscapePlaybackHandlers {
  onStats(stats: SoundscapePlaybackStats): void;
  /** The playback stopped and will not play again; the engine closes it, and the next apply opens a new one. */
  onFailure(message: string): void;
}

export type SoundscapePlaybackFactory = (handlers: SoundscapePlaybackHandlers) => Promise<SoundscapePlayback>;

/** The fade on a volume change, and the faster one on the way out. */
const VOLUME_TIME_CONSTANT_SEC = 0.08;
const FADE_OUT_TIME_CONSTANT_SEC = 0.025;

type StatsListener = (stats: SoundscapePlaybackStats) => void;
type FailureListener = (failure: string) => void;


export class SoundscapeEngine {
  private playbackFactory: SoundscapePlaybackFactory = createWebPlayback;
  private playback: SoundscapePlayback | null = null;
  /**
   * The last configuration sent, serialised. Each one re-renders from near
   * the playhead, so a change that does not touch it (master volume,
   * on/off) must not send one.
   */
  private sentConfiguration: string | null = null;
  private volumeTarget = -1;
  private preferences: SoundscapePreferences | null = null;
  private starting: Promise<void> | null = null;
  private disconnectTimer: number | null = null;
  private readonly statsListeners = new Set<StatsListener>();
  private readonly failureListeners = new Set<FailureListener>();

  /** Play through `factory`'s playbacks from the next start on (the mobile app's native one). */
  usePlayback(factory: SoundscapePlaybackFactory): void {
    this.playbackFactory = factory;
  }

  /** Receive playback statistics, a few times a second while a soundscape plays. Returns the unsubscribe. */
  subscribeStats(listener: StatsListener): () => void {
    this.statsListeners.add(listener);
    return () => { this.statsListeners.delete(listener); };
  }

  /** Be told when playback failed and was torn down, with what failed. Returns the unsubscribe. */
  subscribeFailures(listener: FailureListener): () => void {
    this.failureListeners.add(listener);
    return () => { this.failureListeners.delete(listener); };
  }

  private reportFailure(failure: string): void {
    console.error(failure);
    for (const listener of this.failureListeners) listener(failure);
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
        onStats: (stats) => {
          for (const listener of this.statsListeners) listener(stats);
        },
        onFailure: (message) => {
          this.reportFailure(message);
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
      this.reportFailure(`Unable to start soundscape audio: ${String(error)}`);
    }
  }

  private update(preferences: SoundscapePreferences): void {
    const playback = this.playback;
    if (!playback) return;
    if (this.volumeTarget !== preferences.masterVolume) {
      playback.setVolume(preferences.masterVolume, VOLUME_TIME_CONSTANT_SEC);
      this.volumeTarget = preferences.masterVolume;
    }
    const configuration: ConfigureMessage = {
      type: 'configure',
      generator: { type: 'configure', ...toGeneratorConfiguration(preferences.settings) },
      space: preferences.settings.space,
    };
    const serialised = JSON.stringify(configuration);
    if (serialised !== this.sentConfiguration) {
      playback.configure(configuration);
      this.sentConfiguration = serialised;
    }
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
    this.volumeTarget = -1;
  }
}

export const soundscapeEngine = new SoundscapeEngine();
