/**
 * Ambient sound generator: the AudioWorklet that synthesises every ambient
 * layer, sample by sample, on the audio thread.
 *
 * It is plain JavaScript under public/ because an AudioWorklet module is
 * loaded by URL and cannot import the app's TypeScript. The settings it reads
 * are defined in src/shared/ambientSound.ts; the engine
 * (src/sound/AmbientSoundEngine.ts) posts them here as a `configure` message.
 *
 * Outputs: output 0 is the stereo mix of every noise layer. Each rain layer
 * is mono and goes to output `1 + outputIndex`, where `outputIndex` is set by
 * the engine per channel (-1 for a noise layer), so the engine can pan,
 * filter and reverb each rain layer on its own. The worklet does not know how
 * many rain slots exist; it writes to whichever outputs it was given.
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
 * How each rain surface turns a drop into sound. Every name in
 * AMBIENT_RAIN_SURFACES (src/shared/ambientSound.ts) must have an entry here;
 * ambient-generator.test.ts checks that.
 *
 * - `impact`: the drop's attack. `modal` is the original model -- a white
 *   noise click plus decaying sinusoidal modes, which rings like glass. `band`
 *   is a click of band-passed noise (centre and decay drawn from the ranges
 *   given), plus a few quieter modes for body.
 * - `bubbleChance`: the share of drops that also produce a bubble resonance
 *   (a drop entering standing water traps a small air bubble that rings at a
 *   pitch set by its radius and rises as it collapses toward the surface).
 * - `bed`: the dense wash of distant drops. Impulses at `ratePerSec` with a
 *   noise floor, band-passed around `centerHz`, slowly swelling by up to
 *   `swellDepth` so it does not sound like a static noise generator.
 * - `drip`: a large, slow drop. `gain` scales it, `pitchScale` lowers its
 *   frequencies, `bubbleChance` replaces the surface's own.
 */
const RAIN_SURFACE_PROFILES = {
  glass: {
    impact: { kind: 'modal' },
    bubbleChance: 0,
    bed: { ratePerSec: 900, centerHz: 6500, q: 0.7, floor: 0.12, gain: 0.5, swellDepth: 0.25 },
    drip: { gain: 1.9, pitchScale: 0.55, bubbleChance: 0 },
  },
  street: {
    impact: {
      kind: 'band',
      centerHz: [2200, 7500],
      q: 0.9,
      decaySec: [0.0012, 0.004],
      amplitude: [1.1, 2],
      durationSec: 0.12,
      bassModes: { count: [1, 1], hz: [70, 190], decaySec: [0.006, 0.02], amplitude: [0.03, 0.07] },
      bodyModes: { count: [0, 1], hz: [900, 2600], decaySec: [0.002, 0.006], amplitude: [0.01, 0.03] },
    },
    bubbleChance: 0.3,
    bed: { ratePerSec: 2600, centerHz: 4200, q: 0.55, floor: 0.2, gain: 0.55, swellDepth: 0.3 },
    drip: { gain: 2.2, pitchScale: 0.6, bubbleChance: 0.85 },
  },
  forest: {
    impact: {
      kind: 'band',
      centerHz: [700, 2600],
      q: 1.3,
      decaySec: [0.004, 0.012],
      amplitude: [1, 1.8],
      durationSec: 0.2,
      bassModes: { count: [1, 1], hz: [110, 320], decaySec: [0.015, 0.05], amplitude: [0.04, 0.09] },
      bodyModes: { count: [1, 2], hz: [450, 1400], decaySec: [0.004, 0.012], amplitude: [0.012, 0.035] },
    },
    bubbleChance: 0.04,
    bed: { ratePerSec: 1700, centerHz: 1900, q: 0.8, floor: 0.16, gain: 0.6, swellDepth: 0.45 },
    drip: { gain: 3, pitchScale: 0.5, bubbleChance: 0.1 },
  },
};

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

/** The most rain voices one layer keeps ringing at once. */
const MAX_RAIN_VOICES = 48;

/** Large drops per second at `drips` = 1; mirrors AMBIENT_RAIN_DRIPS_MAX_PER_SEC. */
const RAIN_DRIPS_MAX_PER_SEC = 3;

/** Average seconds between the bed's swell targets. */
const BED_SWELL_PERIOD_SEC = 2.5;

/**
 * State-variable band-pass filter coefficients (the topology-preserving
 * "TPT" form, stable at any centre frequency below Nyquist).
 */
