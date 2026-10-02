/**
 * SoundscapeEngine -- runs the soundscape: a render worker that produces the
 * finished audio ahead of playback, and an OUTPUT that plays it.
 *
 * The worker (soundscapeRender.worker.ts, soundscapeRenderAhead.ts) runs the
 * generator (src/sound/soundscape-generator.js) and the mix
 * (soundscapeMix.ts: the space, the mix gain, the bus compressor) and keeps
 * ten seconds of finished stereo audio queued at the output. The output is
 * a queue of frames and a volume, and nothing more:
 * - on desktop, the player worklet into the shared output limiter, where the
 *   music joins it (soundscapeWebAudioOutput.ts, the default);
 * - on Android, the platform's own audio output in the app's native
 *   process, outside the WebView (mobile/src/nativeSoundscapeOutput.ts,
 *   installed with useOutput), so that what the WebView does with its own
 *   audio on an app switch cannot reach the queue.
 *
 * This engine starts the two, connects them over a MessageChannel, sends the
 * worker new settings, and sets the output's volume. The listener's master
 * volume and the on/off fade are the output's, applied live, so they never
 * wait on the audio already rendered ahead. The soundscape's OWN volume is
 * not: it is applied inside the generator, in the same `configure` as the
 * channels it belongs to, because a switch from one soundscape to another
 * changes both at once and must change them together.
 *
 * The output exists only while something is audible: it is opened on the
 * first audible `apply` and closed after a short fade once nothing is.
 */
import {
  isSoundscapeAudible,
  type SoundscapePreferences,
} from '../shared/soundscape';
import { toGeneratorConfiguration } from '../shared/soundscapeDsp';
import { buildNoiseLoops, noiseLoopGains, type NoiseLoops } from '../shared/soundscapeNoiseLoops';
import type { ConfigureMessage } from './soundscapeRenderAhead';
import { createWebAudioOutput } from './soundscapeWebAudioOutput';

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

/** Where the finished soundscape is played. */
export interface SoundscapeOutput {
  readonly sampleRate: number;
  /**
   * How far past its last `played` report the output may already have
   * committed audio it can no longer replace; settings changes are spliced
   * in no nearer than this (soundscapeRenderAhead.ts).
   */
  readonly spliceMarginSec: number;
  /** The worker's end of the output's channel: chunks in, `played` reports out. */
  readonly port: MessagePort;
  /** The listener's volume (0..1); the output glides to it over about `timeConstantSec`. */
  setVolume(volume: number, timeConstantSec: number): void;
  close(): void;
}

export interface SoundscapeOutputHandlers {
  onStats(stats: SoundscapePlaybackStats): void;
  /** The output stopped and will not play again; the engine closes it and builds a new one on the next apply. */
  onFailure(): void;
}

export type SoundscapeOutputFactory = (handlers: SoundscapeOutputHandlers) => Promise<SoundscapeOutput>;

/** The fade on a volume change, and the faster one on the way out. */
const VOLUME_TIME_CONSTANT_SEC = 0.08;
const FADE_OUT_TIME_CONSTANT_SEC = 0.025;

/**
 * The noise loops and their level-matching gains, per sample rate. Built
 * once on the main thread (tens of milliseconds) and copied into each
 * render worker at creation, so the generator never generates noise.
 */
const NOISE_LOOPS = new Map<number, { loops: NoiseLoops; gains: ReturnType<typeof noiseLoopGains> }>();

function noiseLoopsFor(sampleRate: number) {
  let entry = NOISE_LOOPS.get(sampleRate);
  if (!entry) {
    const loops = buildNoiseLoops(sampleRate);
    entry = { loops, gains: noiseLoopGains(loops, sampleRate) };
    NOISE_LOOPS.set(sampleRate, entry);
  }
  return entry;
}

type StatsListener = (stats: SoundscapePlaybackStats) => void;
type FailureListener = (failure: string) => void;

