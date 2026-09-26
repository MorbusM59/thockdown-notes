/**
 * AmbientSoundEngine -- the Web Audio graph around the ambient worklet.
 *
 *   worklet output 0 (every layer's direct sound, stereo) -------------> mixGain
 *   worklet output 1 (every layer's send to the space, stereo) -> space -> mixGain
 *   mixGain -> busLimiter -> the music player's shared output limiter
 *
 * Every layer is placed -- its distance, its direct and send gains -- inside
 * the worklet, by one rule; this graph only carries the two buses. The SPACE
 * is a convolution with the soundscape's own impulse response
 * (src/shared/ambientSpace.ts). It is two convolvers crossfaded: a changed
 * space is built into whichever is silent and faded in over the other, since
 * swapping a playing convolver's buffer is heard as a click.
 *
 * `busLimiter` is ambient sound's own dynamics, ahead of the limiter the
 * music shares: a thunder peal is caught here, gently, rather than making the
 * music's hard limiter pump.
 *
 * The graph exists only while something is audible: it is built on the
 * first audible `apply` and torn down after a short fade once nothing is.
 * `mixGain` carries both the fade and the listener's master volume.
 */
import {
  hasAudibleAmbientLayer,
  type AmbientPreferences,
  type AmbientSpaceSettings,
} from '../shared/ambientSound';
import { toWorkletConfiguration } from '../shared/ambientSoundDsp';
import { buildNoiseLoops, noiseLoopGains, type NoiseLoops } from '../shared/ambientNoiseLoops';
import { buildAmbientImpulseResponse } from '../shared/ambientSpace';
import { musicPlayerService } from './MusicPlayerService';

/** Mix level at master volume 1, leaving headroom beside the music. */
const AMBIENT_MIX_GAIN = 0.5;
/** The space's return at `amount` 1. */
const AMBIENT_SPACE_RETURN = 1.2;
const AMBIENT_FADE_SEC = 0.08;
const AMBIENT_DISCONNECT_MS = 180;
/** How long a new space takes to fade in over the old, and how long a slider must rest before one is built. */
const SPACE_CROSSFADE_SEC = 0.35;
const SPACE_REBUILD_DELAY_MS = 120;

const WORKLET_MODULES = new WeakMap<AudioContext, Promise<void>>();

/**
 * The noise loops and their level-matching gains, per sample rate. Built
 * once on the main thread (tens of milliseconds) and copied into each
 * worklet at creation, so the audio thread never generates noise.
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

/** Whether these preferences would make any sound at all. */
function isAudible(preferences: AmbientPreferences): boolean {
  return preferences.enabled && preferences.masterVolume > 0 && hasAudibleAmbientLayer(preferences.settings);
}

function spaceKey(space: AmbientSpaceSettings): string {
  return [space.size, space.damping, space.echoes].map((value) => value.toFixed(3)).join(':');
}

interface SpaceSlot {
  convolver: ConvolverNode;
  gain: GainNode;
}

export class AmbientSoundEngine {
  private context: AudioContext | null = null;
  private worklet: AudioWorkletNode | null = null;
  private mixGain: GainNode | null = null;
  private busLimiter: DynamicsCompressorNode | null = null;
  private spaceInput: GainNode | null = null;
  private spaceSlots: SpaceSlot[] = [];
  private liveSpaceSlot = 0;
  private spaceKey: string | null = null;
  private spaceTimer: number | null = null;
  private spaceReturnTarget = -1;
  private mixGainTarget = 0;
  private preferences: AmbientPreferences | null = null;
  private starting: Promise<void> | null = null;
  private disconnectTimer: number | null = null;

