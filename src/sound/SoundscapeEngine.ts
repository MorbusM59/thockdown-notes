/**
 * SoundscapeEngine -- the Web Audio graph around the soundscape player.
 *
 * The soundscape is synthesised AHEAD of playback by the generator
 * (src/sound/soundscape-generator.js) running in a worker
 * (soundscapeRender.worker.ts, soundscapeRenderAhead.ts), which keeps up to
 * ten seconds of finished audio queued at the player worklet
 * (public/soundscape-player.js). The audio thread then only copies samples,
 * so a stall of the CPU from another app is covered by that lead instead of
 * by one output buffer. Worker and player talk over their own MessageChannel;
 * this engine only starts them, sends settings to the worker, and builds the
 * graph after the player:
 *
 *   player output 0 (every layer's direct sound, stereo) -------------> mixGain
 *   player output 1 (every layer's send to the space, stereo) -> space -> mixGain
 *   mixGain -> busLimiter -> the shared output limiter (audioOutputBus.ts)
 *
 * Every layer is placed -- its distance, its direct and send gains -- inside
 * the generator, by one rule; this graph only carries the two buses. The SPACE
 * is a convolution with the soundscape's own impulse response
 * (src/shared/soundscapeSpace.ts). It is two convolvers crossfaded: a changed
 * space is built into whichever is silent and faded in over the other, since
 * swapping a playing convolver's buffer is heard as a click.
 *
 * `busLimiter` is a gentle safety net ahead of the limiter the music shares:
 * a soundscape is meant to be kept out of it by its own volume (see
 * SOUNDSCAPE_MIX_GAIN), and what does reach it is turned down softly rather
 * than making the music's hard limiter pump.
 *
 * The graph exists only while something is audible: it is built on the
 * first audible `apply` and torn down after a short fade once nothing is.
 * `mixGain` carries both the fade and the listener's master volume. The
 * soundscape's OWN volume is not on it: that is applied inside the generator,
 * in the same `configure` as the channels it belongs to, because a switch
 * from one soundscape to another changes both at once and two separately
 * timed paths (a message to the generator, a glide on an AudioParam) play
 * the new channels at the old soundscape's level until the glide catches up.
 */
import {
  isSoundscapeAudible,
  type SoundscapePreferences,
  type SoundscapeSpaceSettings,
} from '../shared/soundscape';
import { toGeneratorConfiguration } from '../shared/soundscapeDsp';
import { buildNoiseLoops, noiseLoopGains, type NoiseLoops } from '../shared/soundscapeNoiseLoops';
import { buildSoundscapeImpulseResponse } from '../shared/soundscapeSpace';
import { connectToOutput, resumedOutputContext } from './audioOutputBus';

/**
 * Mix level at master volume 1 and a soundscape volume of 1.
 *
 * Keeping a soundscape out of the compressor is the soundscape's own volume
 * (SoundscapeSettings.volume), applied in the generator ahead of busLimiter and set per
 * soundscape: a natural environment has no compression, and a compressor
 * working on a soundscape is heard as every layer ducking whenever one of
 * them peaks. Measured through the real chain in an OfflineAudioContext (42 s
 * per seed), at this gain Thunderstorm peaked at +7.3 dBFS and was compressed
 * 71-87% of the time; the knee begins at -14 dBFS, so it needs roughly
 * -24 dB of its own volume to stay clear of it.
 */
const SOUNDSCAPE_MIX_GAIN = 0.5;
/** The space's return at `amount` 1. */
const SOUNDSCAPE_SPACE_RETURN = 1.2;
const SOUNDSCAPE_FADE_SEC = 0.08;
const SOUNDSCAPE_DISCONNECT_MS = 180;
/** How long a new space takes to fade in over the old, and how long a slider must rest before one is built. */
const SPACE_CROSSFADE_SEC = 0.35;
const SPACE_REBUILD_DELAY_MS = 120;

const WORKLET_MODULES = new WeakMap<AudioContext, Promise<void>>();

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

/**
 * What playback looks like from both sides of the output, for diagnosing
 * dropouts: the player's own account (soundscape-player.js's statistics)
 * and, where the browser reports it, the output device's.
 */
export interface SoundscapePlaybackStats {
  /** Seconds of audio queued at the player for the playing generation. */
  queuedSec: number;
  /** Seconds the player played as silence for want of queued audio, and how many separate times. */
  playerDrySec: number;
  playerDryEvents: number;
  /**
   * The output device's underruns since the context started: silence it
   * played because the audio context delivered nothing in time. Null where
   * the browser does not report them (AudioContext.playbackStats is
   * experimental).
   */
  outputUnderrunSec: number | null;
  outputUnderrunEvents: number | null;
}

