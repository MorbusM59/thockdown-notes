/**
 * Ambient sound generator: the AudioWorklet that synthesises every ambient
 * layer, sample by sample, on the audio thread.
 *
 * It is plain JavaScript under public/ because an AudioWorklet module is
 * loaded by URL and cannot import the app's TypeScript. The settings it reads
 * are defined in src/shared/ambientSound.ts; the engine
 * (src/sound/AmbientSoundEngine.ts) posts them here as a `configure` message.
 *
 * Outputs: output 0 is the stereo mix of every noise layer's direct sound.
 * Each rain layer is mono and goes to output `1 + outputIndex`, where
 * `outputIndex` is set by the engine per channel (-1 for a noise layer), so
 * the engine can pan, filter and reverb each rain layer on its own. The
 * stereo output at `processorOptions.noiseSendOutput` carries the noise
 * layers' reverb sends, which the engine feeds to the same reverb as the
 * rain. The worklet does not know how many rain slots exist; it writes to
 * whichever outputs it was given.
 *
 * Everything random is a seeded linear congruential generator, so a test can
 * render the same sound twice. The processor's root stream only seeds; each
 * channel draws from its own stream, and each rain voice's click noise from
 * its own again. Streams keep every layer's sound independent of the order
 * the others are rendered in, which is what lets rendering go a whole block
 * per voice rather than a sample at a time across everything (see process).
 *
 * Render cost is the constraint everything here is written against: a block
 * is 128 frames, under 3 ms at 48 kHz, on a real-time thread shared with the
 * rest of the audio -- music included. A block that runs late is heard as a
 * tear, and it also delays the next `configure` message, so a preset change
 * seems not to take. Hence:
 * - work that repeats is done once. Noise is read from loops rendered on the
 *   main thread (src/shared/ambientNoiseLoops.ts); rain drops are played
 *   back from a per-layer bank of recordings, a quarter of them recorded
 *   live as they play so the bank keeps changing (addVoice).
 * - what changes slowly is computed slowly. A noise layer's level and pan
 *   are computed every CONTROL_FRAMES samples and ramped between.
 * - nothing large is allocated while playing: the garbage collector pauses
 *   this thread, so recording buffers are recycled (takeSpareRecording).
 * - no trigonometry per sample (oscillators are rotated sin/cos pairs), no
 *   work for a component that has gone silent, one tight loop per voice.
 */

/**
 * What rain falls on is one number, `surface`, from 0 to 1 -- softest to
 * hardest -- and every drop, on any surface, is the same model:
 * - `click`: the impact, a burst of noise whose amplitude and decay are
 *   drawn from the ranges given. `white` blends it from band-passed (0,
 *   centre and Q as given) to unfiltered white noise (1).
 * - `bass`, `body`, `treble`: banks of decaying sinusoidal modes -- the
 *   surface ringing. `count` modes per bank (an integer range), frequency
 *   log-uniform in `hz`, decay and amplitude uniform in theirs.
 * - `bed`: the dense wash of distant drops. Impulses at `ratePerSec` with a
 *   noise floor, band-passed around `centerHz`, slowly swelling by up to
 *   `swellDepth` so it does not sound like a static noise generator.
 * - `drip`: a large, slow drop. `gain` scales it, `pitchScale` lowers its
 *   frequencies.
 *
 * The surface is the MATERIAL only. Standing water on it is the layer's
 * `wetness`, and how much the material rings is its `resonance` (see
 * makeSurfaceVoice); both apply on top of any surface.
 *
 * Three ANCHORS pin the scale: forest (0: a soft, low pat on leaves, a small
 * thud, hardly a bubble), street (0.5: a sharp band-passed tick on pavement
 * and, on a share of drops, the plip of a puddle) and glass (1: a white-noise
 * click and many long-ringing modes -- hail on glass or on metal pipes).
 * Between two anchors every number is blended (surfaceProfile): frequencies,
 * times and rates geometrically, since that is how pitch and time are heard,
 * and everything else linearly.
 *
 * Every anchor must match AMBIENT_RAIN_SURFACE_ANCHORS in
 * src/shared/ambientSound.ts, name and position; ambient-generator.test.ts
 * checks that.
 */
const GLASS_TREBLE = { count: [1, 3], hz: [2100, 9200], decaySec: [0.004, 0.035], amplitude: [0.018, 0.075] };
const NO_TREBLE = { ...GLASS_TREBLE, count: [0, 0] };
const RAIN_SURFACE_ANCHORS = [
  {
    name: 'forest',
    at: 0,
    click: { white: 0, centerHz: [700, 2600], q: 1.3, decaySec: [0.004, 0.012], amplitude: [1, 1.8] },
    durationSec: 0.2,
    bass: { count: [1, 1], hz: [110, 320], decaySec: [0.015, 0.05], amplitude: [0.04, 0.09] },
    body: { count: [1, 2], hz: [450, 1400], decaySec: [0.004, 0.012], amplitude: [0.012, 0.035] },
    treble: NO_TREBLE,
    bed: { ratePerSec: 1700, centerHz: 1900, q: 0.8, floor: 0.16, gain: 0.6, swellDepth: 0.45 },
    drip: { gain: 3, pitchScale: 0.5 },
  },
  {
    name: 'street',
    at: 0.5,
    click: { white: 0, centerHz: [2200, 7500], q: 0.9, decaySec: [0.0012, 0.004], amplitude: [1.1, 2] },
    durationSec: 0.12,
    bass: { count: [1, 1], hz: [70, 190], decaySec: [0.006, 0.02], amplitude: [0.03, 0.07] },
    body: { count: [0, 1], hz: [900, 2600], decaySec: [0.002, 0.006], amplitude: [0.01, 0.03] },
    treble: NO_TREBLE,
    bed: { ratePerSec: 2600, centerHz: 4200, q: 0.55, floor: 0.2, gain: 0.55, swellDepth: 0.3 },
    drip: { gain: 2.2, pitchScale: 0.6 },
  },
  {
    // The original rain model, exactly: its click and its three banks.
    name: 'glass',
    at: 1,
    click: { white: 1, centerHz: [6000, 9000], q: 0.7, decaySec: [0.00065, 0.00065], amplitude: [0.24, 0.44] },
    durationSec: 0.4,
    bass: { count: [1, 2], hz: [85, 460], decaySec: [0.025, 0.095], amplitude: [0.035, 0.14] },
    body: { count: [2, 4], hz: [360, 3400], decaySec: [0.009, 0.065], amplitude: [0.025, 0.105] },
    treble: GLASS_TREBLE,
    bed: { ratePerSec: 900, centerHz: 6500, q: 0.7, floor: 0.12, gain: 0.5, swellDepth: 0.25 },
    drip: { gain: 1.9, pitchScale: 0.55 },
  },
];

/**
 * The balance a drop's parts were authored at, relative to its body modes:
 * the low bank at AUTHORED_LOW_LEVEL, the click, high bank, bubble and splash
 * at AUTHORED_HIGH_LEVEL. (These were the defaults of the bass and treble
 * sliders that used to adjust them per layer.)
 */
const AUTHORED_LOW_LEVEL = 0.55;
const AUTHORED_HIGH_LEVEL = 0.45;

/** A layer's character when none is given: the surface as authored, dry. */
const NEUTRAL_CHARACTER = { wetness: 0, resonance: 0.5 };

/**
 * Wetness (see makeSurfaceVoice) at 1: the share of drops that land in water
 * and produce a bubble, and of drips; how much of a surface's ring a film of
 * water damps (its decay time shortened, its level lowered); and the
 * splash's level, the bright attack of a drop entering water.
 */
const WET_BUBBLE_CHANCE = 0.7;
const WET_DRIP_BUBBLE_CHANCE = 1;
const WET_DECAY_DAMPING = 0.6;
const WET_LEVEL_DAMPING = 0.4;
const SPLASH_LEVEL = [0.9, 1.6];
/** The splash: a very short burst of bright noise, band-passed high. */
const SPLASH = { centerHz: [6500, 11000], q: 0.8, decaySec: 0.0003 };
/** Spray: finer droplets after a splash -- how many, when, how loud. */
const SPRAY = { count: [1, 4], withinSec: [0.004, 0.045], level: [0.15, 0.45] };

/** Keys whose values blend geometrically (see RAIN_SURFACE_ANCHORS). */
const GEOMETRIC_KEYS = new Set(['centerHz', 'hz', 'decaySec', 'durationSec', 'ratePerSec']);

/** Two anchors' matching values blended at `t`, recursively. */
function blendProfile(a, b, t, key) {
  if (typeof a === 'number') {
    return GEOMETRIC_KEYS.has(key) && a > 0 && b > 0
      ? a * ((b / a) ** t)
      : a + ((b - a) * t);
  }
  if (Array.isArray(a)) return a.map((value, index) => blendProfile(value, b[index], t, key));
  if (a && typeof a === 'object') {
    const blended = {};
    for (const name of Object.keys(a)) {
      // A blend lies between two anchors and is neither of them.
      blended[name] = name === 'name' ? null : blendProfile(a[name], b[name], t, name);
    }
    return blended;
  }
  return a;
}