function bandPassCoefficients(centerHz, q) {
  const safeHz = Math.max(20, Math.min(centerHz, sampleRate * 0.45));
  const g = Math.tan((Math.PI * safeHz) / sampleRate);
  const k = 1 / q;
  const a1 = 1 / (1 + (g * (g + k)));
  return { a1, a2: g * a1, a3: g * g * a1, s1: 0, s2: 0 };
}

/** One sample through a bandPassCoefficients filter; returns the band output. */
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
      filterMode: null,
      filterAlpha: 0,
      filterLeft: { x: 0, y: 0 },
      filterRight: { x: 0, y: 0 },
    };
    this.configureFilter(channel);
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
        if (previous.kind === 'rain') this.configureRain(previous, before);
        return previous;
      });
    });
  }

  /**
   * The noise layers' one-pole filter: `filter` 0.5 is off, below it a
   * low-pass and above it a high-pass, both swept logarithmically from
   * 20 Hz to 18 kHz as the value moves away from the middle.
   */
  configureFilter(channel) {
    const amount = channel.filter ?? 0.5;
    channel.filterLeft.x = 0;
    channel.filterLeft.y = 0;
    channel.filterRight.x = 0;
    channel.filterRight.y = 0;
    if (amount === 0.5) {
      channel.filterMode = null;
      channel.filterAlpha = 0;
      return;
    }

    const strength = Math.abs(amount - 0.5) * 2;
    const minHz = 20;
    const maxHz = 18000;
    const ratio = maxHz / minHz;
    channel.filterMode = amount < 0.5 ? 'lowpass' : 'highpass';
    const cutoff = channel.filterMode === 'lowpass'
      ? maxHz * (1 / ratio) ** strength
      : minHz * ratio ** strength;
    channel.filterAlpha = channel.filterMode === 'lowpass'
      ? 1 - Math.exp((-2 * Math.PI * cutoff) / sampleRate)
      : Math.exp((-2 * Math.PI * cutoff) / sampleRate);
  }

  filterSample(channel, sample, state) {
    const output = channel.filterMode === 'lowpass'
      ? state.y + (channel.filterAlpha * (sample - state.y))
      : channel.filterMode === 'highpass'
        ? channel.filterAlpha * (state.y + sample - state.x)
        : sample;
    state.x = sample;
    state.y = output;
    return output;
  }

  /**
   * Bring a rain channel's surface-dependent state in line with its
   * settings. `before` is the channel as it was (null for a new one): the
   * bed filter is rebuilt only when the surface changed, so it keeps its
   * memory through other edits, and the drip clock is rescheduled only when
   * the drip rate changed.
   */
  configureRain(channel, before) {
    const profile = RAIN_SURFACE_PROFILES[channel.surface] ?? RAIN_SURFACE_PROFILES.glass;
    channel.profile = profile;
    if (!channel.bed || before?.surface !== channel.surface) {
      channel.bed = {
        // Its own stream, so the bed's per-sample draws and the voices'
        // births each stay in time order whatever the block size.
        stream: { seed: Math.floor(this.random() * 0x100000000) >>> 0 },
        filter: bandPassCoefficients(profile.bed.centerHz, profile.bed.q),
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
      || before.bassGain !== channel.bassGain || before.trebleGain !== channel.trebleGain) {
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

  makeModesFromSpec(spec, pitchScale) {
    const count = Math.round(this.between(spec.count));
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
   * The glass drop: the original rain model, kept draw-for-draw so its
   * sound does not change. A white-noise click (`transientFilter` null) and
   * three banks of ringing modes.
   */
  makeRainVoice() {
    return {
      age: 0,
      durationFrames: Math.ceil(sampleRate * 0.4),
      gain: 1,
      transientAmplitude: 0.24 + (this.random() * 0.2),
      transientDecay: Math.exp(-1 / (sampleRate * 0.00065)),
      transientFilter: null,
      clickSeed: 0,
      bassModes: this.makeRainModes(
        1 + Math.floor(this.random() * 2), 85, 460, 0.025, 0.095, 0.035, 0.14,
      ),
      bodyModes: this.makeRainModes(
        2 + Math.floor(this.random() * 3), 360, 3400, 0.009, 0.065, 0.025, 0.105,
      ),
      trebleModes: this.makeRainModes(
        1 + Math.floor(this.random() * 3), 2100, 9200, 0.004, 0.035, 0.018, 0.075,
      ),
      bubble: null,
    };
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
   * One drop on a surface. A drip is the same drop made larger: louder,
   * lower, and with its own chance of a (larger) bubble.
   */
  makeSurfaceVoice(profile, isDrip) {
    if (profile.impact.kind === 'modal') {
      const voice = this.makeRainVoice();
      if (isDrip) {
        voice.gain = profile.drip.gain;
        for (const bank of [voice.bassModes, voice.bodyModes, voice.trebleModes]) {
          for (const mode of bank) this.retuneMode(mode, profile.drip.pitchScale);
        }
      }
      return voice;
    }
    const impact = profile.impact;
    const pitchScale = isDrip ? profile.drip.pitchScale : 1;
    const decaySec = this.between(impact.decaySec) * (isDrip ? 1.8 : 1);
    const bubbleChance = isDrip ? profile.drip.bubbleChance : profile.bubbleChance;
    const voice = {
      age: 0,
      durationFrames: Math.ceil(sampleRate * impact.durationSec * (isDrip ? 2 : 1)),
      gain: isDrip ? profile.drip.gain : 1,
      transientAmplitude: this.between(impact.amplitude),
      transientDecay: Math.exp(-1 / (sampleRate * decaySec)),
      transientFilter: bandPassCoefficients(this.between(impact.centerHz) * pitchScale, impact.q),
      clickSeed: 0,
      bassModes: this.makeModesFromSpec(impact.bassModes, pitchScale),
      bodyModes: this.makeModesFromSpec(impact.bodyModes, pitchScale),
      trebleModes: [],
      bubble: null,
    };
    if (bubbleChance > 0 && this.random() < bubbleChance) {
      const radiusMm = isDrip ? this.between([2.5, 5]) : this.between([0.8, 2.6]);
      voice.bubble = this.makeBubble(radiusMm, 1);
      voice.durationFrames = Math.max(voice.durationFrames, voice.bubble.ringFrames);
    }
    return voice;
  }

  retuneMode(mode, pitchScale) {
    mode.frequency *= pitchScale;
    const angle = (Math.PI * 2 * mode.frequency) / sampleRate;
    mode.rotationSin = Math.sin(angle);
    mode.rotationCos = Math.cos(angle);
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
    const live = this.makeSurfaceVoice(channel.profile, isDrip);
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
    const alive = this.renderVoice(live, channel, scratch, length, voice.entry === null);
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
  renderVoice(voice, channel, out, length, retireWhenSilent = true) {
    const bassGain = channel.bassGain;
    const trebleGain = channel.trebleGain;
    const gain = voice.gain;
    const filter = voice.transientFilter;
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
        high = filter ? bandPass(filter, click) : click;
      } else if (filterActive) {
        high = bandPass(filter, 0);
        filterActive = Math.abs(filter.s1) + Math.abs(filter.s2) > SILENCE;
      }
      high += this.sampleRainModes(voice.trebleModes);
      if (voice.bubble) high += this.sampleBubble(voice.bubble);
      out[index] += (
        this.sampleRainModes(voice.bodyModes)
        + (this.sampleRainModes(voice.bassModes) * bassGain)
        + (high * trebleGain)
      ) * gain;
    }
    voice.transientAmplitude = clickAmplitude;
    voice.clickSeed = seed;
    voice.age += end - start;
    return voice.age < voice.durationFrames && !(retireWhenSilent && this.voiceIsSilent(voice, filterActive));
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
    for (let index = 0; index < length; index += 1) {
      if (channel.controlFramesLeft === 0) this.beginControlSegment(channel);
      channel.controlFramesLeft -= 1;
      const level = channel.level;
      left[index] = this.filterSample(channel, loop[readLeft] * level * channel.gainLeft, channel.filterLeft);
      right[index] = this.filterSample(channel, loop[readRight] * level * channel.gainRight, channel.filterRight);
      channel.level += channel.levelStep;
      channel.gainLeft += channel.gainLeftStep;
      channel.gainRight += channel.gainRightStep;
      readLeft = readLeft + 1 === loopLength ? 0 : readLeft + 1;
      readRight = readRight + 1 === loopLength ? 0 : readRight + 1;
    }
    channel.loopLeft = readLeft;
    channel.loopRight = readRight;
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
    for (let index = 1; index < outputs.length; index += 1) outputs[index][0]?.fill(0);

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
      this.renderNoise(channel, scratchLeft, scratchRight, length);
      if (!audible) continue;
      for (let index = 0; index < length; index += 1) {
        left[index] += scratchLeft[index] * channelScale;
        if (right !== left) right[index] += scratchRight[index] * channelScale;
      }
    }
    this.stream = this.rootStream;
    return true;
  }
}

registerProcessor('ambient-generator', AmbientGenerator);
