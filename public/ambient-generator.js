class AmbientGenerator extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.seed = (options?.processorOptions?.seed ?? 1) >>> 0;
    this.config = {};
    this.voices = {
      wind: this.makeVoices('wind', ['brown', 'pink', 'pink']),
      ocean: this.makeVoices('ocean', ['brown', 'brown', 'pink']),
      rain: this.makeVoices('rain', ['white', 'white', 'pink']),
    };
    this.port.onmessage = (event) => {
      if (event.data?.type !== 'configure') return;
      this.config = event.data.layers ?? {};
      for (const layerId of Object.keys(this.voices)) {
        const layer = this.config[layerId] ?? {};
        for (const voice of this.voices[layerId]) {
          voice.envelopes = layer.envelopes ?? voice.envelopes;
          voice.nextEventFrame = currentFrame + this.eventDelayFrames(layer.profile?.burstRatePerVoice ?? 0.015);
        }
      }
    };
  }

  random() {
    this.seed = (1664525 * this.seed + 1013904223) >>> 0;
    return this.seed / 0x100000000;
  }

  makeVoices(layerId, colors) {
    return colors.map((color, index) => ({
      color,
      index,
      pink: [0, 0, 0, 0, 0, 0, 0],
      brown: 0,
      lowpass: [0, 0],
      phase: this.random(),
      phaseOffset: (this.random() - 0.5) * 0.8,
      spread: this.random(),
      nextEventFrame: currentFrame + this.eventDelayFrames(0.12),
      eventAge: -1,
      eventDuration: 1,
      eventAmplitude: 0,
      envelopeIndex: 0,
      envelopes: [],
      layerId,
    }));
  }

  eventDelayFrames(rate) {
    return Math.max(1, Math.floor((-Math.log(Math.max(1e-9, 1 - this.random())) / Math.max(0.001, rate)) * sampleRate));
  }

  noise(voice) {
    const white = (this.random() * 2) - 1;
    if (voice.color === 'white') return white;
    if (voice.color === 'brown') {
      voice.brown = (0.997 * voice.brown) + (white * 0.055);
      return voice.brown;
    }
    const b = voice.pink;
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

  envelopeAt(voice, progress) {
    const envelope = voice.envelopes[voice.envelopeIndex];
    if (!envelope?.length) return Math.sin(Math.PI * progress) ** 2;
    const position = progress * (envelope.length - 1);
    const low = Math.floor(position);
    const high = Math.min(envelope.length - 1, low + 1);
    const value = position - low;
    return envelope[low] + ((envelope[high] - envelope[low]) * value);
  }

  process(_inputs, outputs) {
    const layerIds = ['wind', 'ocean', 'rain'];
    for (let layerIndex = 0; layerIndex < layerIds.length; layerIndex += 1) {
      const layerId = layerIds[layerIndex];
      const layer = this.config[layerId] ?? {};
      const texture = Math.max(0, Math.min(1, layer.texture ?? 0));
      const profile = layer.profile ?? {
        modulationDepth: 0.018 + (texture * 0.24),
        modulationCycleSec: 42 - (texture * 39),
        chaos: texture,
        burstRatePerVoice: 0.015 + (texture * texture),
      };
      const voices = this.voices[layerId];
      const output = outputs[layerIndex];
      const left = output[0];
      const right = output[1] ?? left;
      for (let frame = 0; frame < left.length; frame += 1) {
        let leftMix = 0;
        let rightMix = 0;
        for (const voice of voices) {
          const cycle = Math.max(0.5, Math.min(50, profile.modulationCycleSec * (1 + ((voice.spread - 0.5) * profile.chaos * 1.2))));
          const lfo = Math.sin((voice.phase + voice.phaseOffset) * Math.PI * 2);
          voice.phase += 1 / (cycle * sampleRate);
          if (voice.phase >= 1) voice.phase -= 1;
          const modulation = 0.78 + (profile.modulationDepth * lfo);
          const eventRate = profile.burstRatePerVoice;
          if (currentFrame + frame >= voice.nextEventFrame) {
            voice.eventAge = 0;
            const baseDuration = layerId === 'rain'
              ? 0.12 + (this.random() * 0.72)
              : layerId === 'wind'
                ? 1.8 + (this.random() * 3.8)
                : 1.3 + (this.random() * 3.6);
            voice.eventDuration = Math.max(1, Math.floor(baseDuration * sampleRate * (1 + ((this.random() - 0.5) * texture * 0.8))));
            voice.eventAmplitude = 0.014 + (texture * 0.035 * (0.45 + (this.random() * 0.75)));
            voice.envelopeIndex = Math.floor(this.random() * Math.max(1, voice.envelopes.length));
            voice.nextEventFrame = currentFrame + frame + Math.floor((-Math.log(Math.max(1e-9, 1 - this.random())) / eventRate) * sampleRate);
          }

          const cutoffs = layerId === 'wind'
            ? [130, 230, 390]
            : layerId === 'ocean'
              ? [70, 120, 210]
              : [900, 1500, 2400];
          const spread = 1 + ((voice.spread - 0.5) * profile.chaos * 2.2);
          const cutoff = cutoffs[voice.index] * (1 + (texture * (layerId === 'rain' ? 3.2 : 5.5))) * spread;
          const coefficient = 1 - Math.exp((-2 * Math.PI * cutoff) / sampleRate);
          const baseLeft = this.noise(voice);
          const baseRight = this.noise(voice);
          let shapedLeft;
          let shapedRight;
          if (layerId === 'rain') {
            voice.lowpass[0] += coefficient * (baseLeft - voice.lowpass[0]);
            voice.lowpass[1] += coefficient * (baseRight - voice.lowpass[1]);
            shapedLeft = baseLeft - voice.lowpass[0];
            shapedRight = baseRight - voice.lowpass[1];
          } else {
            voice.lowpass[0] += coefficient * (baseLeft - voice.lowpass[0]);
            voice.lowpass[1] += coefficient * (baseRight - voice.lowpass[1]);
            shapedLeft = voice.lowpass[0];
            shapedRight = voice.lowpass[1];
          }

          let burst = 0;
          if (voice.eventAge >= 0) {
            const progress = voice.eventAge / voice.eventDuration;
            if (progress >= 1) {
              voice.eventAge = -1;
            } else {
              burst = this.envelopeAt(voice, progress) * voice.eventAmplitude;
              voice.eventAge += 1;
            }
          }
          leftMix += (shapedLeft * modulation) + (shapedLeft * burst);
          rightMix += (shapedRight * modulation) + (shapedRight * burst);
        }
        left[frame] = Math.max(-1, Math.min(1, leftMix / voices.length));
        right[frame] = Math.max(-1, Math.min(1, rightMix / voices.length));
      }
    }
    return true;
  }
}

registerProcessor('ambient-generator', AmbientGenerator);