type StatsListener = (stats: SoundscapePlaybackStats) => void;

function outputUnderruns(context: AudioContext): { sec: number; events: number } | null {
  const stats = (context as AudioContext & { playbackStats?: { underrunDuration?: number; underrunEvents?: number } }).playbackStats;
  if (!stats || typeof stats.underrunEvents !== 'number') return null;
  return { sec: stats.underrunDuration ?? 0, events: stats.underrunEvents };
}

function spaceKey(space: SoundscapeSpaceSettings): string {
  return [space.size, space.damping, space.echoes].map((value) => value.toFixed(3)).join(':');
}

interface SpaceSlot {
  convolver: ConvolverNode;
  gain: GainNode;
}

export class SoundscapeEngine {
  private context: AudioContext | null = null;
  private worklet: AudioWorkletNode | null = null;
  private renderWorker: Worker | null = null;
  /**
   * The last configuration sent to the render worker, serialised. Each one
   * starts a new generation there and discards the audio rendered ahead, so
   * a change that does not touch the generator (master volume, the space's
   * return, on/off fades) must not send one.
   */
  private sentConfiguration: string | null = null;
  private readonly statsListeners = new Set<StatsListener>();

  /** Receive playback statistics, about every 0.2 s while a soundscape plays. Returns the unsubscribe. */
  subscribeStats(listener: StatsListener): () => void {
    this.statsListeners.add(listener);
    return () => { this.statsListeners.delete(listener); };
  }
  private mixGain: GainNode | null = null;
  private busLimiter: DynamicsCompressorNode | null = null;
  private spaceInput: GainNode | null = null;
  private spaceSlots: SpaceSlot[] = [];
  private liveSpaceSlot = 0;
  private spaceKey: string | null = null;
  private spaceTimer: number | null = null;
  private spaceReturnTarget = -1;
  private mixGainTarget = 0;
  private preferences: SoundscapePreferences | null = null;
  private starting: Promise<void> | null = null;
  private disconnectTimer: number | null = null;

  apply(preferences: SoundscapePreferences): void {
    this.preferences = preferences;
    if (!isSoundscapeAudible(preferences)) {
      this.fadeOutAndDisconnect();
      return;
    }

    if (this.disconnectTimer !== null) {
      window.clearTimeout(this.disconnectTimer);
      this.disconnectTimer = null;
    }

    if (this.worklet) {
      void this.resumeAndUpdate(preferences);
      return;
    }

    if (!this.starting) {
      this.starting = this.start().finally(() => {
        this.starting = null;
      });
    }
  }

  private async resumeAndUpdate(preferences: SoundscapePreferences): Promise<void> {
    try {
      const context = this.context;
      if (!context || context.state === 'closed') return;
      if (context.state === 'suspended') await context.resume();
      if (this.preferences !== preferences || !this.worklet) return;
      this.updateGraph(preferences);
    } catch (error) {
      console.error('Unable to resume soundscape audio', error);
    }
  }

