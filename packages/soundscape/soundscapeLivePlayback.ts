/**
 * The desktop's soundscape playback (see SoundscapeEngine): LIVE, on the
 * audio thread. The generator runs as an AudioWorklet and the browser's own
 * nodes do the mix, so a settings change reaches the next 128-frame block:
 * nothing is rendered ahead, so nothing has to be discarded and re-rendered
 * when a slider moves.
 *
 * This is the same sound as the Android renderer (soundscapeRenderAhead.ts
 * and soundscapeMix.ts), from the same shared parts: the generator itself,
 * the mix gain and the space's return (SOUNDSCAPE_MIX_GAIN,
 * SOUNDSCAPE_SPACE_RETURN), the impulse response (@thockdown/audio/room.ts) and
 * the compressor's settings (BUS_COMPRESSOR). soundscapeMix.ts's convolution
 * and compressor were measured equal to the ConvolverNode and
 * DynamicsCompressorNode used here (apps/soundscapes/README.md). Android renders ahead
 * because its WebView's audio stalls on an app switch and its JavaScript is
 * paused in the background; the desktop has neither problem.
 *
 * One VOICE per soundscape heard:
 *
 *   generator out 0 (direct) ----------------------------------> voice gain
 *   generator out 1 (send) -> return gain -> room (@thockdown/audio/liveRoom.ts) -> voice gain
 *   every voice gain -> mix gain -> bus compressor -> brilliance -> volume -> shared limiter
 *
 * BRILLIANCE (@thockdown/audio/liveBrilliance.ts) is the mix's, not a voice's: its
 * filters and makeup gain, gliding to a new setting; across a
 * change of soundscape they glide over the crossfade.
 *
 * A settings change goes to the current voice: the generator takes it at
 * its next block, the return glides, and a changed ROOM is the voice's
 * LiveRoom's to build and crossfade in (liveRoom.ts says when). A change of
 * SOUNDSCAPE (`transitionSec` > 0) builds a new voice and crossfades the two
 * voice gains, equal-power, over that time; the old voice is then stopped.
 */
import { buildNoiseLoops, noiseLoopGains, type NoiseLoops } from './soundscapeNoiseLoops';
import { LiveRoom } from '@thockdown/audio/liveRoom';
import type { SoundscapePlayback, SoundscapePlaybackHandlers } from './SoundscapeEngine';
import { connectToOutput, resumedOutputContext } from './audioOutputBus';
import { BRILLIANCE_GLIDE_SEC, LiveBrilliance } from '@thockdown/audio/liveBrilliance';
import { BUS_COMPRESSOR, SOUNDSCAPE_MIX_GAIN, SOUNDSCAPE_SPACE_RETURN } from './soundscapeMix';
import type { ConfigureMessage } from './soundscapeRenderAhead';
import generatorUrl from './soundscape-generator?url';

/** The glide on the space's return when its amount changes. */
const RETURN_TIME_CONSTANT_SEC = 0.08;

const WORKLET_MODULES = new WeakMap<AudioContext, Promise<void>>();

/** The noise loops and their level-matching gains, per sample rate: built once, copied into each generator. */
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


/** An equal-power fade, 0 to 1 (or 1 to 0), as a gain curve. */
function equalPowerCurve(rising: boolean): Float32Array {
  const points = 64;
  const curve = new Float32Array(points);
  for (let index = 0; index < points; index += 1) {
    const t = index / (points - 1);
    curve[index] = rising ? Math.sin(t * Math.PI * 0.5) : Math.cos(t * Math.PI * 0.5);
  }
  return curve;
}

class Voice {
  readonly gain: GainNode;
  private readonly generator: AudioWorkletNode;
  private readonly returnGain: GainNode;
  private readonly room: LiveRoom;
  private returnTarget = -1;

