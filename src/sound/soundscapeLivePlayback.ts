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
 * SOUNDSCAPE_SPACE_RETURN), the impulse response (soundscapeSpace.ts) and
 * the compressor's settings (BUS_COMPRESSOR). soundscapeMix.ts's convolution
 * and compressor were measured equal to the ConvolverNode and
 * DynamicsCompressorNode used here (apps/soundscapes/README.md). Android renders ahead
 * because its WebView's audio stalls on an app switch and its JavaScript is
 * paused in the background; the desktop has neither problem.
 *
 * One VOICE per soundscape heard:
 *
 *   generator out 0 (direct) ----------------------------------> voice gain
 *   generator out 1 (send) -> return gain -> convolver A -> gain A -> voice gain
 *                                         -> convolver B -> gain B ->
 *   every voice gain -> mix gain -> bus compressor -> brilliance -> volume -> shared limiter
 *
 * BRILLIANCE (soundscapeBrilliance.ts) is the mix's, not a voice's: three
 * BiquadFilterNodes and a makeup gain, gliding to a new setting; across a
 * change of soundscape they glide over the crossfade.
 *
 * A settings change goes to the current voice: the generator takes it at
 * its next block, the return glides, and a changed ROOM is built on the
 * main thread once the slider has rested (SPACE_REBUILD_DELAY_MS) into the
 * convolver not heard, and crossfaded in over SPACE_CROSSFADE_SEC -- a
 * playing convolver's buffer cannot be swapped without a click. A change of
 * SOUNDSCAPE (`transitionSec` > 0) builds a new voice and crossfades the two
 * voice gains, equal-power, over that time; the old voice is then stopped.
 */
import { buildNoiseLoops, noiseLoopGains, type NoiseLoops } from '../shared/soundscapeNoiseLoops';
import type { SoundscapeSpaceSettings } from '../shared/soundscape';
import { buildSoundscapeImpulseResponse, soundscapeRoomKey } from '../shared/soundscapeSpace';
import type { SoundscapePlayback, SoundscapePlaybackHandlers } from './SoundscapeEngine';
import { connectToOutput, resumedOutputContext } from './audioOutputBus';
import { brillianceCurve, BRILLIANCE_BANDS } from './soundscapeBrilliance';
import { BUS_COMPRESSOR, SOUNDSCAPE_MIX_GAIN, SOUNDSCAPE_SPACE_RETURN, SPACE_CROSSFADE_SEC } from './soundscapeMix';
import type { ConfigureMessage } from './soundscapeRenderAhead';
import generatorUrl from './soundscape-generator.js?url';

