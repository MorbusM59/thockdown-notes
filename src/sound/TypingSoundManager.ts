import { BASS_TYPING_SOUND_ASSET, DEFAULT_TYPING_SOUND_SET, TREBLE_TYPING_SOUND_ASSET, TYPING_SOUND_ASSETS, TYPING_SOUND_SET_IDS, TypingSoundSetId } from './typingSounds'

export interface TypingSoundLayerConfig {
  enabled: boolean
  gain: number
  assetIndexes: number[]
}

export interface TypingSoundEchoOptions {
  delayMs: number
  count: number
  decay: number
}

export interface TypingSoundPlayOptions {
  keyId?: string
  assetIndex?: number
  detune?: number
  playbackRate?: number
  reverse?: boolean
  gain?: number
  echo?: TypingSoundEchoOptions
  frequencyScale?: number
  flipChannels?: boolean
}

interface TypingSoundHistoryEntry {
  keyId: string
  attributes: {
    assetIndex: number
    detune: number
    playbackRate: number
    reverse: boolean
    gain: number
    echo?: TypingSoundEchoOptions
    bassDetune: number
    trebleDetune: number
    frequencyScale: number
    flipChannels: {
      click: boolean
      bass: boolean
      treble: boolean
    }
  }
}

export class TypingSoundManager {
  private audioContext: AudioContext | null = null
  private masterGain: GainNode | null = null
  private reverbNode: ConvolverNode | null = null
  private reverbFilter: BiquadFilterNode | null = null
  private reverbDryGain: GainNode | null = null
  private reverbWetGain: GainNode | null = null
  private reverbStrength = 0
  private reverbSpace = 0
  private bufferGroups: Record<string, AudioBuffer[]> = {
    bass: [],
    treble: [],
  }
  private clickBuffersBySet: Record<TypingSoundSetId, AudioBuffer[]> = {
    A: [],
    B: [],
    C: [],
  }
  private reversedBufferGroups: Record<string, AudioBuffer[]> | null = null
  private flippedBufferGroups: Record<string, AudioBuffer[]> | null = null
  private reversedFlippedBufferGroups: Record<string, AudioBuffer[]> | null = null
  private reversedClickBuffersBySet: Record<TypingSoundSetId, AudioBuffer[]> | null = null
  private flippedClickBuffersBySet: Record<TypingSoundSetId, AudioBuffer[]> = {
    A: [],
    B: [],
    C: [],
  }
  private reversedFlippedClickBuffersBySet: Record<TypingSoundSetId, AudioBuffer[]> | null = null
  private activeKeySet: TypingSoundSetId = DEFAULT_TYPING_SOUND_SET
  private enabled = true
  private keyVariance = 0
  private pitch = 0
  private recentKeySoundHistory: TypingSoundHistoryEntry[] = []
  private loaded = false
  private loadingPromise: Promise<void> | null = null
  private layers: Record<string, TypingSoundLayerConfig> = {
    click: {
      enabled: true,
      gain: 1,
      assetIndexes: TYPING_SOUND_ASSETS[DEFAULT_TYPING_SOUND_SET].map((_, index) => index),
    },
    bass: {
      enabled: true,
      gain: 0.7,
      assetIndexes: [0],
    },
    treble: {
      enabled: true,
      gain: 0.7,
      assetIndexes: [0],
    },
  }

