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
  }
}

export class TypingSoundManager {
  private audioContext: AudioContext | null = null
  private masterGain: GainNode | null = null
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
  private reversedClickBuffersBySet: Record<TypingSoundSetId, AudioBuffer[]> | null = null
  private activeKeySet: TypingSoundSetId = DEFAULT_TYPING_SOUND_SET
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
      masterGain.gain.value = 1
      masterGain.connect(context.destination)

      this.audioContext = context
      this.masterGain = masterGain

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

      this.reversedBufferGroups = {
        bass: [this.createReversedBuffer(bassBuffer, context)],
        treble: [this.createReversedBuffer(trebleBuffer, context)],
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
      // Promote the existing key to recent usage.
      this.recentKeySoundHistory = [
        existing,
        ...this.recentKeySoundHistory.filter((entry) => entry.keyId !== keyId),
      ]
      return existing.attributes
    }

    const baseDetune = options?.detune ?? 0
    const attributes = {
      assetIndex: options?.assetIndex ?? Math.floor(Math.random() * TYPING_SOUND_ASSETS[this.activeKeySet].length),
      detune: options?.detune ?? 0,
      playbackRate: options?.playbackRate ?? 1,
      reverse: options?.reverse ?? false,
      gain: options?.gain ?? 1,
      echo: options?.echo ? { ...options.echo } : undefined,
      bassDetune: baseDetune + this.getRandomLayerDetune(),
      trebleDetune: baseDetune + this.getRandomLayerDetune(),
    }

    if (keyId) {
      this.recentKeySoundHistory = [
        { keyId, attributes },
        ...this.recentKeySoundHistory.filter((entry) => entry.keyId !== keyId),
      ].slice(0, 5)
    }

    return attributes
  }

  async playRandomClick(options?: TypingSoundPlayOptions): Promise<void> {
    const soundAttributes = this.getSoundAttributes(options)

    await this.playLayer('click', {
      ...options,
      assetIndex: soundAttributes.assetIndex,
      detune: soundAttributes.detune,
      playbackRate: soundAttributes.playbackRate,
      reverse: soundAttributes.reverse,
      gain: soundAttributes.gain,
      echo: soundAttributes.echo,
    })

    void this.playLayer('bass', {
      ...options,
      detune: soundAttributes.bassDetune,
      playbackRate: soundAttributes.playbackRate,
      reverse: soundAttributes.reverse,
      gain: soundAttributes.gain,
      echo: soundAttributes.echo,
    })
    void this.playLayer('treble', {
      ...options,
      detune: soundAttributes.trebleDetune,
      playbackRate: soundAttributes.playbackRate,
      reverse: soundAttributes.reverse,
      gain: soundAttributes.gain,
      echo: soundAttributes.echo,
    })
  }

  setTypingSoundSet(setId: TypingSoundSetId): void {
    if (this.activeKeySet !== setId) {
      this.recentKeySoundHistory = []
      this.activeKeySet = setId
    }
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
    const selectedBuffer = options?.reverse ? this.getReversedBuffer(layerId, assetIndex) : buffer
    if (!selectedBuffer) return
    source.buffer = selectedBuffer

    if (options?.playbackRate !== undefined) {
      source.playbackRate.value = options.playbackRate
    }
    if (options?.detune !== undefined) {
      source.detune.value = options.detune
    }

    const effectiveGain = (options?.gain !== undefined ? options.gain : 1) * layer.gain
    const gainNode = this.audioContext.createGain()
    gainNode.gain.value = effectiveGain
    source.connect(gainNode).connect(this.masterGain)

    const echoSources: Array<{ source: AudioBufferSourceNode; gainNode: GainNode; delayMs: number }> = []
    if (options?.echo && this.masterGain) {
      const { count, delayMs, decay } = options.echo
      for (let i = 1; i <= count; i += 1) {
        const echoSource = this.audioContext.createBufferSource()
        echoSource.buffer = source.buffer
        if (options?.playbackRate !== undefined) {
          echoSource.playbackRate.value = options.playbackRate
        }
        if (options?.detune !== undefined) {
          echoSource.detune.value = options.detune
        }

        const echoGainNode = this.audioContext.createGain()
        echoGainNode.gain.value = effectiveGain * Math.pow(decay, i)
        echoSource.connect(echoGainNode).connect(this.masterGain)
        echoSources.push({ source: echoSource, gainNode: echoGainNode, delayMs: delayMs * i })
      }
    }

    const playbackRate = options?.playbackRate ?? 1
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
