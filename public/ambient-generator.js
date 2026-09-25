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
 * Everything random comes from one seeded linear congruential generator, so
 * a test can render the same sound twice.
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
    this.seed = (options?.processorOptions?.seed ?? 1) >>> 0;
    this.channels = [];
    this.soloChannelId = null;
    this.rainMixes = [];
    this.port.onmessage = (event) => {
      if (event.data?.type !== 'configure') return;
      this.configure(event.data.channels ?? []);
    };
  }

  random() {
    this.seed = (1664525 * this.seed + 1013904223) >>> 0;
    return this.seed / 0x100000000;
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
    const channel = {
      ...settings,
      pink: [0, 0, 0, 0, 0, 0, 0],
      brown: 0,
      phase: this.random(),
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
      const before = { ...previous };
      if (next.kind === 'rain' && previous.dropsPerSecond !== next.dropsPerSecond) {
        previous.nextEventFrame = currentFrame + this.eventDelayFrames(next.dropsPerSecond);
      }
      Object.assign(previous, next);
      this.configureFilter(previous);
      if (previous.kind === 'rain') this.configureRain(previous, before);
      return previous;
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
    const frequency = 3 / radius;
    const damping = (0.13 / radius) + (0.0072 * (radius ** -1.5));
    const rise = (0.05 + (this.random() * 0.15)) * damping;
    return {
      ringFrames: Math.ceil((5 * sampleRate) / damping),
      phase: 0,
      frequency: Math.min(frequency, sampleRate * 0.4),
      riseFactor: 1 + (rise / sampleRate),
      amplitude: gain * Math.min(1, radiusMm / 2.5) * 0.35,
      decay: Math.exp(-damping / sampleRate),
    };
  }

  sampleBubble(bubble) {
    const sample = Math.sin(bubble.phase) * bubble.amplitude;
    bubble.phase += (2 * Math.PI * bubble.frequency) / sampleRate;
    bubble.frequency = Math.min(bubble.frequency * bubble.riseFactor, sampleRate * 0.45);
    bubble.amplitude *= bubble.decay;
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
   * The bed: sparse random impulses plus a noise floor, band-passed, with a
   * slow random swell. Draws nothing from the random stream while `wash` is
   * 0, so a layer without a bed renders exactly as it did before beds
   * existed.
   */
  bedSample(channel) {
    const wash = channel.wash ?? 0;
    if (wash <= 0) return 0;
    const spec = channel.profile.bed;
    const bed = channel.bed;
    if (bed.swellFrames <= 0) {
      bed.swellTarget = 1 - (spec.swellDepth * this.random());
      bed.swellFrames = this.eventDelayFrames(1 / BED_SWELL_PERIOD_SEC);
    }
    bed.swellFrames -= 1;
    bed.swell += (bed.swellTarget - bed.swell) * (1 / (sampleRate * 0.8));
    const impulse = this.random() < (spec.ratePerSec / sampleRate)
      ? ((this.random() * 2) - 1)
      : 0;
    const floor = ((this.random() * 2) - 1) * spec.floor;
    return bandPass(bed.filter, impulse + floor) * spec.gain * bed.swell * wash;
  }

  rainSample(channel, frameNumber) {
    const profile = channel.profile;
    if (frameNumber >= channel.nextEventFrame) {
      if (channel.activeVoices.length < MAX_RAIN_VOICES) {
        channel.activeVoices.push(this.makeSurfaceVoice(profile, false));
      }
      channel.nextEventFrame = frameNumber + this.eventDelayFrames(channel.dropsPerSecond);
    }
    if (frameNumber >= channel.nextDripFrame) {
      if (channel.activeVoices.length < MAX_RAIN_VOICES) {
        channel.activeVoices.push(this.makeSurfaceVoice(profile, true));
      }
      channel.nextDripFrame = frameNumber + this.eventDelayFrames(channel.drips * RAIN_DRIPS_MAX_PER_SEC);
    }

    let sample = 0;
    for (let index = channel.activeVoices.length - 1; index >= 0; index -= 1) {
      const voice = channel.activeVoices[index];
      const click = ((this.random() * 2) - 1) * voice.transientAmplitude;
      voice.transientAmplitude *= voice.transientDecay;
      const transient = voice.transientFilter ? bandPass(voice.transientFilter, click) : click;
      let high = transient + this.sampleRainModes(voice.trebleModes);
      if (voice.bubble) high += this.sampleBubble(voice.bubble);
      sample += (
        this.sampleRainModes(voice.bodyModes)
        + (this.sampleRainModes(voice.bassModes) * channel.bassGain)
        + (high * channel.trebleGain)
      ) * voice.gain;
      voice.age += 1;
      if (voice.age >= voice.durationFrames) channel.activeVoices.splice(index, 1);
    }
    return sample + this.bedSample(channel);
  }

  process(_inputs, outputs) {
    const output = outputs[0];
    const left = output[0];
    const right = output[1] ?? left;
    const rainOutputCount = Math.max(0, outputs.length - 1);
    if (this.rainMixes.length !== rainOutputCount) {
      this.rainMixes = new Float64Array(rainOutputCount);
    }
    const rainMixes = this.rainMixes;
    // Equal-power scaling across however many layers are playing, so
    // enabling one more layer does not push the sum into the limiter. A
    // soloed layer plays alone and needs none.
    const channelScale = this.soloChannelId !== null
      ? 1
      : this.channels.length > 0 ? 1 / Math.sqrt(this.channels.length) : 0;
    for (let frame = 0; frame < left.length; frame += 1) {
      let leftMix = 0;
      let rightMix = 0;
      rainMixes.fill(0);
      const frameNumber = currentFrame + frame;
      for (const channel of this.channels) {
        // A layer that is not the soloed one is still rendered, so its
        // voices and clocks keep running and un-soloing does not restart it.
        const audible = this.soloChannelId === null || channel.id === this.soloChannelId;
        if (channel.kind === 'rain') {
          const rainSample = this.rainSample(channel, frameNumber);
          if (audible && channel.outputIndex >= 0 && channel.outputIndex < rainMixes.length) {
            rainMixes[channel.outputIndex] += rainSample * channel.volume;
          }
          continue;
        }

        const baseLeft = this.noise(channel);
        const baseRight = this.noise(channel);
        const amplitude = Math.max(0, 1 + (channel.modulationAmplitude * this.cycleAt(channel, channel.phase)));
        channel.phase += 1 / (channel.periodSec * sampleRate);
        if (channel.phase >= 1) channel.phase -= 1;
        const channelGain = amplitude * channel.volume;
        const filteredLeft = this.filterSample(channel, baseLeft * channelGain, channel.filterLeft);
        const filteredRight = this.filterSample(channel, baseRight * channelGain, channel.filterRight);
        if (audible) {
          leftMix += filteredLeft;
          rightMix += filteredRight;
        }
      }
      left[frame] = leftMix * channelScale;
      right[frame] = rightMix * channelScale;
      for (let index = 0; index < rainOutputCount; index += 1) {
        const rainOutput = outputs[index + 1][0];
        if (rainOutput) rainOutput[frame] = rainMixes[index] * channelScale;
      }
    }
    return true;
  }
}

registerProcessor('ambient-generator', AmbientGenerator);