/** How long a room slider must rest before its room is built (a drag would otherwise build dozens). */
const SPACE_REBUILD_DELAY_MS = 120;
/** The glide on the tone when brilliance changes. */
const BRILLIANCE_GLIDE_SEC = 0.05;
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
  private readonly rooms: Array<{ convolver: ConvolverNode; gain: GainNode }>;
  private liveRoom = 0;
  private roomKey: string | null = null;
  private roomTimer: number | null = null;
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
    this.rooms = [0, 1].map(() => {
      const convolver = context.createConvolver();
      // The impulse response is calibrated by buildSoundscapeImpulseResponse;
      // the browser's normalisation would rescale away what foliage
      // takes away. Must be set before a buffer is assigned.
      convolver.normalize = false;
      const gain = context.createGain();
      gain.gain.value = 0;
      this.returnGain.connect(convolver);
      convolver.connect(gain);
      gain.connect(this.gain);
      return { convolver, gain };
    });
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
    const key = soundscapeRoomKey(space);
    if (key === this.roomKey) return;
    if (this.roomTimer !== null) window.clearTimeout(this.roomTimer);
    this.roomTimer = null;
    // The first room at once: nothing is heard until it is there.
    if (this.roomKey === null) this.installRoom(space, key);
    else this.roomTimer = window.setTimeout(() => {
      this.roomTimer = null;
      this.installRoom(space, key);
    }, SPACE_REBUILD_DELAY_MS);
  }

  /** Build the room into the convolver not heard and crossfade to it (at once, for the first). */
  private installRoom(space: SoundscapeSpaceSettings, key: string): void {
    const context = this.context;
    const [left, right] = buildSoundscapeImpulseResponse(space, context.sampleRate);
    const buffer = context.createBuffer(2, left.length, context.sampleRate);
    buffer.copyToChannel(left, 0);
    buffer.copyToChannel(right, 1);
    const first = this.roomKey === null;
    const incoming = first ? this.liveRoom : 1 - this.liveRoom;
    const now = context.currentTime;
    this.rooms[incoming].convolver.buffer = buffer;
    for (const [index, room] of this.rooms.entries()) {
      const target = index === incoming ? 1 : 0;
      room.gain.gain.cancelScheduledValues(now);
      if (first) {
        room.gain.gain.setValueAtTime(target, now);
      } else {
        room.gain.gain.setValueAtTime(room.gain.gain.value, now);
        room.gain.gain.linearRampToValueAtTime(target, now + SPACE_CROSSFADE_SEC);
      }
    }
    this.liveRoom = incoming;
    this.roomKey = key;
  }

  /** Fade this voice's gain in or out, equal-power, over `seconds` from now. */
  fade(rising: boolean, seconds: number): void {
    const now = this.context.currentTime;
    this.gain.gain.cancelScheduledValues(now);
    this.gain.gain.setValueCurveAtTime(equalPowerCurve(rising), now, seconds);
  }

  /** Stop the generator and take the voice down. `stop` is what lets the audio thread drop the processor. */
  close(): void {
    if (this.roomTimer !== null) window.clearTimeout(this.roomTimer);
    this.roomTimer = null;
    this.generator.port.postMessage({ type: 'stop' });
    this.generator.disconnect();
    this.returnGain.disconnect();
    for (const room of this.rooms) {
      room.convolver.disconnect();
      room.gain.disconnect();
    }
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
  const bands = BRILLIANCE_BANDS.map((band) => {
    const filter = context.createBiquadFilter();
    filter.type = band.kind;
    filter.frequency.value = band.frequencyHz;
    if (band.kind === 'peaking') filter.Q.value = band.q;
    return filter;
  });
  const makeup = context.createGain();
  mixGain.connect(compressor);
  let tail: AudioNode = compressor;
  for (const filter of bands) {
    tail.connect(filter);
    tail = filter;
  }
  tail.connect(makeup);
  makeup.connect(volume);
  let brilliance: number | null = null;
  /** Glide the tone to `value` with time constant `seconds` (at once, for the first). */
  const setBrilliance = (value: number, seconds: number) => {
    if (value === brilliance) return;
    const curve = brillianceCurve(value, context.sampleRate);
    const now = context.currentTime;
    const targets: Array<[AudioParam, number]> = [
      ...bands.map((filter, index): [AudioParam, number] => [filter.gain, curve.gainsDb[index]]),
      [makeup.gain, curve.makeup],
    ];
    for (const [param, target] of targets) {
      param.cancelScheduledValues(now);
      if (brilliance === null) param.setValueAtTime(target, now);
      else param.setTargetAtTime(target, now, seconds);
    }
    brilliance = value;
  };
  connectToOutput(volume);

  let closed = false;
  const fail = (message: string) => {
    if (!closed) handlers.onFailure(message);
  };
  let voice = new Voice(context, mixGain, fail);
  /** Voices fading out after a change of soundscape, each with its timer. */
  const leaving = new Map<Voice, number>();

  return {
    configure(configuration, transitionSec) {
      setBrilliance(configuration.space.brilliance, transitionSec > 0 ? transitionSec / 3 : BRILLIANCE_GLIDE_SEC);
      if (transitionSec <= 0) {
        voice.configure(configuration);
        return;
      }
      const old = voice;
      voice = new Voice(context, mixGain, fail);
      voice.configure(configuration);
      voice.fade(true, transitionSec);
      old.fade(false, transitionSec);
      leaving.set(old, window.setTimeout(() => {
        leaving.delete(old);
        old.close();
      }, (transitionSec * 1000) + 100));
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
      for (const filter of bands) filter.disconnect();
      makeup.disconnect();
      compressor.disconnect();
      volume.disconnect();
    },
  };
}