  apply(preferences: AmbientPreferences): void {
    this.preferences = preferences;
    if (!isAudible(preferences)) {
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

  private async resumeAndUpdate(preferences: AmbientPreferences): Promise<void> {
    try {
      const context = this.context;
      if (!context || context.state === 'closed') return;
      if (context.state === 'suspended') await context.resume();
      if (this.preferences !== preferences || !this.worklet) return;
      this.updateGraph(preferences);
    } catch (error) {
      console.error('Unable to resume ambient audio', error);
    }
  }

  private async start(): Promise<void> {
    try {
      const context = await musicPlayerService.getAudioContextForMix();
      if (context.state === 'closed') return;
      let modulePromise = WORKLET_MODULES.get(context);
      if (!modulePromise) {
        const moduleUrl = new URL('ambient-generator.js', window.location.href).toString();
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
      if (!preferences || !isAudible(preferences)) return;

      const noise = noiseLoopsFor(context.sampleRate);
      const worklet = new AudioWorkletNode(context, 'ambient-generator', {
        numberOfInputs: 0,
        numberOfOutputs: 2,
        outputChannelCount: [2, 2],
        processorOptions: {
          seed: (Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0,
          noiseLoops: noise.loops,
          noiseGains: noise.gains,
        },
      });
      worklet.onprocessorerror = () => {
        console.error('Ambient audio worklet stopped unexpectedly');
        this.fadeOutAndDisconnect();
      };

      this.context = context;
      this.worklet = worklet;
      const mixGain = context.createGain();
      mixGain.gain.value = 0;
      const busLimiter = context.createDynamicsCompressor();
      busLimiter.threshold.value = -10;
      busLimiter.knee.value = 8;
      busLimiter.ratio.value = 6;
      busLimiter.attack.value = 0.01;
      busLimiter.release.value = 0.25;
      mixGain.connect(busLimiter);
      worklet.connect(mixGain, 0);

      const spaceInput = context.createGain();
      spaceInput.gain.value = 0;
      worklet.connect(spaceInput, 1);
      this.spaceSlots = [0, 1].map(() => {
        const convolver = context.createConvolver();
        const gain = context.createGain();
        gain.gain.value = 0;
        spaceInput.connect(convolver);
        convolver.connect(gain);
        gain.connect(mixGain);
        return { convolver, gain };
      });

      musicPlayerService.connectToMix(busLimiter);
      this.mixGain = mixGain;
      this.busLimiter = busLimiter;
      this.spaceInput = spaceInput;
      this.spaceKey = null;
      this.spaceReturnTarget = -1;
      this.mixGainTarget = 0;
      this.updateGraph(preferences);
    } catch (error) {
      console.error('Unable to start ambient audio', error);
    }
  }

  private updateGraph(preferences: AmbientPreferences): void {
    const context = this.context;
    const worklet = this.worklet;
    if (!context || !worklet) return;
    const now = context.currentTime;
    const mixTarget = AMBIENT_MIX_GAIN * preferences.masterVolume;
    if (this.mixGain && this.mixGainTarget !== mixTarget) {
      this.mixGain.gain.cancelAndHoldAtTime(now);
      this.mixGain.gain.setTargetAtTime(mixTarget, now, AMBIENT_FADE_SEC);
      this.mixGainTarget = mixTarget;
    }
    const space = preferences.settings.space;
    const returnTarget = AMBIENT_SPACE_RETURN * space.amount;
    if (this.spaceInput && this.spaceReturnTarget !== returnTarget) {
      this.spaceInput.gain.setTargetAtTime(returnTarget, now, AMBIENT_FADE_SEC);
      this.spaceReturnTarget = returnTarget;
    }
    this.scheduleSpace(space);
    worklet.port.postMessage({ type: 'configure', ...toWorkletConfiguration(preferences.settings) });
  }

  /**
   * Build the space's impulse response once its settings have rested for
   * SPACE_REBUILD_DELAY_MS (a slider drag would otherwise build dozens),
   * immediately for the first one.
   */
  private scheduleSpace(space: AmbientSpaceSettings): void {
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

  private installSpace(space: AmbientSpaceSettings, key: string): void {
    const context = this.context;
    if (!context || this.spaceSlots.length < 2) return;
    const [left, right] = buildAmbientImpulseResponse(space, context.sampleRate);
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
      if (latest && isAudible(latest)) return;
      if (this.spaceTimer !== null) window.clearTimeout(this.spaceTimer);
      this.spaceTimer = null;
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
    }, AMBIENT_DISCONNECT_MS);
  }
}

export const ambientSoundEngine = new AmbientSoundEngine();
