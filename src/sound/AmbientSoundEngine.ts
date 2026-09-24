import {
  type AmbientChannelSettings,
  type AmbientPreferences,
  type AmbientSettings,
} from '../shared/ambientSound';
import { buildAmbientEnvelope } from '../shared/ambientSoundDsp';
import { musicPlayerService } from './MusicPlayerService';

const AMBIENT_MIX_GAIN = 0.34;
const AMBIENT_FADE_SEC = 0.08;
const AMBIENT_DISCONNECT_MS = 180;

const WORKLET_MODULES = new WeakMap<AudioContext, Promise<void>>();

function hasAudibleLayer(settings: AmbientSettings): boolean {
  return settings.some((channel) => channel.enabled && channel.volume > 0);
}

export class AmbientSoundEngine {
  private context: AudioContext | null = null;
  private worklet: AudioWorkletNode | null = null;
  private mixGain: GainNode | null = null;
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
        numberOfOutputs: 1,
        outputChannelCount: [2],
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
      worklet.connect(mixGain);
      musicPlayerService.connectToMix(mixGain);
      this.mixGain = mixGain;
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

    const channels = settings.map((channel: AmbientChannelSettings) => ({
      ...channel,
      envelope: buildAmbientEnvelope(channel.ramp, channel.shape),
    }));
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
      this.worklet = null;
      this.mixGain = null;
    }, AMBIENT_DISCONNECT_MS);
  }
}

export const ambientSoundEngine = new AmbientSoundEngine();