  constructor(private readonly context: AudioContext, destination: AudioNode, onFailure: (message: string) => void) {
    const noise = noiseLoopsFor(context.sampleRate);
    this.generator = new AudioWorkletNode(context, 'soundscape-generator', {
      numberOfInputs: 0,
      numberOfOutputs: 2,
      outputChannelCount: [2, 2],
      processorOptions: {
        seed: (Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0,
        noiseLoops: noise.loops,
        noiseGains: noise.gains,
      },
    });
    this.generator.onprocessorerror = () => onFailure('Soundscape generator stopped unexpectedly');
    this.gain = context.createGain();
    this.gain.connect(destination);
    this.generator.connect(this.gain, 0);
    this.returnGain = context.createGain();
    this.returnGain.gain.value = 0;
    this.generator.connect(this.returnGain, 1);
    this.room = new LiveRoom(context);
    this.returnGain.connect(this.room.input);
    this.room.output.connect(this.gain);
  }

  setWeatherFloor(floor: number): void {
    this.generator.port.postMessage({ type: 'weatherFloor', value: floor });
  }

  configure(message: ConfigureMessage): void {
    this.generator.port.postMessage(message.generator);
    const space = message.space;
    const returnTarget = SOUNDSCAPE_SPACE_RETURN * space.amount;
    if (returnTarget !== this.returnTarget) {
      const now = this.context.currentTime;
      if (this.returnTarget < 0) this.returnGain.gain.setValueAtTime(returnTarget, now);
      else this.returnGain.gain.setTargetAtTime(returnTarget, now, RETURN_TIME_CONSTANT_SEC);
      this.returnTarget = returnTarget;
    }
    this.room.setRoom(space);
  }

  /** Fade this voice's gain in or out, equal-power, over `seconds` from now. */
  fade(rising: boolean, seconds: number): void {
    const now = this.context.currentTime;
    this.gain.gain.cancelScheduledValues(now);
    this.gain.gain.setValueCurveAtTime(equalPowerCurve(rising), now, seconds);
  }

  /** Stop the generator and take the voice down. `stop` is what lets the audio thread drop the processor. */
  close(): void {
    this.generator.port.postMessage({ type: 'stop' });
    this.generator.disconnect();
    this.returnGain.disconnect();
    this.room.dispose();
    this.gain.disconnect();
  }
}

export async function createLivePlayback(handlers: SoundscapePlaybackHandlers): Promise<SoundscapePlayback> {
  const context = await resumedOutputContext();
  let modulePromise = WORKLET_MODULES.get(context);
  if (!modulePromise) {
    modulePromise = context.audioWorklet.addModule(new URL(generatorUrl, window.location.href).toString());
    WORKLET_MODULES.set(context, modulePromise);
  }
  try {
    await modulePromise;
  } catch (error) {
    WORKLET_MODULES.delete(context);
    throw error;
  }

  const mixGain = context.createGain();
  mixGain.gain.value = SOUNDSCAPE_MIX_GAIN;
  const compressor = context.createDynamicsCompressor();
  compressor.threshold.value = BUS_COMPRESSOR.thresholdDb;
  compressor.knee.value = BUS_COMPRESSOR.kneeDb;
  compressor.ratio.value = BUS_COMPRESSOR.ratio;
  compressor.attack.value = BUS_COMPRESSOR.attackSec;
  compressor.release.value = BUS_COMPRESSOR.releaseSec;
  const volume = context.createGain();
  volume.gain.value = 0;
  const brilliance = new LiveBrilliance(context);
  mixGain.connect(compressor);
  compressor.connect(brilliance.input);
  brilliance.output.connect(volume);
  connectToOutput(volume);

  let closed = false;
  const fail = (message: string) => {
    if (!closed) handlers.onFailure(message);
  };
  let voice = new Voice(context, mixGain, fail);
  /** Voices fading out after a change of soundscape, each with its timer. */
  const leaving = new Map<Voice, number>();
  let weatherFloor = 0;

  return {
    configure(configuration, transitionSec) {
      brilliance.set(configuration.space.brilliance, transitionSec > 0 ? transitionSec / 3 : BRILLIANCE_GLIDE_SEC);
      if (transitionSec <= 0) {
        voice.configure(configuration);
        return;
      }
      const old = voice;
      voice = new Voice(context, mixGain, fail);
      voice.configure(configuration);
      if (weatherFloor > 0) voice.setWeatherFloor(weatherFloor);
      voice.fade(true, transitionSec);
      old.fade(false, transitionSec);
      leaving.set(old, window.setTimeout(() => {
        leaving.delete(old);
        old.close();
      }, (transitionSec * 1000) + 100));
    },
    setWeatherFloor(floor) {
      weatherFloor = floor;
      voice.setWeatherFloor(floor);
      for (const old of leaving.keys()) old.setWeatherFloor(floor);
    },
    setVolume(target, timeConstantSec) {
      const now = context.currentTime;
      volume.gain.cancelAndHoldAtTime(now);
      volume.gain.setTargetAtTime(target, now, timeConstantSec);
    },
    close() {
      closed = true;
      for (const [old, timer] of leaving) {
        window.clearTimeout(timer);
        old.close();
      }
      leaving.clear();
      voice.close();
      mixGain.disconnect();
      brilliance.dispose();
      compressor.disconnect();
      volume.disconnect();
    },
  };
}