  async load(): Promise<void> {
    if (this.loaded) return
    if (this.loadingPromise) return this.loadingPromise

    this.loadingPromise = (async () => {
      const context = this.createAudioContext()
      const masterGain = context.createGain()
      const dryGain = context.createGain()
      const wetGain = context.createGain()
      const reverb = context.createConvolver()
      const reverbFilter = context.createBiquadFilter()

      masterGain.gain.value = 1
      dryGain.gain.value = 1
      wetGain.gain.value = 0
      reverbFilter.type = 'lowpass'
      reverbFilter.frequency.value = 12000
      reverbFilter.Q.value = 0.7

      dryGain.connect(masterGain)
      reverb.connect(reverbFilter).connect(wetGain).connect(masterGain)
      masterGain.connect(context.destination)

      this.audioContext = context
      this.masterGain = masterGain
      this.reverbNode = reverb
      this.reverbFilter = reverbFilter
      this.reverbDryGain = dryGain
      this.reverbWetGain = wetGain
      this.updateReverbImpulseResponse()

      const clickBuffersBySet = {} as Record<TypingSoundSetId, AudioBuffer[]>
      for (const setId of TYPING_SOUND_SET_IDS) {
        clickBuffersBySet[setId] = await Promise.all(
          TYPING_SOUND_ASSETS[setId].map(async (assetUrl) => {
            const response = await fetch(assetUrl)
            if (!response.ok) {
              throw new Error(`Failed to load typing sound asset: ${assetUrl}`)
            }
            const arrayBuffer = await response.arrayBuffer()
            return await context.decodeAudioData(arrayBuffer)
          }),
        )
      }

      const bassBuffer = await this.loadSingleBuffer(BASS_TYPING_SOUND_ASSET, context)
      const trebleBuffer = await this.loadSingleBuffer(TREBLE_TYPING_SOUND_ASSET, context)

      this.clickBuffersBySet = clickBuffersBySet
      this.bufferGroups.bass = [bassBuffer]
      this.bufferGroups.treble = [trebleBuffer]

      this.reversedClickBuffersBySet = {
        A: clickBuffersBySet.A.map((buffer) => this.createReversedBuffer(buffer, context)),
        B: clickBuffersBySet.B.map((buffer) => this.createReversedBuffer(buffer, context)),
        C: clickBuffersBySet.C.map((buffer) => this.createReversedBuffer(buffer, context)),
      }

      this.flippedClickBuffersBySet = {
        A: clickBuffersBySet.A.map((buffer) => this.createFlippedBuffer(buffer, context)),
        B: clickBuffersBySet.B.map((buffer) => this.createFlippedBuffer(buffer, context)),
        C: clickBuffersBySet.C.map((buffer) => this.createFlippedBuffer(buffer, context)),
      }

      this.reversedFlippedClickBuffersBySet = {
        A: this.reversedClickBuffersBySet.A.map((buffer) => this.createFlippedBuffer(buffer, context)),
        B: this.reversedClickBuffersBySet.B.map((buffer) => this.createFlippedBuffer(buffer, context)),
        C: this.reversedClickBuffersBySet.C.map((buffer) => this.createFlippedBuffer(buffer, context)),
      }

      this.reversedBufferGroups = {
        bass: [this.createReversedBuffer(bassBuffer, context)],
        treble: [this.createReversedBuffer(trebleBuffer, context)],
      }

      this.flippedBufferGroups = {
        bass: [this.createFlippedBuffer(bassBuffer, context)],
        treble: [this.createFlippedBuffer(trebleBuffer, context)],
      }

      this.reversedFlippedBufferGroups = {
        bass: [this.createFlippedBuffer(this.reversedBufferGroups.bass[0], context)],
        treble: [this.createFlippedBuffer(this.reversedBufferGroups.treble[0], context)],
      }

      this.loaded = true
    })()

    return this.loadingPromise
  }

  setLayerEnabled(layerId: string, enabled: boolean): void {
    const layer = this.layers[layerId]
    if (layer) {
      layer.enabled = enabled
    }
  }

  setLayerGain(layerId: string, gain: number): void {
    const layer = this.layers[layerId]
    if (layer) {
      layer.gain = gain
    }
  }

  private getSoundAttributes(options?: TypingSoundPlayOptions) {
    const keyId = options?.keyId
    const existing = keyId
      ? this.recentKeySoundHistory.find((entry) => entry.keyId === keyId)
      : undefined

    if (existing) {
      // Promote the existing key to recent usage and keep the preserved key
      // sound attributes intact for repeated typing.
      this.recentKeySoundHistory = [
        existing,
        ...this.recentKeySoundHistory.filter((entry) => entry.keyId !== keyId),
      ]
      return {
        ...existing.attributes,
        frequencyScale: existing.attributes.frequencyScale ?? 1,
        flipChannels: existing.attributes.flipChannels ?? {
          click: Math.random() < 0.5,
          bass: Math.random() < 0.5,
          treble: Math.random() < 0.5,
        },
      }
    }

    const baseDetune = options?.detune ?? this.getRandomLayerDetune()
    const randomVariance = this.keyVariance > 0 ? (Math.random() * 2 - 1) * this.keyVariance : 0
    const varianceScale = randomVariance >= 0 ? 1 + randomVariance : 1 / (1 - randomVariance)
    const pitchScale = this.pitch >= 0 ? (100 + this.pitch) / 100 : 100 / (100 - this.pitch)
    const flipChannels = {
      click: Math.random() < 0.5,
      bass: Math.random() < 0.5,
      treble: Math.random() < 0.5,
    }
    const attributes = {
      assetIndex: options?.assetIndex ?? Math.floor(Math.random() * TYPING_SOUND_ASSETS[this.activeKeySet].length),
      detune: options?.detune ?? baseDetune,
      playbackRate: options?.playbackRate ?? 1,
      reverse: options?.reverse ?? false,
      gain: options?.gain ?? 1,
      echo: options?.echo ? { ...options.echo } : undefined,
      bassDetune: baseDetune + this.getRandomLayerDetune(),
      trebleDetune: baseDetune + this.getRandomLayerDetune(),
      frequencyScale: varianceScale * pitchScale,
      flipChannels,
    }

    if (keyId) {
      this.recentKeySoundHistory = [
        { keyId, attributes },
        ...this.recentKeySoundHistory.filter((entry) => entry.keyId !== keyId),
      ].slice(0, 10)
    }

    return attributes
  }

