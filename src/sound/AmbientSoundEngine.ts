/**
 * AmbientSoundEngine -- the Web Audio graph around the ambient worklet.
 *
 *   worklet output 0 (noise direct, stereo) -----------------------> mixGain
 *   worklet output 1+i (rain layer i, stereo) -> low-pass -> direct -> mixGain
 *                                                     \-> reverb send -> reverb -> mixGain
 *   worklet output NOISE_SEND_OUTPUT (noise reverb sends, stereo) -> reverb
 *
 * A noise layer's distance is applied inside the worklet (its layers share
 * one output, so no per-layer node could do it); a rain layer's here. Both
 * follow resolveAmbientSpace. A rain layer's pan is applied in the worklet,
 * drop by drop, because it sets the layer's width as well as its place.
 *   mixGain -> the music player's shared output limiter
 *
 * The graph exists only while something is audible: it is built on the
 * first audible `apply` and torn down after a short fade once nothing is.
 * `mixGain` carries both the fade and the listener's master volume.
 */
import {
  AMBIENT_RAIN_CHANNEL_COUNT,
  AMBIENT_RAIN_FIRST_INDEX,
  type AmbientPreferences,
  type AmbientSettings,
} from '../shared/ambientSound';
import { resolveAmbientSpace, toWorkletChannels } from '../shared/ambientSoundDsp';
import { buildNoiseLoops, type NoiseLoops } from '../shared/ambientNoiseLoops';
import { musicPlayerService } from './MusicPlayerService';
import { buildSyntheticRoomImpulseResponse } from './impulseResponse';

/** The worklet output carrying the noise layers' reverb sends: after the rain outputs. */
const NOISE_SEND_OUTPUT = 1 + AMBIENT_RAIN_CHANNEL_COUNT;

/** Mix level at master volume 1, leaving headroom beside the music. */
const AMBIENT_MIX_GAIN = 0.34;
const AMBIENT_FADE_SEC = 0.08;
const AMBIENT_DISCONNECT_MS = 180;

interface AmbientRainLayerNodes {
  filter: BiquadFilterNode;
  directGain: GainNode;
  reverbSend: GainNode;
}

const WORKLET_MODULES = new WeakMap<AudioContext, Promise<void>>();

/**
 * The noise loops, per sample rate. Built once on the main thread (tens of
 * milliseconds) and copied into each worklet at creation, so the audio
 * thread never generates noise.
 */
const NOISE_LOOPS = new Map<number, NoiseLoops>();

function noiseLoopsFor(sampleRate: number): NoiseLoops {
  let loops = NOISE_LOOPS.get(sampleRate);
  if (!loops) {
    loops = buildNoiseLoops(sampleRate);
    NOISE_LOOPS.set(sampleRate, loops);
  }
  return loops;
}

/** Whether these preferences would make any sound at all. */
function isAudible(preferences: AmbientPreferences): boolean {
  return preferences.enabled && preferences.masterVolume > 0 && hasAudibleLayer(preferences.settings);
}

function hasAudibleLayer(settings: AmbientSettings): boolean {
  const soloChannel = settings.find((channel) => channel.solo);
  if (soloChannel) return soloChannel.enabled && soloChannel.volume > 0;
  return settings.some((channel) => channel.enabled && channel.volume > 0);
}

export class AmbientSoundEngine {
  private context: AudioContext | null = null;
  private worklet: AudioWorkletNode | null = null;
  private mixGain: GainNode | null = null;
  private reverb: ConvolverNode | null = null;
  private rainLayerNodes: AmbientRainLayerNodes[] = [];
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

      const worklet = new AudioWorkletNode(context, 'ambient-generator', {
        numberOfOutputs: NOISE_SEND_OUTPUT + 1,
        outputChannelCount: [2, ...Array.from({ length: AMBIENT_RAIN_CHANNEL_COUNT }, () => 2), 2],
        processorOptions: {
          seed: (Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0,
          noiseLoops: noiseLoopsFor(context.sampleRate),
          noiseSendOutput: NOISE_SEND_OUTPUT,
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
      worklet.connect(mixGain, 0);

      const reverb = context.createConvolver();
      reverb.buffer = buildSyntheticRoomImpulseResponse(context, 0.3);
      reverb.connect(mixGain);
      worklet.connect(reverb, NOISE_SEND_OUTPUT);
      const rainLayerNodes = Array.from({ length: AMBIENT_RAIN_CHANNEL_COUNT }, (_, index) => {
        const filter = context.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = 18000;
        filter.Q.value = 0.707;
        const directGain = context.createGain();
        const reverbSend = context.createGain();
        worklet.connect(filter, index + 1);
        filter.connect(directGain);
        directGain.connect(mixGain);
        filter.connect(reverbSend);
        reverbSend.connect(reverb);
        return { filter, directGain, reverbSend };
      });

      musicPlayerService.connectToMix(mixGain);
      this.mixGain = mixGain;
      this.reverb = reverb;
      this.rainLayerNodes = rainLayerNodes;
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
    const settings = preferences.settings;

    const now = context.currentTime;
    const mixGain = this.mixGain;
    const mixTarget = AMBIENT_MIX_GAIN * preferences.masterVolume;
    if (mixGain && this.mixGainTarget !== mixTarget) {
      mixGain.gain.cancelAndHoldAtTime(now);
      mixGain.gain.setTargetAtTime(mixTarget, now, AMBIENT_FADE_SEC);
      this.mixGainTarget = mixTarget;
    }

    for (let index = 0; index < AMBIENT_RAIN_CHANNEL_COUNT; index += 1) {
      const channel = settings[AMBIENT_RAIN_FIRST_INDEX + index];
      const nodes = this.rainLayerNodes[index];
      if (channel?.kind !== 'rain' || !nodes) continue;
      const space = resolveAmbientSpace(channel.distance);
      nodes.filter.frequency.setTargetAtTime(space.cutoffHz, now, AMBIENT_FADE_SEC);
      nodes.directGain.gain.setTargetAtTime(space.directGain, now, AMBIENT_FADE_SEC);
      nodes.reverbSend.gain.setTargetAtTime(space.reverbSend, now, AMBIENT_FADE_SEC);
    }
    worklet.port.postMessage({ type: 'configure', channels: toWorkletChannels(settings) });
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
      this.worklet?.disconnect();
      this.mixGain?.disconnect();
      this.reverb?.disconnect();
      for (const nodes of this.rainLayerNodes) {
        nodes.filter.disconnect();
        nodes.directGain.disconnect();
        nodes.reverbSend.disconnect();
      }
      this.worklet = null;
      this.mixGain = null;
      this.reverb = null;
      this.rainLayerNodes = [];
    }, AMBIENT_DISCONNECT_MS);
  }
}

export const ambientSoundEngine = new AmbientSoundEngine();