/** The drop model at `surface` (0-1), blended between its two anchors. */
function surfaceProfile(surface) {
  const at = Number.isFinite(surface) ? Math.max(0, Math.min(1, surface)) : 1;
  for (let index = 1; index < RAIN_SURFACE_ANCHORS.length; index += 1) {
    const lower = RAIN_SURFACE_ANCHORS[index - 1];
    const upper = RAIN_SURFACE_ANCHORS[index];
    if (at === lower.at) return lower;
    if (at === upper.at) return upper;
    if (at < upper.at) return blendProfile(lower, upper, (at - lower.at) / (upper.at - lower.at), '');
  }
  return RAIN_SURFACE_ANCHORS[RAIN_SURFACE_ANCHORS.length - 1];
}

/**
 * A noise layer's `movement` (0-1) at full: how far one cycle's period may
 * stretch or shrink (as a power of two, so 1 is anywhere from half to double),
 * the largest share of the swell's rise one cycle may lose, and the furthest
 * the sway takes the layer from centre.
 */
const MOVEMENT_PERIOD_OCTAVES = 1;
const MOVEMENT_RISE_LOSS = 0.5;
const MOVEMENT_PAN_REACH = 0.6;

/**
 * A noise layer's level and pan move over periods of half a second or more,
 * so they are computed every CONTROL_FRAMES samples and ramped linearly in
 * between (see beginControlSegment) -- a ramp of under a millisecond, about
 * 1/750 of the shortest cycle.
 */
const CONTROL_FRAMES = 32;

/**
 * The drop bank (see addVoice): each rain layer keeps up to DROP_BANK_SIZE
 * drops (DRIP_BANK_SIZE drips) recorded at its current settings, and plays a
 * drop by reading one back. While the bank fills, and on one birth in
 * DROP_BANK_REFRESH_EVERY after that, a drop is instead synthesised live and
 * recorded as it plays -- so a new recording costs what playing it live
 * always cost, spread over its own life rather than rendered in one block;
 * the bank never stops changing, and a quarter of what is heard is new.
 *
 * A recording takes its slot when it is BORN, marked available from the
 * frame it will be complete on (birth plus its fixed length), and playback
 * chooses only among recordings already available. The bank's contents
 * therefore change only at births, which happen in time order, so what any
 * drop plays does not depend on where block boundaries fall.
 * Each playback also varies in level by up to +/-DROP_PLAYBACK_LEVEL_SPREAD,
 * symmetric so the mean level is unchanged, which keeps repeats of one baked
 * drop from sounding alike.
 */
const DROP_BANK_SIZE = 32;
const DRIP_BANK_SIZE = 12;
const DROP_BANK_REFRESH_EVERY = 4;
const DROP_PLAYBACK_LEVEL_SPREAD = 0.15;

/** Samples between re-derivations of a rising bubble's rotation (see makeBubble). */
const BUBBLE_RETUNE_FRAMES = 32;

/** What a noise layer reads when its noise type was not provided. */
const SILENT_LOOP = new Float32Array(1);

/** Below this a click or its filter tail is treated as silent (-140 dB). */
const SILENCE = 1e-7;

/**
 * Below this a voice's ringing parts are treated as silent and the voice
 * ends (-100 dB of full scale, a third of the smallest step 16-bit output can
 * represent -- and the voice is scaled down further by its layer's volume
 * before anyone hears it).
 */
const VOICE_SILENCE = 1e-5;

/**
 * Thunder (startPeal). A peal follows one ENVELOPE: it rolls in gently,
 * builds to a peak a quarter to two fifths of the way through its length
 * (THUNDER_PEAK_AT) and fades slowly over the rest. Everything in it is
 * placed and scaled by that envelope, so the loudest moment is never the
 * first. It is made of two kinds of source:
 * - STROKES: short bursts of pink noise through a low-pass. A lightning
 *   channel is kilometres of jagged segments, each sending its own sharp
 *   pressure pulse, arriving at different times; strokes are those pulses.
 *   They come in CLUSTERS of several in quick succession -- the cascading
 *   "krakakoom" -- at a rate that follows the envelope, sparse while it
 *   rolls in and densest at the peak. Later strokes are darker: their
 *   sound travelled further. They go mostly dry (THUNDER_STROKE_SEND), so
 *   their attacks keep their definition.
 * - the BED: a few long rumbles of brown noise through a lower low-pass,
 *   each swelling to the peak and dying with the envelope, with a fast,
 *   uneven roll in level -- a growl rather than a swell. The bed is what
 *   the reverb carries.
 * Character (0..1) moves the balance from the bed (a smooth roll) toward
 * the strokes (a cracking cascade). Distance blends each figure
 * geometrically between its near and far end: far thunder is darker,
 * quieter and its strokes are smeared longer.
 * Every source starts from silence over at least a few milliseconds, and
 * the envelope keeps the first strokes quiet: this plays beside someone
 * concentrating, and a clap from nowhere is a fright, not atmosphere.
 */
const THUNDER_PEAK_AT = [0.22, 0.4];
const THUNDER_LEVEL = { near: 1, far: 0.6 };
const THUNDER_BED_RUMBLES = [2, 4];
const THUNDER_BED_CUTOFF_HZ = { near: 380, far: 80 };
/**
 * Average seconds between a bed rumble's roll targets, and the lowest
 * target at character 0 and 1: a smooth roll only undulates, an angry one
 * growls down to near nothing between surges.
 */
const THUNDER_ROLL_SEC = [0.08, 0.35];
const THUNDER_ROLL_FLOOR = [0.6, 0.15];
/** Clusters per second at the envelope's peak, at character 0 and 1. */
const THUNDER_CLUSTER_RATE = [0.4, 1.8];
/** Strokes in a cluster, at character 0 and 1 (drawn up to this). */
const THUNDER_CLUSTER_STROKES = [2, 6];
const THUNDER_STROKE_GAP_SEC = [0.05, 0.18];
const THUNDER_STROKE_SEC = [0.03, 0.14];
const THUNDER_STROKE_ATTACK_SEC = 0.006;
/** How much longer a stroke is at the far end: distance smears it. */
const THUNDER_STROKE_SMEAR = { near: 1, far: 3 };
const THUNDER_STROKE_CUTOFF_HZ = { near: 3000, far: 280 };
/** A stroke's share of the reverb send, against the bed's 1. */
const THUNDER_STROKE_SEND = 0.25;
/** The first peal of a storm that has just started comes within this many seconds. */
const THUNDER_FIRST_PEAL_SEC = [4, 12];

/** The most rain voices one layer keeps ringing at once. */
const MAX_RAIN_VOICES = 48;

/** Large drops per second at `drips` = 1; mirrors AMBIENT_RAIN_DRIPS_MAX_PER_SEC. */
const RAIN_DRIPS_MAX_PER_SEC = 3;

/** Average seconds between the bed's swell targets. */
const BED_SWELL_PERIOD_SEC = 2.5;

/**
 * A state-variable filter's coefficients and state (the topology-preserving
 * "TPT" form, stable at any frequency below Nyquist). One filter has band-
 * and low-pass outputs: v1 and v2 of the step in bandPass. Band-pass is read
 * through bandPass; the low-pass (distance's darkening) is read inline in
 * renderNoise, unrolled for cost.
 */
function stateVariableFilter(centerHz, q) {
  const safeHz = Math.max(20, Math.min(centerHz, sampleRate * 0.45));
  const g = Math.tan((Math.PI * safeHz) / sampleRate);
  const k = 1 / q;
  const a1 = 1 / (1 + (g * (g + k)));
  return { a1, a2: g * a1, a3: g * g * a1, s1: 0, s2: 0 };
}

/** One sample through a stateVariableFilter; returns its low-pass output. */
function lowPassStep(filter, input) {
  const v3 = input - filter.s2;
  const v1 = (filter.a1 * filter.s1) + (filter.a2 * v3);
  const v2 = filter.s2 + (filter.a2 * filter.s1) + (filter.a3 * v3);
  filter.s1 = (2 * v1) - filter.s1;
  filter.s2 = (2 * v2) - filter.s2;
  return v2;
}

/** One sample through a stateVariableFilter; returns its band-pass output. */
function bandPass(filter, input) {
  const v3 = input - filter.s2;
  const v1 = (filter.a1 * filter.s1) + (filter.a2 * v3);
  const v2 = filter.s2 + (filter.a2 * filter.s1) + (filter.a3 * v3);
  filter.s1 = (2 * v1) - filter.s1;
  filter.s2 = (2 * v2) - filter.s2;
  return v1;
}