  private async start(): Promise<void> {
    try {
      const context = await resumedOutputContext();
      if (context.state === 'closed') return;
      let modulePromise = WORKLET_MODULES.get(context);
      if (!modulePromise) {
        const moduleUrl = new URL('soundscape-player.js', window.location.href).toString();
        modulePromise = context.audioWorklet.addModule(moduleUrl);
        WORKLET_MODULES.set(context, modulePromise);
      }
      try {
        await modulePromise;
      } catch (error) {
        WORKLET_MODULES.delete(context);
        throw error;
      }
      const preferences = this.preferences;
      if (!preferences || !isSoundscapeAudible(preferences)) return;

      const noise = noiseLoopsFor(context.sampleRate);
      const worklet = new AudioWorkletNode(context, 'soundscape-player', {
        numberOfInputs: 0,
        numberOfOutputs: 2,
        outputChannelCount: [2, 2],
      });
      const renderWorker = new Worker(new URL('./soundscapeRender.worker.ts', import.meta.url), { type: 'module' });
      // Chunks go from the worker to the player directly, and the player's
      // consumption reports come back the same way.
      const link = new MessageChannel();
      worklet.port.postMessage({ type: 'connect', port: link.port1 }, [link.port1]);
      renderWorker.postMessage({
        type: 'init',
        sampleRate: context.sampleRate,
        options: {
          seed: (Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0,
          noiseLoops: noise.loops,
          noiseGains: noise.gains,
        },
        player: link.port2,
      }, [link.port2]);
      // Neither the player nor the worker runs again after an error, so the
      // graph around them is torn down now rather than after a fade: the
      // delayed teardown stands down while the preferences are still
      // audible, which they always are here, and would leave every later
      // apply() configuring a dead graph. With it gone, the next apply()
      // builds a new one.
      worklet.port.onmessage = (event: MessageEvent<{ type: string; queuedFrames: number; dryFrames: number; dryEvents: number }>) => {
        if (event.data?.type !== 'stats' || this.statsListeners.size === 0) return;
        const output = outputUnderruns(context);
        const stats: SoundscapePlaybackStats = {
          queuedSec: event.data.queuedFrames / context.sampleRate,
          playerDrySec: event.data.dryFrames / context.sampleRate,
          playerDryEvents: event.data.dryEvents,
          outputUnderrunSec: output?.sec ?? null,
          outputUnderrunEvents: output?.events ?? null,
        };
        for (const listener of this.statsListeners) listener(stats);
      };
      worklet.onprocessorerror = () => {
        console.error('Soundscape player stopped unexpectedly');
        if (this.worklet === worklet) this.teardown();
      };
      renderWorker.onerror = (event) => {
        console.error('Soundscape render worker stopped unexpectedly', event.message);
        if (this.renderWorker === renderWorker) this.teardown();
      };

      this.context = context;
      this.worklet = worklet;
      this.renderWorker = renderWorker;
      this.sentConfiguration = null;
      const mixGain = context.createGain();
      mixGain.gain.value = 0;
      const busLimiter = context.createDynamicsCompressor();
      // Gentle, for a soundscape whose own volume leaves it loud enough to
      // reach it (see SOUNDSCAPE_MIX_GAIN). A low ratio and a
      // wide knee turn a peak down a little rather than clamping it, and a
      // slow release lets the level drift back rather than breathe after
      // every peak -- the pumping this used to put on every layer. The knee
      // begins at -14 dBFS (-8 threshold minus half the 12 dB knee).
      busLimiter.threshold.value = -8;
      busLimiter.knee.value = 12;
      busLimiter.ratio.value = 3;
      busLimiter.attack.value = 0.02;
      busLimiter.release.value = 0.8;
      mixGain.connect(busLimiter);
      worklet.connect(mixGain, 0);

      const spaceInput = context.createGain();
      spaceInput.gain.value = 0;
      worklet.connect(spaceInput, 1);
      this.spaceSlots = [0, 1].map(() => {
        const convolver = context.createConvolver();
        // Calibrated by buildSoundscapeImpulseResponse instead; the browser's
        // normalisation would rescale away what damping and echoes change.
        // Must be set before a buffer is assigned.
        convolver.normalize = false;
        const gain = context.createGain();
        gain.gain.value = 0;
        spaceInput.connect(convolver);
        convolver.connect(gain);
        gain.connect(mixGain);
        return { convolver, gain };
      });

      connectToOutput(busLimiter);
      this.mixGain = mixGain;
      this.busLimiter = busLimiter;
      this.spaceInput = spaceInput;
      this.spaceKey = null;
      this.spaceReturnTarget = -1;
      this.mixGainTarget = 0;
      this.updateGraph(preferences);
    } catch (error) {
      console.error('Unable to start soundscape audio', error);
    }
  }

  private updateGraph(preferences: SoundscapePreferences): void {
    const context = this.context;
    const worklet = this.worklet;
    if (!context || !worklet) return;
    const now = context.currentTime;
    const mixTarget = SOUNDSCAPE_MIX_GAIN * preferences.masterVolume;
    if (this.mixGain && this.mixGainTarget !== mixTarget) {
      this.mixGain.gain.cancelAndHoldAtTime(now);
      this.mixGain.gain.setTargetAtTime(mixTarget, now, SOUNDSCAPE_FADE_SEC);
      this.mixGainTarget = mixTarget;
    }
    const space = preferences.settings.space;
    const returnTarget = SOUNDSCAPE_SPACE_RETURN * space.amount;
    if (this.spaceInput && this.spaceReturnTarget !== returnTarget) {
      this.spaceInput.gain.setTargetAtTime(returnTarget, now, SOUNDSCAPE_FADE_SEC);
      this.spaceReturnTarget = returnTarget;
    }
    this.scheduleSpace(space);
    const configuration = { type: 'configure', ...toGeneratorConfiguration(preferences.settings) };
    const serialised = JSON.stringify(configuration);
    if (serialised !== this.sentConfiguration && this.renderWorker) {
      this.renderWorker.postMessage(configuration);
      this.sentConfiguration = serialised;
    }
  }

  /**
   * Build the space's impulse response once its settings have rested for
   * SPACE_REBUILD_DELAY_MS (a slider drag would otherwise build dozens),
   * immediately for the first one.
   */
  private scheduleSpace(space: SoundscapeSpaceSettings): void {
    const key = spaceKey(space);
    if (key === this.spaceKey) return;
    if (this.spaceTimer !== null) window.clearTimeout(this.spaceTimer);
    const build = () => {
      this.spaceTimer = null;
      this.installSpace(space, key);
    };
    if (this.spaceKey === null) build();
    else this.spaceTimer = window.setTimeout(build, SPACE_REBUILD_DELAY_MS);
  }

  private installSpace(space: SoundscapeSpaceSettings, key: string): void {
    const context = this.context;
    if (!context || this.spaceSlots.length < 2) return;
    const [left, right] = buildSoundscapeImpulseResponse(space, context.sampleRate);
    const buffer = context.createBuffer(2, left.length, context.sampleRate);
    buffer.copyToChannel(left, 0);
    buffer.copyToChannel(right, 1);
    const incoming = this.spaceKey === null ? this.liveSpaceSlot : 1 - this.liveSpaceSlot;
    const outgoing = 1 - incoming;
    const now = context.currentTime;
    const slots = this.spaceSlots;
    slots[incoming].convolver.buffer = buffer;
    slots[incoming].gain.gain.cancelScheduledValues(now);
    slots[incoming].gain.gain.setValueAtTime(slots[incoming].gain.gain.value, now);
    slots[incoming].gain.gain.linearRampToValueAtTime(1, now + SPACE_CROSSFADE_SEC);
    slots[outgoing].gain.gain.cancelScheduledValues(now);
    slots[outgoing].gain.gain.setValueAtTime(slots[outgoing].gain.gain.value, now);
    slots[outgoing].gain.gain.linearRampToValueAtTime(0, now + SPACE_CROSSFADE_SEC);
    this.liveSpaceSlot = incoming;
    this.spaceKey = key;
  }

  private fadeOutAndDisconnect(): void {
    const context = this.context;
    const worklet = this.worklet;
    if (!context || !worklet) return;

    const now = context.currentTime;
    if (this.mixGain && this.mixGainTarget !== 0) {
      this.mixGain.gain.cancelAndHoldAtTime(now);
      this.mixGain.gain.setTargetAtTime(0, now, 0.025);
      this.mixGainTarget = 0;
    }
    if (this.disconnectTimer !== null) window.clearTimeout(this.disconnectTimer);
    this.disconnectTimer = window.setTimeout(() => {
      this.disconnectTimer = null;
      const latest = this.preferences;
      if (latest && isSoundscapeAudible(latest)) return;
      this.teardown();
    }, SOUNDSCAPE_DISCONNECT_MS);
  }

  /**
   * Take the graph down and let its processor and worker go. The `stop`
   * message is what lets the audio thread drop the processor (see
   * soundscape-player.js); disconnecting the node alone leaves it running.
   */
  private teardown(): void {
    if (this.disconnectTimer !== null) window.clearTimeout(this.disconnectTimer);
    this.disconnectTimer = null;
    if (this.spaceTimer !== null) window.clearTimeout(this.spaceTimer);
    this.spaceTimer = null;
    this.worklet?.port.postMessage({ type: 'stop' });
    this.renderWorker?.terminate();
    this.renderWorker = null;
    this.sentConfiguration = null;
    this.worklet?.disconnect();
    this.mixGain?.disconnect();
    this.busLimiter?.disconnect();
    this.spaceInput?.disconnect();
    for (const slot of this.spaceSlots) {
      slot.convolver.disconnect();
      slot.gain.disconnect();
    }
    this.worklet = null;
    this.mixGain = null;
    this.busLimiter = null;
    this.spaceInput = null;
    this.spaceSlots = [];
    this.spaceKey = null;
  }
}

export const soundscapeEngine = new SoundscapeEngine();
