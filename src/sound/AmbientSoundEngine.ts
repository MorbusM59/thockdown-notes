import {
  AMBIENT_RAIN_CHANNEL_COUNT,
  AMBIENT_RAIN_FIRST_INDEX,
  type AmbientChannelSettings,
  type AmbientPreferences,
  type AmbientRainChannelSettings,
  type AmbientSettings,
} from '../shared/ambientSound';
import { buildAmbientEnvelope, resolveAmbientRainSpace } from '../shared/ambientSoundDsp';
import { musicPlayerService } from './MusicPlayerService';
import { buildSyntheticRoomImpulseResponse } from './impulseResponse';

const AMBIENT_MIX_GAIN = 0.34;
const AMBIENT_FADE_SEC = 0.08;
const AMBIENT_DISCONNECT_MS = 180;

interface AmbientRainLayerNodes {
  filter: BiquadFilterNode;
  panner: StereoPannerNode;
  directGain: GainNode;
  reverbSend: GainNode;
}

const WORKLET_MODULES = new WeakMap<AudioContext, Promise<void>>();

function hasAudibleLayer(settings: AmbientSettings): boolean {
  const soloChannel = settings.find((channel) => channel.solo);
  if (soloChannel) return soloChannel.enabled && soloChannel.volume > 0;
  return settings.some((channel) => channel.enabled && channel.volume > 0);
}

export class AmbientSoundEngine {
  private context: AudioContext | null = null;
  private worklet: AudioWorkletNode | null = null;
  private mixGain: GainNode | null = null;
  private rainReverb: ConvolverNode | null = null;
  private rainLayerNodes: AmbientRainLayerNodes[] = [];
  private mixGainTarget = 0;
  private preferences: AmbientPreferences | null = null;
  private starting: Promise<void> | null = null;
  private disconnectTimer: number | null = null;

  apply(preferences: AmbientPreferences): void {
    this.preferences = preferences;
    if (!preferences.enabled || !hasAudibleLayer(preferences.settings)) {
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
      this.updateGraph(preferences.settings);
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
      if (!preferences?.enabled || !hasAudibleLayer(preferences.settings)) return;

      const worklet = new AudioWorkletNode(context, 'ambient-generator', {
        numberOfOutputs: 1 + AMBIENT_RAIN_CHANNEL_COUNT,
        outputChannelCount: [2, 1, 1, 1],
        processorOptions: { seed: (Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0 },
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

      const rainReverb = context.createConvolver();
      rainReverb.buffer = buildSyntheticRoomImpulseResponse(context, 0.3);
      rainReverb.connect(mixGain);
      const rainLayerNodes = Array.from({ length: AMBIENT_RAIN_CHANNEL_COUNT }, (_, index) => {
        const filter = context.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = 18000;
        filter.Q.value = 0.707;
        const panner = context.createStereoPanner();
        panner.pan.value = 0;
        const directGain = context.createGain();
        const reverbSend = context.createGain();
        worklet.connect(filter, index + 1);
        filter.connect(panner);
        panner.connect(directGain);
        directGain.connect(mixGain);
        panner.connect(reverbSend);
        reverbSend.connect(rainReverb);
        return { filter, panner, directGain, reverbSend };
      });

      musicPlayerService.connectToMix(mixGain);
      this.mixGain = mixGain;
      this.rainReverb = rainReverb;
      this.rainLayerNodes = rainLayerNodes;
      this.mixGainTarget = 0;
      this.updateGraph(preferences.settings);
    } catch (error) {
      console.error('Unable to start ambient audio', error);
    }
  }

  private updateGraph(settings: AmbientSettings): void {
    const context = this.context;
    const worklet = this.worklet;
    if (!context || !worklet) return;

    const now = context.currentTime;
    const mixGain = this.mixGain;
    if (mixGain && this.mixGainTarget !== AMBIENT_MIX_GAIN) {
      mixGain.gain.cancelAndHoldAtTime(now);
      mixGain.gain.setTargetAtTime(AMBIENT_MIX_GAIN, now, AMBIENT_FADE_SEC);
      this.mixGainTarget = AMBIENT_MIX_GAIN;
    }

    const channels = settings.map((channel: AmbientChannelSettings) => (
      channel.kind === 'noise'
        ? { ...channel, envelope: buildAmbientEnvelope(channel.ramp, channel.shape) }
        : channel
    ));
    for (let index = 0; index < AMBIENT_RAIN_CHANNEL_COUNT; index += 1) {
      const channel = settings[AMBIENT_RAIN_FIRST_INDEX + index] as AmbientRainChannelSettings | undefined;
      const nodes = this.rainLayerNodes[index];
      if (!channel || !nodes) continue;
      const space = resolveAmbientRainSpace(channel.distance);
      nodes.panner.pan.setTargetAtTime(channel.pan, now, 0.08);
      nodes.filter.frequency.setTargetAtTime(space.cutoffHz, now, 0.08);
      nodes.directGain.gain.setTargetAtTime(space.directGain, now, 0.08);
      nodes.reverbSend.gain.setTargetAtTime(space.reverbSend, now, 0.08);
    }
    worklet.port.postMessage({ type: 'configure', channels });
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
      if (latest?.enabled && hasAudibleLayer(latest.settings)) return;
      this.worklet?.disconnect();
      this.mixGain?.disconnect();
      this.rainReverb?.disconnect();
      for (const nodes of this.rainLayerNodes) {
        nodes.filter.disconnect();
        nodes.panner.disconnect();
        nodes.directGain.disconnect();
        nodes.reverbSend.disconnect();
      }
      this.worklet = null;
      this.mixGain = null;
      this.rainReverb = null;
      this.rainLayerNodes = [];
    }, AMBIENT_DISCONNECT_MS);
  }
}

export const ambientSoundEngine = new AmbientSoundEngine();