  async playRandomClick(options?: TypingSoundPlayOptions): Promise<void> {
    if (!this.enabled) return

    const soundAttributes = this.getSoundAttributes(options)

    await this.playLayer('click', {
      ...options,
      assetIndex: soundAttributes.assetIndex,
      detune: soundAttributes.detune,
      playbackRate: soundAttributes.playbackRate,
      reverse: soundAttributes.reverse,
      gain: soundAttributes.gain,
      echo: soundAttributes.echo,
      frequencyScale: soundAttributes.frequencyScale,
      flipChannels: soundAttributes.flipChannels.click,
    })

    void this.playLayer('bass', {
      ...options,
      detune: soundAttributes.bassDetune,
      playbackRate: soundAttributes.playbackRate,
      reverse: soundAttributes.reverse,
      gain: soundAttributes.gain,
      echo: soundAttributes.echo,
      frequencyScale: soundAttributes.frequencyScale,
      flipChannels: soundAttributes.flipChannels.bass,
    })
    void this.playLayer('treble', {
      ...options,
      detune: soundAttributes.trebleDetune,
      playbackRate: soundAttributes.playbackRate,
      reverse: soundAttributes.reverse,
      gain: soundAttributes.gain,
      echo: soundAttributes.echo,
      frequencyScale: soundAttributes.frequencyScale,
      flipChannels: soundAttributes.flipChannels.treble,
    })
  }

  setTypingSoundEnabled(enabled: boolean): void {
    this.enabled = enabled
  }

  setTypingSoundVariance(amount: number): void {
    this.keyVariance = Math.max(0, Math.min(0.5, amount))
    this.recentKeySoundHistory = []
  }

  setTypingSoundPitch(amount: number): void {
    this.pitch = Math.max(-100, Math.min(100, amount))
    this.recentKeySoundHistory = []
  }

  setTypingSoundSet(setId: TypingSoundSetId): void {
    if (this.activeKeySet !== setId) {
      this.recentKeySoundHistory = []
      this.activeKeySet = setId
    }
  }

  setReverbStrength(amount: number): void {
    this.reverbStrength = Math.max(0, Math.min(1, amount))
    if (this.reverbDryGain && this.reverbWetGain) {
      this.reverbDryGain.gain.value = 1 - this.reverbStrength
      this.reverbWetGain.gain.value = this.reverbStrength
    }
    this.updateReverbImpulseResponse()
  }

  setReverbSpace(amount: number): void {
    this.reverbSpace = Math.max(0, Math.min(1, amount))
    if (this.reverbFilter) {
      const minFreq = 2000
      const maxFreq = 12000
      this.reverbFilter.frequency.value = minFreq + (maxFreq - minFreq) * (1 - this.reverbSpace)
      this.reverbFilter.Q.value = 0.7 + this.reverbSpace * 0.8
    }
    this.updateReverbImpulseResponse()
  }

  private getRandomLayerDetune(): number {
    return Math.floor(Math.random() * 601) - 300
  }

