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
 * rest of the audio. A block that runs late is heard as a tear in the sound,
 * and it also delays the next `configure` message, so a preset change seems
 * not to take. Hence: no trigonometry per sample (oscillators are rotated
 * sin/cos pairs), no work for a component that has gone silent, and one tight
 * loop per voice.
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

/** Samples between re-derivations of a rising bubble's rotation (see makeBubble). */
const BUBBLE_RETUNE_FRAMES = 32;

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
      pink: [0, 0, 0, 0, 0, 0, 0],
      brown: 0,
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

  noise(channel) {
    const white = (this.random() * 2) - 1;
    if (channel.type === 'white') return white;
    if (channel.type === 'brown') {
      channel.brown = (0.997 * channel.brown) + (white * 0.055);
      return channel.brown;
    }
    const b = channel.pink;
    b[0] = (0.99886 * b[0]) + (white * 0.0555179);
    b[1] = (0.99332 * b[1]) + (white * 0.0750759);
    b[2] = (0.969 * b[2]) + (white * 0.153852);
    b[3] = (0.8665 * b[3]) + (white * 0.3104856);
    b[4] = (0.55 * b[4]) + (white * 0.5329522);
    b[5] = (-0.7616 * b[5]) - (white * 0.016898);
    const pink = (b[0] + b[1] + b[2] + b[3] + b[4] + b[5] + b[6] + (white * 0.5362)) * 0.11;
    b[6] = white * 0.115926;
    return pink;
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
      this.addVoice(channel, isDrip, at - blockStart);
      if (isDrip) channel.nextDripFrame += this.eventDelayFrames(channel.drips * RAIN_DRIPS_MAX_PER_SEC);
      else channel.nextEventFrame += this.eventDelayFrames(channel.dropsPerSecond);
    }
  }

  addVoice(channel, isDrip, offset) {
    if (channel.activeVoices.length >= MAX_RAIN_VOICES) return;
    const voice = this.makeSurfaceVoice(channel.profile, isDrip);
    voice.startOffset = Math.max(0, offset);
    voice.clickSeed = Math.floor(this.random() * 0x100000000) >>> 0;
    channel.activeVoices.push(voice);
  }

  /**
   * One voice for the rest of this block, added into `out`, in one loop with
   * the voice's state in locals. The click draws from the voice's own seed
   * and stops -- no draws, no filtering -- once it and its filter have
   * decayed below hearing, which for most drops is within a few ms of a
   * life of up to 0.4 s. Returns false when the voice has finished.
   */
  renderVoice(voice, channel, out, length) {
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
    return voice.age < voice.durationFrames && !this.voiceIsSilent(voice, filterActive);
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
    out.fill(0, 0, length);
    this.birthVoices(channel, blockStart, length);
    const voices = channel.activeVoices;
    for (let index = voices.length - 1; index >= 0; index -= 1) {
      if (!this.renderVoice(voices[index], channel, out, length)) {
        // Order does not matter to the mix, so the last voice fills the gap.
        voices[index] = voices[voices.length - 1];
        voices.pop();
      }
    }
    this.renderBed(channel, out, length);
  }

  /** A noise layer's block, written into `left`/`right` (overwritten). */
  renderNoise(channel, left, right, length) {
    for (let index = 0; index < length; index += 1) {
      const baseLeft = this.noise(channel);
      const baseRight = this.noise(channel);
      const cycleValue = this.cycleAt(channel, channel.phase);
      // riseFactor scales only the part of the swing above the trough
      // (cycleValue + 1), so the trough is 1 - amplitude whatever it is.
      const amplitude = channel.riseFactor === 1
        ? Math.max(0, 1 + (channel.modulationAmplitude * cycleValue))
        : Math.max(0, 1 + (channel.modulationAmplitude * ((channel.riseFactor * (cycleValue + 1)) - 1)));
      const pan = channel.panFrom === 0 && channel.panTo === 0 ? 0 : this.swayAt(channel, channel.phase);
      channel.phase += 1 / (channel.periodSec * channel.periodFactor * sampleRate);
      if (channel.phase >= 1) {
        channel.phase -= 1;
        this.startCycle(channel);
      }
      const channelGain = amplitude * channel.volume;
      // Equal-power balance, normalised so centre is unity on both sides.
      const leftGain = pan === 0 ? 1 : Math.SQRT2 * Math.cos((pan + 1) * Math.PI / 4);
      const rightGain = pan === 0 ? 1 : Math.SQRT2 * Math.sin((pan + 1) * Math.PI / 4);
      left[index] = this.filterSample(channel, baseLeft * channelGain * leftGain, channel.filterLeft);
      right[index] = this.filterSample(channel, baseRight * channelGain * rightGain, channel.filterRight);
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