class AmbientGenerator extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.rootStream = { seed: (options?.processorOptions?.seed ?? 1) >>> 0 };
    this.noiseSendOutput = options?.processorOptions?.noiseSendOutput ?? -1;
    // One seamless loop per noise type, rendered on the main thread
    // (src/shared/ambientNoiseLoops.ts) and read by every noise layer.
    this.noiseLoops = options?.processorOptions?.noiseLoops ?? {};
    // The stream `random()` draws from: the channel being configured or
    // rendered, else the root. Set by withStream.
    this.stream = this.rootStream;
    this.channels = [];
    this.soloChannelId = null;
    this.port.onmessage = (event) => {
      if (event.data?.type !== 'configure') return;
      this.configure(event.data.channels ?? []);
    };
  }

  random() {
    const stream = this.stream;
    stream.seed = (1664525 * stream.seed + 1013904223) >>> 0;
    return stream.seed / 0x100000000;
  }

  /** Run `work` with `random()` drawing from `stream`, then restore. */
  withStream(stream, work) {
    const previous = this.stream;
    this.stream = stream;
    try {
      return work();
    } finally {
      this.stream = previous;
    }
  }

  between(range) {
    return range[0] + (this.random() * (range[1] - range[0]));
  }

  /** Frames until the next event of a Poisson process at `ratePerSecond`. */
  eventDelayFrames(ratePerSecond) {
    const safeRate = Math.max(0.1, ratePerSecond);
    return Math.max(1, Math.floor((-Math.log(Math.max(1e-9, 1 - this.random())) / safeRate) * sampleRate));
  }

  makeChannel(settings) {
    const stream = { seed: Math.floor(this.random() * 0x100000000) >>> 0 };
    return this.withStream(stream, () => this.initChannel(settings, stream));
  }

  initChannel(settings, stream) {
    const channel = {
      ...settings,
      stream,
      // Where this layer reads the shared noise loop, as a fraction of it;
      // the right side reads half a loop away, so the two are unrelated.
      loopStart: this.random(),
      loopLeft: -1,
      loopRight: -1,
      controlFramesLeft: 0,
      controlReady: false,
      level: 0,
      levelStep: 0,
      gainLeft: 1,
      gainLeftStep: 0,
      gainRight: 1,
      gainRightStep: 0,
      phase: this.random(),
      // Movement's per-cycle draw (see startCycle). The neutral values make
      // a layer with no movement play exactly as one without the feature.
      periodFactor: 1,
      riseFactor: 1,
      swaySide: 0,
      panFrom: 0,
      panTo: 0,
      nextEventFrame: 0,
      activeVoices: [],
      nextDripFrame: Infinity,
      bed: null,
      // The tone filter (configureFilter): a two-pole state-variable filter
      // per side, or none.
      toneLeft: null,
      toneRight: null,
      toneHighPass: false,
      toneDamping: 0,
      toneGain: 1,
      // Distance's darkening (configureSpace): a two-pole low-pass per side.
      darkLeft: null,
      darkRight: null,
      widthDirect: 1,
      widthCross: 0,
    };
    this.configureFilter(channel);
    if (channel.kind === 'noise') this.configureSpace(channel);
    if (channel.kind === 'thunder') this.configureThunder(channel, null);
    if (channel.kind === 'rain') {
      channel.nextEventFrame = currentFrame + this.eventDelayFrames(settings.dropsPerSecond);
      this.configureRain(channel, null);
    }
    return channel;
  }

  /**
   * Replace the channel list. A channel that keeps its id keeps its running
   * state (voices, filter memory, the noise cycle's phase) so a slider move
   * does not click; only a change to a drop rate reschedules the next drop.
   */
  configure(settings) {
    this.soloChannelId = settings.find((channel) => channel.solo)?.id ?? null;
    const activeSettings = settings.filter((channel) => channel.enabled !== false);
    const previousById = new Map(this.channels.map((channel) => [channel.id, channel]));
    this.channels = activeSettings.map((next) => {
      const previous = previousById.get(next.id);
      if (!previous) return this.makeChannel(next);
      return this.withStream(previous.stream, () => {
        const before = { ...previous };
        if (next.kind === 'rain' && previous.dropsPerSecond !== next.dropsPerSecond) {
          previous.nextEventFrame = currentFrame + this.eventDelayFrames(next.dropsPerSecond);
        }
        Object.assign(previous, next);
        this.configureFilter(previous);
        if (previous.kind === 'noise') this.configureSpace(previous);
        if (previous.kind === 'thunder') this.configureThunder(previous, before);
        if (previous.kind === 'rain') this.configureRain(previous, before);
        return previous;
      });
    });
  }

  /**
   * A noise layer's tone filter, from the slider as resolved on the main
   * thread (src/shared/ambientSoundDsp.ts's resolveNoiseTone: which mode, the
   * cutoff, the resonance and the gain that keeps the layer's loudness). A
   * slider move changes only the coefficients: the filters keep their memory,
   * so moving it does not click.
   */
  configureFilter(channel) {
    const tone = channel.tone;
    if (!tone || tone.mode === 'none') {
      channel.toneLeft = null;
      channel.toneRight = null;
      channel.toneGain = 1;
      return;
    }
    const left = stateVariableFilter(tone.cutoffHz, tone.q);
    const right = stateVariableFilter(tone.cutoffHz, tone.q);
    if (channel.toneLeft) {
      left.s1 = channel.toneLeft.s1;
      left.s2 = channel.toneLeft.s2;
      right.s1 = channel.toneRight.s1;
      right.s2 = channel.toneRight.s2;
    }
    channel.toneLeft = left;
    channel.toneRight = right;
    channel.toneHighPass = tone.mode === 'highpass';
    channel.toneDamping = 1 / tone.q;
    channel.toneGain = tone.gain;
  }

  /**
   * A noise layer's width and distance, turned into what renderNoise needs.
   *
   * Width blends the two unrelated noise reads: each side takes
   * cos(t) of its own and sin(t) of the other, t = (1 - width) * pi/4. At
   * width 1 that is the two reads as they are; at 0 both sides are the same
   * sum. cos^2 + sin^2 = 1, so for unrelated noise the level is the same at
   * every width.
   *
   * Distance arrives resolved (`space`, from resolveAmbientSpace -- the rule
   * the rain layers use). Its darkening is a two-pole low-pass at Q 0.707,
   * the same response as the BiquadFilterNode that darkens a rain layer; its
   * direct and reverb-send gains are applied when the layer is mixed
   * (process). At distance 0 there is no darkening filter at all, so a near
   * layer is untouched.
   */
  configureSpace(channel) {
    const angle = (1 - (channel.width ?? 1)) * Math.PI / 4;
    channel.widthDirect = Math.cos(angle);
    channel.widthCross = Math.sin(angle);
    const space = channel.space ?? { cutoffHz: 18000, directGain: 1, reverbSend: 0 };
    channel.directGain = space.directGain;
    channel.reverbSend = space.reverbSend;
    if ((channel.distance ?? 0) <= 0) {
      channel.darkLeft = null;
      channel.darkRight = null;
      return;
    }
    // Keep the filters' memory through a slider move; only the coefficients change.
    const left = stateVariableFilter(space.cutoffHz, Math.SQRT1_2);
    const right = stateVariableFilter(space.cutoffHz, Math.SQRT1_2);
    if (channel.darkLeft) {
      left.s1 = channel.darkLeft.s1;
      left.s2 = channel.darkLeft.s2;
      right.s1 = channel.darkRight.s1;
      right.s2 = channel.darkRight.s2;
    }
    channel.darkLeft = left;
    channel.darkRight = right;
  }



  /**
   * Bring a rain channel's surface-dependent state in line with its
   * settings. `before` is the channel as it was (null for a new one): the
   * bed filter is rebuilt only when the surface changed, so it keeps its
   * memory through other edits, and the drip clock is rescheduled only when
   * the drip rate changed.
   */
  configureRain(channel, before) {
    const profile = surfaceProfile(channel.surface);
    channel.profile = profile;
    if (!channel.bed || before?.surface !== channel.surface) {
      channel.bed = {
        // Its own stream, so the bed's per-sample draws and the voices'
        // births each stay in time order whatever the block size.
        stream: { seed: Math.floor(this.random() * 0x100000000) >>> 0 },
        filter: stateVariableFilter(profile.bed.centerHz, profile.bed.q),
        swell: 1,
        swellTarget: 1,
        swellFrames: 0,
      };
    }
    // A baked drop has the surface and the bass and treble levels in it, so
    // a change to any of them empties the bank (drops already playing keep
    // theirs). It refills from the drops that fall next.
    // Recordings still under way go with them: they keep playing, but into
    // an entry nothing refers to any more.
    if (!channel.dropBank || !before || before.surface !== channel.surface
      || before.wetness !== channel.wetness || before.resonance !== channel.resonance) {
      if (!channel.spareRecordings) channel.spareRecordings = [];
      for (const entry of [...(channel.dropBank ?? []), ...(channel.dripBank ?? [])]) {
        this.evictRecording(channel, entry);
      }
      channel.dropBank = [];
      channel.dripBank = [];
    }
    const dripRate = (channel.drips ?? 0) * RAIN_DRIPS_MAX_PER_SEC;
    if (!before || before.drips !== channel.drips) {
      channel.nextDripFrame = dripRate > 0
        ? currentFrame + this.eventDelayFrames(dripRate)
        : Infinity;
    }
  }

  /**
   * A new cycle has begun (the phase just wrapped, so the level is at its
   * trough and flat): roll this cycle's deviations, scaled by `movement`.
   * - the period is multiplied by 2^(movement * u), u uniform in -1..1, so
   *   the mean tempo is still the period set;
   * - the rise above the trough keeps a random share of itself, never less
   *   than 1 - movement * MOVEMENT_RISE_LOSS -- the trough stays where it is,
   *   so the swap cannot make the level jump;
   * - the sway moves to the OTHER side of centre from where it was heading,
   *   by a random reach up to movement * MOVEMENT_PAN_REACH, starting from
   *   wherever it is now. The first cycle with movement picks a side at
   *   random, so several layers do not all swing together.
   * With no movement nothing is drawn from the random stream and every
   * factor is neutral, so the layer renders exactly as it always has.
   */
  startCycle(channel) {
    const movement = channel.movement ?? 0;
    if (movement <= 0) {
      channel.periodFactor = 1;
      channel.riseFactor = 1;
      channel.panFrom = channel.panTo;
      channel.panTo = 0;
      return;
    }
    channel.periodFactor = 2 ** (movement * MOVEMENT_PERIOD_OCTAVES * ((this.random() * 2) - 1));
    channel.riseFactor = 1 - (movement * MOVEMENT_RISE_LOSS * this.random());
    channel.swaySide = channel.swaySide === 0 ? (this.random() < 0.5 ? -1 : 1) : -channel.swaySide;
    channel.panFrom = channel.panTo;
    channel.panTo = channel.swaySide * movement * MOVEMENT_PAN_REACH * (0.5 + (0.5 * this.random()));
  }

  /**
   * Where the sway is at `phase`: travelling from panFrom to panTo so that
   * it is halfway exactly at the swell's peak (phase = shape), on a
   * smoothstep so it leaves and arrives at rest. The sound therefore sweeps
   * past while it is loudest, like a gust going by.
   */
  swayAt(channel, phase) {
    const peak = channel.shape ?? 0.5;
    const progress = phase <= peak
      ? (peak > 0 ? 0.5 * (phase / peak) : 0.5)
      : 0.5 + (0.5 * ((phase - peak) / Math.max(1e-9, 1 - peak)));
    const eased = progress * progress * (3 - (2 * progress));
    return channel.panFrom + ((channel.panTo - channel.panFrom) * eased);
  }

  /**
   * The loop for a noise type. A type the engine did not provide plays as
   * silence rather than failing the whole generator.
   */
  noiseLoop(type) {
    return this.noiseLoops[type] ?? SILENT_LOOP;
  }

  /**
   * The noise cycle's value (-1..1) at `phase` (0..1), interpolated from the
   * table the engine built (src/shared/ambientSoundDsp.ts's buildNoiseCycle).
   * A layer configured without one plays a plain sine.
   */
  cycleAt(channel, phase) {
    const cycle = channel.cycle;
    if (!cycle?.length) return -Math.cos(2 * Math.PI * phase);
    const position = phase * (cycle.length - 1);
    const low = Math.floor(position);
    const high = Math.min(cycle.length - 1, low + 1);
    return cycle[low] + ((cycle[high] - cycle[low]) * (position - low));
  }

  /**
   * `count` decaying sinusoids, frequencies log-uniform in the range, each
   * advanced by rotating a (sin, cos) pair so no trigonometry runs per
   * sample.
   */
  makeRainModes(count, minFrequency, maxFrequency, minDecay, maxDecay, minAmplitude, maxAmplitude) {
    const highestFrequency = Math.max(minFrequency, Math.min(maxFrequency, sampleRate * 0.45));
    const modes = [];
    for (let index = 0; index < count; index += 1) {
      const frequency = minFrequency * Math.pow(highestFrequency / minFrequency, this.random());
      const phase = this.random() * Math.PI * 2;
      const angle = (Math.PI * 2 * frequency) / sampleRate;
      const decaySeconds = minDecay + (this.random() * (maxDecay - minDecay));
      modes.push({
        frequency,
        sin: Math.sin(phase),
        cos: Math.cos(phase),
        rotationSin: Math.sin(angle),
        rotationCos: Math.cos(angle),
        amplitude: minAmplitude + (this.random() * (maxAmplitude - minAmplitude)),
        decay: Math.exp(-1 / (sampleRate * decaySeconds)),
      });
    }
    return modes;
  }

  /**
   * A bank of modes from a profile's spec: an integer count drawn uniformly
   * from its range, frequencies scaled by `pitchScale` (a drip is lower).
   */
  makeModesFromSpec(spec, pitchScale) {
    const low = Math.round(spec.count[0]);
    const high = Math.round(spec.count[1]);
    const count = low + Math.floor(this.random() * (high - low + 1));
    return this.makeRainModes(
      count,
      spec.hz[0] * pitchScale,
      spec.hz[1] * pitchScale,
      spec.decaySec[0],
      spec.decaySec[1],
      spec.amplitude[0],
      spec.amplitude[1],
    );
  }

  sampleRainModes(modes) {
    let sample = 0;
    for (const mode of modes) {
      sample += mode.sin * mode.amplitude;
      const nextSin = (mode.sin * mode.rotationCos) + (mode.cos * mode.rotationSin);
      mode.cos = (mode.cos * mode.rotationCos) - (mode.sin * mode.rotationSin);
      mode.sin = nextSin;
      mode.amplitude *= mode.decay;
    }
    return sample;
  }



  /**
   * A bubble resonance, after van den Doel's model of liquid sounds: a
   * bubble of radius r rings near 3/r Hz (Minnaert), damps at a rate set by
   * r, and its pitch rises linearly as it nears the surface.
   */
  makeBubble(radiusMm, gain) {
    const radius = radiusMm / 1000;
    const damping = (0.13 / radius) + (0.0072 * (radius ** -1.5));
    const rise = (0.05 + (this.random() * 0.15)) * damping;
    const bubble = {
      ringFrames: Math.ceil((5 * sampleRate) / damping),
      // Advanced like a mode: a (sin, cos) pair rotated by a fixed angle per
      // sample, so no trigonometry runs per sample. The pitch rise is far
      // too slow to hear within BUBBLE_RETUNE_FRAMES, so the rotation is
      // re-derived only that often, jumping the frequency by the rise those
      // frames have accumulated.
      sin: 0,
      cos: 1,
      rotationSin: 0,
      rotationCos: 1,
      frequency: Math.min(3 / radius, sampleRate * 0.4),
      retuneFactor: (1 + (rise / sampleRate)) ** BUBBLE_RETUNE_FRAMES,
      framesToRetune: BUBBLE_RETUNE_FRAMES,
      amplitude: gain * Math.min(1, radiusMm / 2.5) * 0.35,
      decay: Math.exp(-damping / sampleRate),
    };
    this.tuneBubble(bubble);
    return bubble;
  }

  tuneBubble(bubble) {
    const angle = (2 * Math.PI * bubble.frequency) / sampleRate;
    bubble.rotationSin = Math.sin(angle);
    bubble.rotationCos = Math.cos(angle);
  }

  sampleBubble(bubble) {
    const sample = bubble.sin * bubble.amplitude;
    const nextSin = (bubble.sin * bubble.rotationCos) + (bubble.cos * bubble.rotationSin);
    bubble.cos = (bubble.cos * bubble.rotationCos) - (bubble.sin * bubble.rotationSin);
    bubble.sin = nextSin;
    bubble.amplitude *= bubble.decay;
    bubble.framesToRetune -= 1;
    if (bubble.framesToRetune === 0) {
      bubble.framesToRetune = BUBBLE_RETUNE_FRAMES;
      bubble.frequency = Math.min(bubble.frequency * bubble.retuneFactor, sampleRate * 0.45);
      this.tuneBubble(bubble);
    }
    return sample;
  }

  /**
   * One drop on the surface `profile` describes (surfaceProfile), shaped by
   * the layer's `character`:
   * - `resonance` (0-1): how much the material rings. 0.5 is the surface as
   *   authored; below it the modes grow quieter, reaching none at 0 (only
   *   the impact); above it they ring longer, up to twice as long at 1.
   *   Decay time scales by 2^(2 * resonance - 1), level by
   *   min(1, 2 * resonance).
   * - `wetness` (0-1): standing water. It damps the ring (a film of water
   *   deadens a surface), sends a share of drops into the water, where they
   *   splash -- a very short bright attack, then a few finer spray ticks --
   *   and trap a bubble, whose rising "plip" follows.
   * A drip is the same drop made larger: louder, lower, its click slower and
   * its life twice as long, and likelier to land in water.
   */
  makeSurfaceVoice(profile, isDrip, character = NEUTRAL_CHARACTER) {
    const click = profile.click;
    const wetness = character.wetness;
    const resonance = character.resonance;
    const pitchScale = isDrip ? profile.drip.pitchScale : 1;
    const decaySec = this.between(click.decaySec) * (isDrip ? 1.8 : 1);
    const ringDecay = (2 ** ((2 * resonance) - 1)) * (1 - (WET_DECAY_DAMPING * wetness));
    const ringLevel = Math.min(1, 2 * resonance) * (1 - (WET_LEVEL_DAMPING * wetness));
    const voice = {
      age: 0,
      durationFrames: Math.ceil(sampleRate * profile.durationSec * (isDrip ? 2 : 1) * Math.max(1, ringDecay)),
      gain: isDrip ? profile.drip.gain : 1,
      transientAmplitude: this.between(click.amplitude),
      transientDecay: Math.exp(-1 / (sampleRate * decaySec)),
      // Fully white needs no filter at all; anything less blends one in.
      transientFilter: click.white >= 1 ? null : stateVariableFilter(this.between(click.centerHz) * pitchScale, click.q),
      transientWhite: click.white,
      clickSeed: 0,
      bassModes: this.shapeModes(this.makeModesFromSpec(profile.bass, pitchScale), ringLevel, ringDecay),
      bodyModes: this.shapeModes(this.makeModesFromSpec(profile.body, pitchScale), ringLevel, ringDecay),
      trebleModes: this.shapeModes(this.makeModesFromSpec(profile.treble, pitchScale), ringLevel, ringDecay),
      bubble: null,
      splashAmplitude: 0,
      splashDecay: Math.exp(-1 / (sampleRate * SPLASH.decaySec)),
      splashFilter: null,
      sprayFrames: [],
      sprayLevels: [],
    };
    const bubbleChance = Math.min(1, wetness * (isDrip ? WET_DRIP_BUBBLE_CHANCE : WET_BUBBLE_CHANCE));
    if (bubbleChance > 0 && this.random() < bubbleChance) {
      const radiusMm = isDrip ? this.between([2.5, 5]) : this.between([0.8, 2.6]);
      voice.bubble = this.makeBubble(radiusMm, 1);
      voice.durationFrames = Math.max(voice.durationFrames, voice.bubble.ringFrames);
      voice.splashAmplitude = this.between(SPLASH_LEVEL) * wetness;
      voice.splashFilter = stateVariableFilter(this.between(SPLASH.centerHz), SPLASH.q);
      const sprays = Math.round(SPRAY.count[0] + (this.random() * (SPRAY.count[1] - SPRAY.count[0]) * wetness));
      for (let index = 0; index < sprays; index += 1) {
        voice.sprayFrames.push(Math.round(this.between(SPRAY.withinSec) * sampleRate));
        voice.sprayLevels.push(this.between(SPRAY.level) * voice.splashAmplitude);
      }
    }
    return voice;
  }

  /** A bank of modes with its level and decay time scaled (see makeSurfaceVoice). */
  shapeModes(modes, level, decayScale) {
    for (const mode of modes) {
      mode.amplitude *= level;
      // decay is exp(-1 / (sampleRate * t)): scaling t by k raises it to 1/k.
      mode.decay = mode.decay ** (1 / decayScale);
    }
    return level > 0 ? modes : [];
  }



  /**
   * The bed, a block at a time, added into `out`: sparse random impulses plus
   * a noise floor, band-passed, with a slow random swell. Nothing is drawn
   * while `wash` is 0.
   */
  renderBed(channel, out, length) {
    const wash = channel.wash ?? 0;
    if (wash <= 0) return;
    this.withStream(channel.bed.stream, () => this.renderBedFrom(channel, out, length, wash));
  }

  renderBedFrom(channel, out, length, wash) {
    const spec = channel.profile.bed;
    const bed = channel.bed;
    const filter = bed.filter;
    const impulseChance = spec.ratePerSec / sampleRate;
    const swellRate = 1 / (sampleRate * 0.8);
    const scale = spec.gain * wash;
    for (let index = 0; index < length; index += 1) {
      if (bed.swellFrames <= 0) {
        bed.swellTarget = 1 - (spec.swellDepth * this.random());
        bed.swellFrames = this.eventDelayFrames(1 / BED_SWELL_PERIOD_SEC);
      }
      bed.swellFrames -= 1;
      bed.swell += (bed.swellTarget - bed.swell) * swellRate;
      const impulse = this.random() < impulseChance ? ((this.random() * 2) - 1) : 0;
      const floor = ((this.random() * 2) - 1) * spec.floor;
      out[index] += bandPass(filter, impulse + floor) * scale * bed.swell;
    }
  }

  /**
   * Start the drops and drips whose time falls inside this block. A voice
   * born mid-block records the frame it starts on (`startOffset`) and is
   * silent before it, so timing is still sample-accurate.
   */
  birthVoices(channel, blockStart, length) {
    const blockEnd = blockStart + length;
    // A clock that fell behind -- its layer was paused at volume 0 -- starts
    // afresh from now rather than delivering every drop it missed at once.
    if (channel.nextEventFrame < blockStart) {
      channel.nextEventFrame = blockStart + this.eventDelayFrames(channel.dropsPerSecond);
    }
    if (channel.nextDripFrame < blockStart) {
      channel.nextDripFrame = blockStart + this.eventDelayFrames(channel.drips * RAIN_DRIPS_MAX_PER_SEC);
    }
    // Drops and drips are born in time order, whichever clock is next, so
    // the channel's stream is drawn in the same order whatever the block
    // size (a drip born after a later drop would reorder the draws at block
    // boundaries and change every drop that follows).
    for (;;) {
      const isDrip = channel.nextDripFrame < channel.nextEventFrame;
      const at = isDrip ? channel.nextDripFrame : channel.nextEventFrame;
      if (at >= blockEnd) break;
      this.addVoice(channel, isDrip, at - blockStart, at);
      if (isDrip) channel.nextDripFrame += this.eventDelayFrames(channel.drips * RAIN_DRIPS_MAX_PER_SEC);
      else channel.nextEventFrame += this.eventDelayFrames(channel.dropsPerSecond);
    }
  }

  /**
   * Start one drop (or drip) at absolute frame `at`, `offset` frames into
   * the block: play one back from the layer's bank, or synthesise a new one
   * live and record it -- while the bank is filling, and on one birth in
   * DROP_BANK_REFRESH_EVERY once it is full. A live drop with nothing ready
   * to play back yet (early in a fill) is synthesised without recording.
   */
  addVoice(channel, isDrip, offset, at) {
    if (channel.activeVoices.length >= MAX_RAIN_VOICES) return;
    const bank = isDrip ? channel.dripBank : channel.dropBank;
    const size = isDrip ? DRIP_BANK_SIZE : DROP_BANK_SIZE;
    const startOffset = Math.max(0, offset);
    let slot = -1;
    if (bank.length < size) {
      slot = bank.length;
    } else if (this.random() * DROP_BANK_REFRESH_EVERY < 1) {
      slot = Math.floor(this.random() * size);
    }
    if (slot < 0) {
      const ready = this.readyRecordings(bank, at);
      if (ready.length > 0) {
        const entry = ready[Math.floor(this.random() * ready.length)];
        entry.users += 1;
        channel.activeVoices.push({
          live: null,
          entry,
          position: 0,
          startOffset,
          level: 1 + (DROP_PLAYBACK_LEVEL_SPREAD * ((this.random() * 2) - 1)),
        });
        return;
      }
    }
    const live = this.makeSurfaceVoice(channel.profile, isDrip, channel);
    live.startOffset = startOffset;
    live.clickSeed = Math.floor(this.random() * 0x100000000) >>> 0;
    let entry = null;
    if (slot >= 0) {
      const buffer = this.takeSpareRecording(channel, live.durationFrames);
      entry = {
        buffer,
        samples: buffer.subarray(0, live.durationFrames),
        audibleLength: live.durationFrames,
        availableFrom: at + live.durationFrames,
        // The recording voice is its first user; inBank until replaced.
        users: 1,
        inBank: true,
      };
      if (bank[slot]) this.evictRecording(channel, bank[slot]);
      bank[slot] = entry;
    }
    channel.activeVoices.push({ live, entry, position: 0, startOffset, level: 1 });
  }

  /**
   * Recording buffers are recycled rather than left to the garbage
   * collector, whose pauses on this thread are heard as tears: a recording
   * returns its buffer to the layer's spares once it is out of the bank AND
   * no voice is playing it, and a new recording takes a spare first.
   */
  takeSpareRecording(channel, length) {
    const spares = channel.spareRecordings;
    for (let index = spares.length - 1; index >= 0; index -= 1) {
      if (spares[index].length >= length) {
        const buffer = spares[index];
        spares[index] = spares[spares.length - 1];
        spares.pop();
        return buffer;
      }
    }
    return new Float32Array(length);
  }

  evictRecording(channel, entry) {
    entry.inBank = false;
    this.releaseRecordingIfUnused(channel, entry);
  }

  releaseRecording(channel, entry) {
    entry.users -= 1;
    this.releaseRecordingIfUnused(channel, entry);
  }

  releaseRecordingIfUnused(channel, entry) {
    if (entry.inBank || entry.users > 0 || !entry.buffer) return;
    // At most a bank's worth of spares; beyond that the buffer is let go.
    if (channel.spareRecordings.length < DROP_BANK_SIZE + DRIP_BANK_SIZE) channel.spareRecordings.push(entry.buffer);
    entry.buffer = null;
  }

  /** The recordings in `bank` complete by frame `at`. */
  readyRecordings(bank, at) {
    const ready = [];
    for (let index = 0; index < bank.length; index += 1) {
      if (bank[index].availableFrom <= at) ready.push(bank[index]);
    }
    return ready;
  }

  /**
   * A live drop for the rest of this block: synthesised into scratch, added
   * to the mix, and -- if it is being recorded -- copied into its entry. A
   * recorded drop plays its full length (never retiring early as silent) so
   * it is complete exactly when its entry said it would be; once it is, the
   * entry's playback length is cut back to its last audible sample.
   */
  playLiveDrop(voice, channel, out, length) {
    const scratch = this.dropScratch;
    const start = voice.startOffset;
    scratch.fill(0, start, length);
    const live = voice.live;
    const before = live.age;
    const alive = this.renderVoice(live, scratch, length, voice.entry === null);
    const end = start + (live.age - before);
    for (let index = start; index < end; index += 1) out[index] += scratch[index];
    if (voice.entry) voice.entry.samples.set(scratch.subarray(start, end), voice.position);
    voice.position += end - start;
    voice.startOffset = 0;
    if (alive) return true;
    if (voice.entry) {
      voice.entry.audibleLength = this.audibleLength(voice.entry.samples);
      this.releaseRecording(channel, voice.entry);
    }
    return false;
  }

  /** How much of a recording is above VOICE_SILENCE; the rest need not be played. */
  audibleLength(samples) {
    for (let index = samples.length - 1; index >= 0; index -= 1) {
      if (Math.abs(samples[index]) > VOICE_SILENCE) return index + 1;
    }
    return 0;
  }

  /** A recorded drop for the rest of this block; false once it has ended. */
  playDrop(voice, out, length) {
    const samples = voice.entry.samples;
    const playLength = voice.entry.audibleLength;
    const level = voice.level;
    let position = voice.position;
    const start = voice.startOffset;
    voice.startOffset = 0;
    const end = Math.min(length, start + (playLength - position));
    for (let index = start; index < end; index += 1) {
      out[index] += samples[position] * level;
      position += 1;
    }
    voice.position = position;
    return position < playLength;
  }


  /**
   * One voice for the rest of this block, added into `out`, in one loop with
   * the voice's state in locals. The click draws from the voice's own seed
   * and stops -- no draws, no filtering -- once it and its filter have
   * decayed below hearing, which for most drops is within a few ms of a
   * life of up to 0.4 s. Returns false when the voice has finished: at its
   * nominal length, or earlier once silent if `retireWhenSilent` (a voice
   * being recorded must run its full length -- see addVoice).
   */
  renderVoice(voice, out, length, retireWhenSilent = true) {
    const gain = voice.gain;
    const splashFilter = voice.splashFilter;
    const splashDecay = voice.splashDecay;
    let splashAmplitude = voice.splashAmplitude;
    let splashActive = splashFilter !== null && (splashAmplitude > 0 || voice.sprayFrames.length > 0
      || Math.abs(splashFilter.s1) + Math.abs(splashFilter.s2) > SILENCE);
    let age = voice.age;
    const filter = voice.transientFilter;
    const white = voice.transientWhite ?? 0;
    const decay = voice.transientDecay;
    let clickAmplitude = voice.transientAmplitude;
    let seed = voice.clickSeed;
    let filterActive = filter !== null && (clickAmplitude > 0 || Math.abs(filter.s1) + Math.abs(filter.s2) > SILENCE);
    const start = voice.startOffset;
    voice.startOffset = 0;
    const end = Math.min(length, start + (voice.durationFrames - voice.age));
    for (let index = start; index < end; index += 1) {
      let high = 0;
      if (clickAmplitude > 0) {
        seed = (1664525 * seed + 1013904223) >>> 0;
        const click = ((seed / 0x100000000) * 2 - 1) * clickAmplitude;
        clickAmplitude *= decay;
        if (clickAmplitude < SILENCE) clickAmplitude = 0;
        high = filter ? (white * click) + ((1 - white) * bandPass(filter, click)) : click;
      } else if (filterActive) {
        high = (1 - white) * bandPass(filter, 0);
        filterActive = Math.abs(filter.s1) + Math.abs(filter.s2) > SILENCE;
      }
      if (splashActive) {
        // Spray ticks re-strike the splash at their frames (sorted not
        // needed: each is checked on its own frame).
        const sprays = voice.sprayFrames;
        for (let spray = sprays.length - 1; spray >= 0; spray -= 1) {
          if (sprays[spray] === age) {
            splashAmplitude += voice.sprayLevels[spray];
            sprays.splice(spray, 1);
            voice.sprayLevels.splice(spray, 1);
          }
        }
        let splash = 0;
        if (splashAmplitude > 0) {
          seed = (1664525 * seed + 1013904223) >>> 0;
          splash = ((seed / 0x100000000) * 2 - 1) * splashAmplitude;
          splashAmplitude *= splashDecay;
          if (splashAmplitude < SILENCE) splashAmplitude = 0;
        }
        high += bandPass(splashFilter, splash);
        splashActive = splashAmplitude > 0 || sprays.length > 0
          || Math.abs(splashFilter.s1) + Math.abs(splashFilter.s2) > SILENCE;
      }
      high += this.sampleRainModes(voice.trebleModes);
      if (voice.bubble) high += this.sampleBubble(voice.bubble);
      out[index] += (
        this.sampleRainModes(voice.bodyModes)
        + (this.sampleRainModes(voice.bassModes) * AUTHORED_LOW_LEVEL)
        + (high * AUTHORED_HIGH_LEVEL)
      ) * gain;
      age += 1;
    }
    voice.splashAmplitude = splashAmplitude;
    voice.transientAmplitude = clickAmplitude;
    voice.clickSeed = seed;
    voice.age += end - start;
    const silent = !splashActive && this.voiceIsSilent(voice, filterActive);
    return voice.age < voice.durationFrames && !(retireWhenSilent && silent);
  }

  /**
   * Whether nothing left in a voice can be heard, so it can end before its
   * nominal duration: the click and its filter done, and every oscillator
   * below SILENCE. Checked once per block, so a finished voice costs at most
   * one more block.
   */
  voiceIsSilent(voice, filterActive) {
    if (voice.transientAmplitude > 0 || filterActive) return false;
    if (voice.bubble && voice.bubble.amplitude > VOICE_SILENCE) return false;
    return this.modesAreSilent(voice.bassModes)
      && this.modesAreSilent(voice.bodyModes)
      && this.modesAreSilent(voice.trebleModes);
  }

  modesAreSilent(modes) {
    for (let index = 0; index < modes.length; index += 1) {
      if (modes[index].amplitude > VOICE_SILENCE) return false;
    }
    return true;
  }

  /** A rain layer's block, written into `out` (overwritten). */
  renderRain(channel, out, blockStart, length) {
    if (!this.dropScratch || this.dropScratch.length < length) this.dropScratch = new Float64Array(length);
    out.fill(0, 0, length);
    this.birthVoices(channel, blockStart, length);
    const voices = channel.activeVoices;
    for (let index = voices.length - 1; index >= 0; index -= 1) {
      const voice = voices[index];
      const alive = voice.live
        ? this.playLiveDrop(voice, channel, out, length)
        : this.playDrop(voice, out, length);
      if (!alive && !voice.live) this.releaseRecording(channel, voice.entry);
      if (!alive) {
        // Order does not matter to the mix, so the last voice fills the gap.
        voices[index] = voices[voices.length - 1];
        voices.pop();
      }
    }
    this.renderBed(channel, out, length);
  }

  /**
   * A thunder layer's clock and mixing gains. A storm that has just started
   * (or had its rate changed) peals within THUNDER_FIRST_PEAL_SEC -- waiting
   * the mean interval of minutes would read as nothing happening -- and at
   * random after that. Its distance's direct and reverb-send gains are the
   * shared rule's (resolveAmbientSpace); its darkening is not applied on top,
   * because the rumble's own low-pass (startPeal) already is that darkening.
   */
  configureThunder(channel, before) {
    const space = channel.space ?? { directGain: 1, reverbSend: 0 };
    channel.directGain = space.directGain;
    channel.reverbSend = space.reverbSend;
    if (!channel.peals) channel.peals = [];
    if (!before || before.pealsPer10Min !== channel.pealsPer10Min) {
      channel.nextPealFrame = currentFrame + Math.round(this.between(THUNDER_FIRST_PEAL_SEC) * sampleRate);
    }
  }

  /** Geometric blend from `near` to `far` at distance `d`. */
  byDistance(range, d) {
    return range.near * ((range.far / range.near) ** d);
  }

  /**
   * A new peal, starting at this sample. Everything random is drawn now,
   * into a list of sources sorted by start; renderThunder only plays them.
   */
  startPeal(channel) {
    const d = channel.distance;
    const spread = channel.spread;
    const character = channel.character ?? 0.5;
    const lengthSec = channel.lengthSec;
    const peakSec = lengthSec * this.between(THUNDER_PEAK_AT);
    const fadeTau = Math.max(0.1, (lengthSec - peakSec) / 5);
    const envelope = (t) => {
      if (t < peakSec) {
        const x = t / peakSec;
        return x * x * (3 - (2 * x));
      }
      return Math.exp(-(t - peakSec) / fadeTau);
    };
    const levelScale = this.byDistance(THUNDER_LEVEL, d);
    const clampPan = (value) => Math.max(-1, Math.min(1, value));
    const panAround = (width) => clampPan(channel.pan + (spread * width * ((this.random() * 2) - 1)));
    const sources = [];
    const source = (startSec, attackSec, tauSec, lifeSec, cutoffHz, level, loop, send, panFrom, panTo, rolls) => ({
      start: Math.round(startSec * sampleRate),
      age: 0,
      attack: Math.max(1, Math.round(attackSec * sampleRate)),
      decay: Math.exp(-1 / (Math.max(0.005, tauSec) * sampleRate)),
      life: Math.max(2, Math.round(lifeSec * sampleRate)),
      tail: 1,
      level,
      loop,
      send,
      filter: stateVariableFilter(cutoffHz, 0.8),
      read: Math.floor(this.random() * loop.length),
      panFrom,
      panTo,
      gainLeft: 0,
      gainRight: 0,
      rolls,
      rollFloor: THUNDER_ROLL_FLOOR[0] + ((THUNDER_ROLL_FLOOR[1] - THUNDER_ROLL_FLOOR[0]) * character),
      rollSeed: Math.floor(this.random() * 0x100000000) >>> 0,
      roll: 1,
      rollTarget: 1,
      rollFrames: 0,
    });

    // The bed: each rumble swells to the peak from its own start in the
    // roll-in, and fades with the envelope after it.
    const brown = this.noiseLoop('brown');
    const bedCount = THUNDER_BED_RUMBLES[0] + Math.floor(this.random() * (THUNDER_BED_RUMBLES[1] - THUNDER_BED_RUMBLES[0] + 1));
    const bedLevel = levelScale * (1 - (0.7 * character));
    for (let index = 0; index < bedCount; index += 1) {
      const startSec = peakSec * 0.6 * this.random();
      const attackSec = Math.max(0.05, (peakSec - startSec) * (0.8 + (0.4 * this.random())));
      const tauSec = fadeTau * (0.8 + (0.4 * this.random()));
      sources.push(source(
        startSec, attackSec, tauSec, attackSec + (5 * tauSec),
        this.byDistance(THUNDER_BED_CUTOFF_HZ, d) * (0.7 + (0.6 * this.random())),
        bedLevel * (0.6 + (0.4 * this.random())),
        brown, 1, panAround(1), panAround(1), true,
      ));
    }

    // The strokes: clusters as a Poisson process whose rate follows the
    // envelope, by thinning -- candidates at the peak rate, each kept with
    // the envelope's value at its moment.
    const pink = this.noiseLoop('pink');
    const peakRate = THUNDER_CLUSTER_RATE[0] + ((THUNDER_CLUSTER_RATE[1] - THUNDER_CLUSTER_RATE[0]) * character);
    const maxStrokes = Math.round(THUNDER_CLUSTER_STROKES[0] + ((THUNDER_CLUSTER_STROKES[1] - THUNDER_CLUSTER_STROKES[0]) * character));
    const strokeLevel = levelScale * (0.15 + (1.2 * character));
    const smear = this.byDistance(THUNDER_STROKE_SMEAR, d);
    const cutoffNear = this.byDistance(THUNDER_STROKE_CUTOFF_HZ, d);
    let t = 0;
    for (;;) {
      t += -Math.log(Math.max(1e-9, 1 - this.random())) / peakRate;
      if (t >= lengthSec) break;
      const strength = envelope(t);
      if (this.random() >= strength) continue;
      const strokes = 1 + Math.floor(this.random() * maxStrokes);
      // A cluster comes from one stretch of the channel: one place in the
      // field, from which its strokes scatter a little.
      const clusterPan = panAround(1);
      let at = t;
      for (let index = 0; index < strokes; index += 1) {
        const durationSec = this.between(THUNDER_STROKE_SEC) * smear;
        const attackSec = THUNDER_STROKE_ATTACK_SEC * smear * (1 + this.random());
        // Darker the later it comes: down to half the cutoff by the end.
        const cutoffHz = cutoffNear * (0.5 ** (at / lengthSec)) * (0.7 + (0.6 * this.random()));
        const pan = clampPan(clusterPan + (spread * 0.2 * ((this.random() * 2) - 1)));
        sources.push(source(
          at, attackSec, durationSec / 4, attackSec + durationSec, cutoffHz,
          strokeLevel * strength * (0.5 + (0.5 * this.random())),
          pink, THUNDER_STROKE_SEND, pan, pan, false,
        ));
        at += this.between(THUNDER_STROKE_GAP_SEC) * smear;
      }
    }
    sources.sort((a, b) => a.start - b.start);
    channel.peals.push({ sources, next: 0, age: 0 });
  }

  /**
   * A thunder layer's block: the direct sound into `left`/`right` and what
   * goes to the reverb into `sendLeft`/`sendRight` (all overwritten). A
   * storm between peals costs one comparison per sample and nothing else.
   */
  renderThunder(channel, left, right, sendLeft, sendRight, length) {
    left.fill(0, 0, length);
    right.fill(0, 0, length);
    sendLeft.fill(0, 0, length);
    sendRight.fill(0, 0, length);
    // Seconds between peals are exponential (a Poisson process), drawn here
    // rather than by eventDelayFrames, whose floor of 0.1 per second is a
    // drop rate's and would triple the stormiest setting.
    const meanFrames = (600 / channel.pealsPer10Min) * sampleRate;
    const rollRate = 30 / sampleRate;
    for (let index = 0; index < length; index += 1) {
      if (currentFrame + index >= channel.nextPealFrame) {
        this.startPeal(channel);
        channel.nextPealFrame = currentFrame + index
          + Math.max(1, Math.floor(-Math.log(Math.max(1e-9, 1 - this.random())) * meanFrames));
      }
      if (channel.peals.length === 0) continue;
      let sumLeft = 0;
      let sumRight = 0;
      let wetLeft = 0;
      let wetRight = 0;
      for (let pealIndex = channel.peals.length - 1; pealIndex >= 0; pealIndex -= 1) {
        const peal = channel.peals[pealIndex];
        // Sources become live in start order; `next` is the first not yet live.
        while (peal.next < peal.sources.length && peal.sources[peal.next].start <= peal.age) peal.next += 1;
        peal.age += 1;
        let live = 0;
        for (let sourceIndex = 0; sourceIndex < peal.next; sourceIndex += 1) {
          const item = peal.sources[sourceIndex];
          if (item.age >= item.life) continue;
          live += 1;
          if (item.age === 0 || (item.rolls && item.rollFrames <= 0)) {
            if (item.rolls) {
              item.rollSeed = (1664525 * item.rollSeed + 1013904223) >>> 0;
              item.rollTarget = item.rollFloor + ((1 - item.rollFloor) * (item.rollSeed / 0x100000000));
              item.rollSeed = (1664525 * item.rollSeed + 1013904223) >>> 0;
              item.rollFrames = Math.round((THUNDER_ROLL_SEC[0] + ((THUNDER_ROLL_SEC[1] - THUNDER_ROLL_SEC[0]) * (item.rollSeed / 0x100000000))) * sampleRate);
            }
            // Where it is in the field moves on the same slow clock.
            const progress = Math.min(1, item.age / item.life);
            const pan = item.panFrom + ((item.panTo - item.panFrom) * progress);
            item.gainLeft = Math.SQRT2 * Math.cos((pan + 1) * Math.PI / 4);
            item.gainRight = Math.SQRT2 * Math.sin((pan + 1) * Math.PI / 4);
          }
          let envelope;
          if (item.age < item.attack) {
            const x = item.age / item.attack;
            envelope = x * x * (3 - (2 * x));
          } else {
            item.tail *= item.decay;
            envelope = item.tail;
          }
          let level = item.level * envelope;
          if (item.rolls) {
            item.rollFrames -= 1;
            item.roll += (item.rollTarget - item.roll) * rollRate;
            level *= item.roll;
          }
          const loop = item.loop;
          const sample = lowPassStep(item.filter, loop[item.read]) * level;
          item.read = item.read + 1 === loop.length ? 0 : item.read + 1;
          const sampleLeft = sample * item.gainLeft;
          const sampleRight = sample * item.gainRight;
          sumLeft += sampleLeft;
          sumRight += sampleRight;
          wetLeft += sampleLeft * item.send;
          wetRight += sampleRight * item.send;
          item.age += 1;
        }
        if (live === 0 && peal.next === peal.sources.length) {
          channel.peals[pealIndex] = channel.peals[channel.peals.length - 1];
          channel.peals.pop();
        }
      }
      left[index] = sumLeft * channel.volume;
      right[index] = sumRight * channel.volume;
      sendLeft[index] = wetLeft * channel.volume;
      sendRight[index] = wetRight * channel.volume;
    }
  }

  /**
   * A noise layer's level (its cycle scaled by amplitude and volume) and its
   * two pan gains, at its current phase.
   */
  noiseControl(channel) {
    const cycleValue = this.cycleAt(channel, channel.phase);
    // riseFactor scales only the part of the swing above the trough
    // (cycleValue + 1), so the trough is 1 - amplitude whatever it is.
    const swing = channel.riseFactor === 1 ? cycleValue : (channel.riseFactor * (cycleValue + 1)) - 1;
    const level = Math.max(0, 1 + (channel.modulationAmplitude * swing)) * channel.volume;
    const pan = channel.panFrom === 0 && channel.panTo === 0 ? 0 : this.swayAt(channel, channel.phase);
    // Equal-power balance, normalised so centre is unity on both sides.
    const gainLeft = pan === 0 ? 1 : Math.SQRT2 * Math.cos((pan + 1) * Math.PI / 4);
    const gainRight = pan === 0 ? 1 : Math.SQRT2 * Math.sin((pan + 1) * Math.PI / 4);
    return { level, gainLeft, gainRight };
  }

  /**
   * The next CONTROL_FRAMES samples: advance the cycle to their end (a new
   * cycle begins here if it wraps), and set per-sample steps that take the
   * level and gains from where they are to where they will be. Segments are
   * counted per channel from its first sample, so they fall on the same
   * frames whatever the block size.
   */
  beginControlSegment(channel) {
    if (!channel.controlReady) {
      const start = this.noiseControl(channel);
      channel.level = start.level;
      channel.gainLeft = start.gainLeft;
      channel.gainRight = start.gainRight;
      channel.controlReady = true;
    }
    channel.phase += CONTROL_FRAMES / (channel.periodSec * channel.periodFactor * sampleRate);
    if (channel.phase >= 1) {
      channel.phase -= 1;
      this.startCycle(channel);
    }
    const target = this.noiseControl(channel);
    channel.levelStep = (target.level - channel.level) / CONTROL_FRAMES;
    channel.gainLeftStep = (target.gainLeft - channel.gainLeft) / CONTROL_FRAMES;
    channel.gainRightStep = (target.gainRight - channel.gainRight) / CONTROL_FRAMES;
    channel.controlFramesLeft = CONTROL_FRAMES;
  }

  /**
   * A noise layer's block, written into `left`/`right` (overwritten): the
   * shared loop read at the layer's own offsets, times its ramped level and
   * gains, through its one-pole filter.
   */
  renderNoise(channel, left, right, length) {
    const loop = this.noiseLoop(channel.type);
    const loopLength = loop.length;
    if (channel.loopLeft < 0 || channel.loopLeft >= loopLength) {
      channel.loopLeft = Math.floor(channel.loopStart * loopLength) % loopLength;
      channel.loopRight = (channel.loopLeft + Math.floor(loopLength / 2)) % loopLength;
    }
    let readLeft = channel.loopLeft;
    let readRight = channel.loopRight;
    const direct = channel.widthDirect;
    const cross = channel.widthCross;
    // The tone filter, likewise in locals for the block.
    const tone = channel.toneLeft;
    const toned = tone !== null;
    const t1 = toned ? tone.a1 : 0;
    const t2 = toned ? tone.a2 : 0;
    const t3 = toned ? tone.a3 : 0;
    const highPass = channel.toneHighPass;
    const damping = channel.toneDamping;
    const toneGain = channel.toneGain;
    let toneLeftS1 = toned ? tone.s1 : 0;
    let toneLeftS2 = toned ? tone.s2 : 0;
    let toneRightS1 = toned ? channel.toneRight.s1 : 0;
    let toneRightS2 = toned ? channel.toneRight.s2 : 0;
    // Distance's low-pass, state in locals for the block (a per-sample
    // object read and write made it cost three times the rest of the layer).
    const dark = channel.darkLeft;
    const darkened = dark !== null;
    const a1 = darkened ? dark.a1 : 0;
    const a2 = darkened ? dark.a2 : 0;
    const a3 = darkened ? dark.a3 : 0;
    let leftS1 = darkened ? dark.s1 : 0;
    let leftS2 = darkened ? dark.s2 : 0;
    let rightS1 = darkened ? channel.darkRight.s1 : 0;
    let rightS2 = darkened ? channel.darkRight.s2 : 0;
    for (let index = 0; index < length; index += 1) {
      if (channel.controlFramesLeft === 0) this.beginControlSegment(channel);
      channel.controlFramesLeft -= 1;
      const level = channel.level;
      const a = loop[readLeft];
      const b = loop[readRight];
      const sideLeft = cross === 0 ? a : (direct * a) + (cross * b);
      const sideRight = cross === 0 ? b : (direct * b) + (cross * a);
      let toneLeft = sideLeft * level * channel.gainLeft;
      let toneRight = sideRight * level * channel.gainRight;
      if (toned) {
        // stateVariableFilter's step (as in bandPass): low-pass is v2,
        // high-pass is the input less the damped band and the low.
        let v3 = toneLeft - toneLeftS2;
        let v1 = (t1 * toneLeftS1) + (t2 * v3);
        let v2 = toneLeftS2 + (t2 * toneLeftS1) + (t3 * v3);
        toneLeftS1 = (2 * v1) - toneLeftS1;
        toneLeftS2 = (2 * v2) - toneLeftS2;
        toneLeft = (highPass ? toneLeft - (damping * v1) - v2 : v2) * toneGain;
        v3 = toneRight - toneRightS2;
        v1 = (t1 * toneRightS1) + (t2 * v3);
        v2 = toneRightS2 + (t2 * toneRightS1) + (t3 * v3);
        toneRightS1 = (2 * v1) - toneRightS1;
        toneRightS2 = (2 * v2) - toneRightS2;
        toneRight = (highPass ? toneRight - (damping * v1) - v2 : v2) * toneGain;
      }
      if (darkened) {
        // stateVariableFilter's step (as in bandPass), read at its low-pass output v2.
        let v3 = toneLeft - leftS2;
        let v1 = (a1 * leftS1) + (a2 * v3);
        let v2 = leftS2 + (a2 * leftS1) + (a3 * v3);
        leftS1 = (2 * v1) - leftS1;
        leftS2 = (2 * v2) - leftS2;
        left[index] = v2;
        v3 = toneRight - rightS2;
        v1 = (a1 * rightS1) + (a2 * v3);
        v2 = rightS2 + (a2 * rightS1) + (a3 * v3);
        rightS1 = (2 * v1) - rightS1;
        rightS2 = (2 * v2) - rightS2;
        right[index] = v2;
      } else {
        left[index] = toneLeft;
        right[index] = toneRight;
      }
      channel.level += channel.levelStep;
      channel.gainLeft += channel.gainLeftStep;
      channel.gainRight += channel.gainRightStep;
      readLeft = readLeft + 1 === loopLength ? 0 : readLeft + 1;
      readRight = readRight + 1 === loopLength ? 0 : readRight + 1;
    }
    channel.loopLeft = readLeft;
    channel.loopRight = readRight;
    if (toned) {
      tone.s1 = toneLeftS1;
      tone.s2 = toneLeftS2;
      channel.toneRight.s1 = toneRightS1;
      channel.toneRight.s2 = toneRightS2;
    }
    if (darkened) {
      dark.s1 = leftS1;
      dark.s2 = leftS2;
      channel.darkRight.s1 = rightS1;
      channel.darkRight.s2 = rightS2;
    }
  }

  /**
   * One block. Each channel is rendered whole into a scratch buffer, from
   * its own random stream, and then mixed; a channel that is not the soloed
   * one is still rendered, so its voices and clocks keep running and
   * un-soloing does not restart it.
   */
  process(_inputs, outputs) {
    const output = outputs[0];
    const left = output[0];
    const right = output[1] ?? left;
    const length = left.length;
    if (!this.scratchLeft || this.scratchLeft.length < length) {
      this.scratchLeft = new Float64Array(length);
      this.scratchRight = new Float64Array(length);
      this.scratchSendLeft = new Float64Array(length);
      this.scratchSendRight = new Float64Array(length);
    }
    const scratchLeft = this.scratchLeft;
    const scratchRight = this.scratchRight;
    // Equal-power scaling across however many layers are playing, so
    // enabling one more layer does not push the sum into the limiter. A
    // soloed layer plays alone and needs none.
    const channelScale = this.soloChannelId !== null
      ? 1
      : this.channels.length > 0 ? 1 / Math.sqrt(this.channels.length) : 0;
    left.fill(0);
    if (right !== left) right.fill(0);
    for (let index = 1; index < outputs.length; index += 1) {
      for (const outputChannel of outputs[index]) outputChannel.fill(0);
    }

    for (const channel of this.channels) {
      // A layer at volume 0 still counts in channelScale above -- leaving it
      // out would make every soundscape that carries a silent layer louder --
      // but nothing it would render can be heard, so it is not rendered: its
      // cycle and its clocks pause and resume from where they stood (see
      // birthVoices for why a paused drop clock cannot be trusted).
      if (channel.volume <= 0) continue;
      const audible = this.soloChannelId === null || channel.id === this.soloChannelId;
      this.stream = channel.stream;
      if (channel.kind === 'rain') {
        this.renderRain(channel, scratchLeft, currentFrame, length);
        const target = outputs[channel.outputIndex + 1]?.[0];
        if (!audible || channel.outputIndex < 0 || !target) continue;
        const scale = channel.volume * channelScale;
        for (let index = 0; index < length; index += 1) target[index] += scratchLeft[index] * scale;
        continue;
      }
      // A noise layer sends what it plays; thunder sends its own mix, in
      // which the strokes are mostly dry (see startPeal).
      let sendSourceLeft = scratchLeft;
      let sendSourceRight = scratchRight;
      if (channel.kind === 'thunder') {
        this.renderThunder(channel, scratchLeft, scratchRight, this.scratchSendLeft, this.scratchSendRight, length);
        sendSourceLeft = this.scratchSendLeft;
        sendSourceRight = this.scratchSendRight;
      } else {
        this.renderNoise(channel, scratchLeft, scratchRight, length);
      }
      if (!audible) continue;
      const directScale = channelScale * (channel.directGain ?? 1);
      for (let index = 0; index < length; index += 1) {
        left[index] += scratchLeft[index] * directScale;
        if (right !== left) right[index] += scratchRight[index] * directScale;
      }
      const send = outputs[this.noiseSendOutput];
      const sendScale = channelScale * (channel.reverbSend ?? 0);
      if (send && sendScale > 0) {
        const sendLeft = send[0];
        const sendRight = send[1] ?? sendLeft;
        for (let index = 0; index < length; index += 1) {
          sendLeft[index] += sendSourceLeft[index] * sendScale;
          if (sendRight !== sendLeft) sendRight[index] += sendSourceRight[index] * sendScale;
        }
      }
    }
    this.stream = this.rootStream;
    return true;
  }
}

registerProcessor('ambient-generator', AmbientGenerator);