  private async playLayer(layerId: string, options?: TypingSoundPlayOptions): Promise<void> {
    if (!this.loaded || !this.audioContext || !this.masterGain) return

    await this.ensureContextRunning()

    const layer = this.layers[layerId]
    if (!layer || !layer.enabled || layer.assetIndexes.length === 0) return

    const buffers = layerId === 'click'
      ? this.clickBuffersBySet[this.activeKeySet]
      : this.bufferGroups[layerId]
    if (!buffers || buffers.length === 0) return

    const assetIndex = options?.assetIndex !== undefined && layer.assetIndexes.includes(options.assetIndex)
      ? options.assetIndex
      : layer.assetIndexes[Math.floor(Math.random() * layer.assetIndexes.length)]
    const buffer = buffers[assetIndex]
    if (!buffer) return

    const source = this.audioContext.createBufferSource()
    const selectedBuffer = this.getLayerBuffer(layerId, assetIndex, options?.reverse ?? false, options?.flipChannels ?? false)
    if (!selectedBuffer) return
    source.buffer = selectedBuffer

    if (options?.frequencyScale !== undefined) {
      source.playbackRate.value = (options?.playbackRate ?? 1) * options.frequencyScale
    } else if (options?.playbackRate !== undefined) {
      source.playbackRate.value = options.playbackRate
    }
    if (options?.detune !== undefined) {
      source.detune.value = options.detune
    }

    const effectiveGain = (options?.gain !== undefined ? options.gain : 1) * layer.gain
    const gainNode = this.audioContext.createGain()
    gainNode.gain.value = effectiveGain
    source.connect(gainNode)

    if (this.reverbDryGain && this.reverbNode) {
      gainNode.connect(this.reverbDryGain)
      gainNode.connect(this.reverbNode)
    } else if (this.masterGain) {
      gainNode.connect(this.masterGain)
    }

    const echoSources: Array<{ source: AudioBufferSourceNode; gainNode: GainNode; delayMs: number }> = []
    if (options?.echo && this.masterGain) {
      const { count, delayMs, decay } = options.echo
      for (let i = 1; i <= count; i += 1) {
        const echoSource = this.audioContext.createBufferSource()
        echoSource.buffer = source.buffer
        const echoPlaybackRate = options?.frequencyScale !== undefined
          ? (options?.playbackRate ?? 1) * options.frequencyScale
          : options?.playbackRate ?? 1
        echoSource.playbackRate.value = echoPlaybackRate
        if (options?.detune !== undefined) {
          echoSource.detune.value = options.detune
        }

        const echoGainNode = this.audioContext.createGain()
        echoGainNode.gain.value = effectiveGain * Math.pow(decay, i)
        if (this.reverbDryGain && this.reverbNode) {
          echoSource.connect(echoGainNode)
          echoGainNode.connect(this.reverbDryGain)
          echoGainNode.connect(this.reverbNode)
        } else {
          echoSource.connect(echoGainNode).connect(this.masterGain)
        }
        echoSources.push({ source: echoSource, gainNode: echoGainNode, delayMs: delayMs * i })
      }
    }

    const playbackRate = options?.frequencyScale !== undefined
      ? (options?.playbackRate ?? 1) * options.frequencyScale
      : options?.playbackRate ?? 1
    source.start()
    for (let i = 0; i < echoSources.length; i += 1) {
      const echo = echoSources[i]
      echo.source.start(this.audioContext.currentTime + (options?.echo!.delayMs ?? 0) * (i + 1) / 1000)
    }

    const directDurationMs = (buffer.duration / playbackRate) * 1000
    const echoDelayMs = options?.echo ? options.echo.delayMs * options.echo.count : 0
    const cleanupDelayMs = directDurationMs + echoDelayMs + 100

    window.setTimeout(() => {
      try {
        source.disconnect()
      } catch {
        // best effort cleanup
      }
      try {
        gainNode.disconnect()
      } catch {
        // best effort cleanup
      }
      for (const echo of echoSources) {
        try {
          echo.source.disconnect()
        } catch {
          // best effort cleanup
        }
        try {
          echo.gainNode.disconnect()
        } catch {
          // best effort cleanup
        }
      }
    }, cleanupDelayMs)
  }

  private getReversedBuffer(layerId: string, assetIndex: number): AudioBuffer | null {
    if (layerId === 'click') {
      return this.reversedClickBuffersBySet?.[this.activeKeySet]?.[assetIndex] ?? null
    }

    if (!this.reversedBufferGroups) return null
    const layerBuffers = this.reversedBufferGroups[layerId]
    return layerBuffers?.[assetIndex] ?? null
  }

  private getFlippedBuffer(layerId: string, assetIndex: number): AudioBuffer | null {
    if (layerId === 'click') {
      return this.flippedClickBuffersBySet[this.activeKeySet]?.[assetIndex] ?? null
    }

    if (!this.flippedBufferGroups) return null
    const layerBuffers = this.flippedBufferGroups[layerId]
    return layerBuffers?.[assetIndex] ?? null
  }

  private getReversedFlippedBuffer(layerId: string, assetIndex: number): AudioBuffer | null {
    if (layerId === 'click') {
      return this.reversedFlippedClickBuffersBySet?.[this.activeKeySet]?.[assetIndex] ?? null
    }

    if (!this.reversedFlippedBufferGroups) return null
    const layerBuffers = this.reversedFlippedBufferGroups[layerId]
    return layerBuffers?.[assetIndex] ?? null
  }

