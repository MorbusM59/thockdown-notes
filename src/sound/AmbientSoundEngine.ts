import {
  AMBIENT_LAYER_IDS,
  type AmbientLayerId,
  type AmbientPreferences,
  type AmbientSettings,
} from '../shared/ambientSound';
import { buildAmbientEnvelopeBank, resolveAmbientTextureProfile } from '../shared/ambientSoundDsp';
import { musicPlayerService } from './MusicPlayerService';

const AMBIENT_MIX_GAIN = 0.34;
const AMBIENT_FADE_SEC = 0.08;
const AMBIENT_DISCONNECT_MS = 180;

const WORKLET_MODULES = new WeakMap<AudioContext, Promise<void>>();

function hasAudibleLayer(settings: AmbientSettings): boolean {
  return AMBIENT_LAYER_IDS.some((layerId) => settings[layerId].volume > 0);
}

export class AmbientSoundEngine {
  private context: AudioContext | null = null;
  private worklet: AudioWorkletNode | null = null;
  private readonly filters = new Map<AmbientLayerId, BiquadFilterNode>();
  private readonly gains = new Map<AmbientLayerId, GainNode>();
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
        numberOfOutputs: AMBIENT_LAYER_IDS.length,
        outputChannelCount: AMBIENT_LAYER_IDS.map(() => 2),
        processorOptions: { seed: (Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0 },
      });
      worklet.onprocessorerror = () => {
        console.error('Ambient audio worklet stopped unexpectedly');
        this.fadeOutAndDisconnect();
      };

      this.context = context;
      this.worklet = worklet;
      AMBIENT_LAYER_IDS.forEach((layerId, index) => {
        const filter = context.createBiquadFilter();
        filter.type = layerId === 'rain' ? 'highpass' : 'lowpass';
        filter.Q.value = 0.45;
        const gain = context.createGain();
        gain.gain.value = 0;
        worklet.connect(filter, index, 0);
        filter.connect(gain);
        musicPlayerService.connectToMix(gain);
        this.filters.set(layerId, filter);
        this.gains.set(layerId, gain);
      });
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
    const layers = Object.fromEntries(AMBIENT_LAYER_IDS.map((layerId) => {
      const layer = settings[layerId];
      const filter = this.filters.get(layerId);
      const gain = this.gains.get(layerId);
      if (filter) {
        const frequency = layerId === 'wind'
          ? 260 + (layer.texture * 1800)
          : layerId === 'ocean'
            ? 120 + (layer.texture * 950)
            : 500 + (layer.texture * 3200);
        filter.frequency.setTargetAtTime(frequency, now, 0.12);
      }
      if (gain) {
        gain.gain.cancelAndHoldAtTime(now);
        gain.gain.setTargetAtTime(layer.volume * AMBIENT_MIX_GAIN, now, AMBIENT_FADE_SEC);
      }
      return [layerId, {
        texture: layer.texture,
        profile: resolveAmbientTextureProfile(layer.texture),
        envelopes: buildAmbientEnvelopeBank(layer.texture),
      }];
    }));

    worklet.port.postMessage({ type: 'configure', layers });
  }

  private fadeOutAndDisconnect(): void {
    const context = this.context;
    const worklet = this.worklet;
    if (!context || !worklet) return;

    const now = context.currentTime;
    for (const gain of this.gains.values()) {
      gain.gain.cancelAndHoldAtTime(now);
      gain.gain.setTargetAtTime(0, now, 0.025);
    }
    if (this.disconnectTimer !== null) window.clearTimeout(this.disconnectTimer);
    this.disconnectTimer = window.setTimeout(() => {
      this.disconnectTimer = null;
      const latest = this.preferences;
      if (latest?.enabled && hasAudibleLayer(latest.settings)) return;
      this.worklet?.disconnect();
      for (const filter of this.filters.values()) filter.disconnect();
      for (const gain of this.gains.values()) gain.disconnect();
      this.worklet = null;
      this.filters.clear();
      this.gains.clear();
    }, AMBIENT_DISCONNECT_MS);
  }
}

export const ambientSoundEngine = new AmbientSoundEngine();