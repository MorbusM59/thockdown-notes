class AmbientGenerator extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.seed = (options?.processorOptions?.seed ?? 1) >>> 0;
    this.channels = [];
    this.port.onmessage = (event) => {
      if (event.data?.type !== 'configure') return;
      this.configure(event.data.channels ?? []);
    };
  }

  random() {
    this.seed = (1664525 * this.seed + 1013904223) >>> 0;
    return this.seed / 0x100000000;
  }

  eventDelayFrames(ratePerSecond) {
    const safeRate = Math.max(0.1, ratePerSecond);
    return Math.max(1, Math.floor((-Math.log(Math.max(1e-9, 1 - this.random())) / safeRate) * sampleRate));
  }

  makeChannel(settings) {
    const channel = {
      ...settings,
      mode: settings.modulationPeriodSec === 0 ? 'burst' : 'continuous',
      pink: [0, 0, 0, 0, 0, 0, 0],
      brown: 0,
      phase: this.random(),
      nextEventFrame: currentFrame + this.eventDelayFrames(settings.densityPer10Sec / 10),
      eventAge: -1,
      eventAmplitude: 0,
      eventDurationFrames: 1,
      filterMode: null,
      filterAlpha: 0,
      filterLeft: { x: 0, y: 0 },
      filterRight: { x: 0, y: 0 },
    };
    this.configureFilter(channel);
    return channel;
  }

  configure(settings) {
    this.soloChannelId = settings.find((channel) => channel.solo)?.id ?? null;
    const activeSettings = settings.filter((channel) => channel.enabled !== false);
    const previousById = new Map(this.channels.map((channel) => [channel.id, channel]));
    this.channels = activeSettings.map((next) => {
      const configured = {
        ...next,
        mode: next.modulationPeriodSec === 0 ? 'burst' : 'continuous',
      };
      const previous = previousById.get(next.id);
      if (!previous) return this.makeChannel(configured);
      if (configured.mode === 'burst' && (
        previous.mode !== 'burst'
        || previous.densityPer10Sec !== next.densityPer10Sec
      )) {
        previous.eventAge = -1;
        previous.nextEventFrame = currentFrame + this.eventDelayFrames(next.densityPer10Sec / 10);
      } else if (previous.mode === 'burst' && configured.mode !== 'burst') {
        previous.eventAge = -1;
      }
      Object.assign(previous, configured);
      this.configureFilter(previous);
      return previous;
    });
  }

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

  envelopeAt(channel, progress) {
    const envelope = channel.envelope;
    if (!envelope?.length) return Math.sin(Math.PI * progress) ** 2;
    const position = progress * (envelope.length - 1);
    const low = Math.floor(position);
    const high = Math.min(envelope.length - 1, low + 1);
    const value = position - low;
    return envelope[low] + ((envelope[high] - envelope[low]) * value);
  }

  process(_inputs, outputs) {
    const output = outputs[0];
    const left = output[0];
    const right = output[1] ?? left;
    const channelScale = this.soloChannelId !== null
      ? 1
      : this.channels.length > 0 ? 1 / Math.sqrt(this.channels.length) : 0;
    for (let frame = 0; frame < left.length; frame += 1) {
      let leftMix = 0;
      let rightMix = 0;
      const frameNumber = currentFrame + frame;
      for (const channel of this.channels) {
        const baseLeft = this.noise(channel);
        const baseRight = this.noise(channel);
        let amplitude = 0;
        if (channel.mode === 'continuous') {
          const modulation = Math.sin(channel.phase * Math.PI * 2);
          amplitude = Math.max(0, 1 + (channel.modulationAmplitude * modulation));
          channel.phase += 1 / (channel.modulationPeriodSec * sampleRate);
          if (channel.phase >= 1) channel.phase -= 1;
        } else {
          if (frameNumber >= channel.nextEventFrame) {
            channel.eventAge = 0;
            channel.eventAmplitude = channel.modulationAmplitude;
            channel.eventDurationFrames = Math.max(128, Math.round(channel.speedSec * sampleRate));
            channel.nextEventFrame = frameNumber + this.eventDelayFrames(channel.densityPer10Sec / 10);
          }
          if (channel.eventAge >= 0) {
            const progress = channel.eventAge / channel.eventDurationFrames;
            if (progress >= 1) {
              channel.eventAge = -1;
            } else {
              amplitude = this.envelopeAt(channel, progress) * channel.eventAmplitude;
              channel.eventAge += 1;
            }
          }
        }
        const channelGain = amplitude * channel.volume;
        const filteredLeft = this.filterSample(channel, baseLeft * channelGain, channel.filterLeft);
        const filteredRight = this.filterSample(channel, baseRight * channelGain, channel.filterRight);
        if (this.soloChannelId === null || channel.id === this.soloChannelId) {
          leftMix += filteredLeft;
          rightMix += filteredRight;
        }
      }
      left[frame] = leftMix * channelScale;
      right[frame] = rightMix * channelScale;
    }
    return true;
  }
}

registerProcessor('ambient-generator', AmbientGenerator);