export class SoundscapeEngine {
  private outputFactory: SoundscapeOutputFactory = createWebAudioOutput;
  private output: SoundscapeOutput | null = null;
  private renderWorker: Worker | null = null;
  /**
   * The last configuration sent to the render worker, serialised. Each one
   * rewinds the audio rendered ahead to near the playhead and renders it
   * again, so a change that does not touch it (master volume, on/off) must
   * not send one.
   */
  private sentConfiguration: string | null = null;
  private volumeTarget = -1;
  private preferences: SoundscapePreferences | null = null;
  private starting: Promise<void> | null = null;
  private disconnectTimer: number | null = null;
  private readonly statsListeners = new Set<StatsListener>();
  private readonly failureListeners = new Set<FailureListener>();

  /** Be told when playback failed and was torn down, with what failed. Returns the unsubscribe. */
  subscribeFailures(listener: FailureListener): () => void {
    this.failureListeners.add(listener);
    return () => { this.failureListeners.delete(listener); };
  }

  private reportFailure(failure: string): void {
    console.error(failure);
    for (const listener of this.failureListeners) listener(failure);
  }

  /** Play through `factory`'s outputs from the next start on (the mobile app's native output). */
  useOutput(factory: SoundscapeOutputFactory): void {
    this.outputFactory = factory;
  }

  /** Receive playback statistics, a few times a second while a soundscape plays. Returns the unsubscribe. */
  subscribeStats(listener: StatsListener): () => void {
    this.statsListeners.add(listener);
    return () => { this.statsListeners.delete(listener); };
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
    if (this.output) {
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
    let output: SoundscapeOutput | null = null;
    try {
      output = await this.outputFactory({
        onStats: (stats) => {
          for (const listener of this.statsListeners) listener(stats);
        },
        onFailure: () => {
          this.reportFailure('Soundscape output stopped unexpectedly');
          // It does not run again, so the graph is torn down now rather
          // than after a fade: with it gone, the next apply() builds a new one.
          if (this.output === output) this.teardown();
        },
      });
      const preferences = this.preferences;
      if (!preferences || !isSoundscapeAudible(preferences)) {
        output.close();
        return;
      }
      const noise = noiseLoopsFor(output.sampleRate);
      const renderWorker = new Worker(new URL('./soundscapeRender.worker.ts', import.meta.url), { type: 'module' });
      renderWorker.postMessage({
        type: 'init',
        sampleRate: output.sampleRate,
        options: {
          seed: (Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0,
          noiseLoops: noise.loops,
          noiseGains: noise.gains,
        },
        spliceMarginSec: output.spliceMarginSec,
        output: output.port,
      }, [output.port]);
      renderWorker.onerror = (event) => {
        this.reportFailure(`Soundscape render worker stopped: ${event.message}`);
        if (this.renderWorker === renderWorker) this.teardown();
      };
      this.output = output;
      this.renderWorker = renderWorker;
      this.sentConfiguration = null;
      this.volumeTarget = -1;
      this.update(preferences);
    } catch (error) {
      output?.close();
      this.reportFailure(`Unable to start soundscape audio: ${String(error)}`);
    }
  }

  private update(preferences: SoundscapePreferences): void {
    const output = this.output;
    if (!output || !this.renderWorker) return;
    if (this.volumeTarget !== preferences.masterVolume) {
      output.setVolume(preferences.masterVolume, VOLUME_TIME_CONSTANT_SEC);
      this.volumeTarget = preferences.masterVolume;
    }
    const configuration: ConfigureMessage = {
      type: 'configure',
      generator: { type: 'configure', ...toGeneratorConfiguration(preferences.settings) },
      space: preferences.settings.space,
    };
    const serialised = JSON.stringify(configuration);
    if (serialised !== this.sentConfiguration) {
      this.renderWorker.postMessage(configuration);
      this.sentConfiguration = serialised;
    }
  }

  private fadeOutAndClose(): void {
    const output = this.output;
    if (!output) return;
    if (this.volumeTarget !== 0) {
      output.setVolume(0, FADE_OUT_TIME_CONSTANT_SEC);
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
    this.renderWorker?.terminate();
    this.renderWorker = null;
    this.output?.close();
    this.output = null;
    this.sentConfiguration = null;
    this.volumeTarget = -1;
  }
}

export const soundscapeEngine = new SoundscapeEngine();