  private getLayerBuffer(layerId: string, assetIndex: number, reverse: boolean, flipChannels: boolean): AudioBuffer | null {
    if (layerId === 'click') {
      if (reverse && flipChannels) {
        return this.getReversedFlippedBuffer(layerId, assetIndex)
      }
      if (reverse) {
        return this.getReversedBuffer(layerId, assetIndex)
      }
      if (flipChannels) {
        return this.getFlippedBuffer(layerId, assetIndex)
      }
      return this.clickBuffersBySet[this.activeKeySet]?.[assetIndex] ?? null
    }

    const baseLayer = this.bufferGroups[layerId]
    if (!baseLayer) return null

    if (reverse && flipChannels) {
      return this.getReversedFlippedBuffer(layerId, assetIndex)
    }
    if (reverse) {
      return this.getReversedBuffer(layerId, assetIndex)
    }
    if (flipChannels) {
      return this.getFlippedBuffer(layerId, assetIndex)
    }
    return baseLayer[assetIndex]
  }

  private createFlippedBuffer(buffer: AudioBuffer, context: AudioContext): AudioBuffer {
    const flipped = context.createBuffer(buffer.numberOfChannels, buffer.length, buffer.sampleRate)
    for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
      const sourceData = buffer.getChannelData(channel)
      const flippedData = flipped.getChannelData(channel)
      flippedData.set(sourceData)
    }

    if (buffer.numberOfChannels >= 2) {
      const left = flipped.getChannelData(0)
      const right = flipped.getChannelData(1)
      for (let i = 0; i < buffer.length; i += 1) {
        const temp = left[i]
        left[i] = right[i]
        right[i] = temp
      }
    }

    return flipped
  }

  private async loadSingleBuffer(assetUrl: string, context: AudioContext): Promise<AudioBuffer> {
    const response = await fetch(assetUrl)
    if (!response.ok) {
      throw new Error(`Failed to load typing sound asset: ${assetUrl}`)
    }
    const arrayBuffer = await response.arrayBuffer()
    return await context.decodeAudioData(arrayBuffer)
  }

  private async ensureContextRunning(): Promise<void> {
    if (!this.audioContext) return
    if (this.audioContext.state !== 'suspended') return

    try {
      await this.audioContext.resume()
    } catch {
      // If resume fails, the next user gesture may still allow playback.
    }
  }

  private createAudioContext(): AudioContext {
    if (this.audioContext) return this.audioContext
    const AudioContextConstructor = window.AudioContext || (window as any).webkitAudioContext
    return new AudioContextConstructor()
  }

  private updateReverbImpulseResponse(): void {
    if (!this.audioContext || !this.reverbNode) return

    const durationSec = 0.8 + this.reverbStrength * 1.7
    const decay = 1 + this.reverbStrength * 3
    const buffer = this.createReverbImpulseResponse(this.audioContext, durationSec, decay, this.reverbSpace)
    this.reverbNode.buffer = buffer
  }

  private createReverbImpulseResponse(context: AudioContext, durationSec: number, decay: number, roomSpace: number): AudioBuffer {
    const sampleRate = context.sampleRate
    const length = Math.round(sampleRate * durationSec)
    const impulse = context.createBuffer(2, length, sampleRate)
    const diffusion = 0.3 + roomSpace * 0.55

    for (let channel = 0; channel < 2; channel += 1) {
      const channelData = impulse.getChannelData(channel)
      let previous = 0
      for (let i = 0; i < length; i += 1) {
        const progress = i / length
        const envelope = Math.pow(1 - progress, decay)
        const noise = (Math.random() * 2 - 1) * envelope
        previous = previous * diffusion + noise * (1 - diffusion)
        channelData[i] = previous
      }
    }
    return impulse
  }

  private createReversedBuffer(buffer: AudioBuffer, context: AudioContext): AudioBuffer {
    const reversed = context.createBuffer(buffer.numberOfChannels, buffer.length, buffer.sampleRate)
    for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
      const sourceData = buffer.getChannelData(channel)
      const reversedData = reversed.getChannelData(channel)
      for (let i = 0; i < buffer.length; i += 1) {
        reversedData[i] = sourceData[buffer.length - 1 - i]
      }
    }
    return reversed
  }
}

export const typingSoundManager = new TypingSoundManager()
export { DEFAULT_TYPING_SOUND_SET }
