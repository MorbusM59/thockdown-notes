import { TYPING_SOUND_ASSETS } from './typingSounds'

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
  detune?: number
  playbackRate?: number
  reverse?: boolean
  gain?: number
  echo?: TypingSoundEchoOptions
}

export class TypingSoundManager {
  private audioContext: AudioContext | null = null
  private masterGain: GainNode | null = null
  private buffers: AudioBuffer[] = []
  private reversedBuffers: AudioBuffer[] | null = null
  private loaded = false
  private loadingPromise: Promise<void> | null = null
  private layers: Record<string, TypingSoundLayerConfig> = {
    click: {
      enabled: true,
      gain: 1,
      assetIndexes: TYPING_SOUND_ASSETS.map((_, index) => index),
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

      const buffers = await Promise.all(
        TYPING_SOUND_ASSETS.map(async (assetUrl) => {
          const response = await fetch(assetUrl)
          if (!response.ok) {
            throw new Error(`Failed to load typing sound asset: ${assetUrl}`)
          }
          const arrayBuffer = await response.arrayBuffer()
          return await context.decodeAudioData(arrayBuffer)
        }),
      )

      this.buffers = buffers
      this.reversedBuffers = buffers.map((buffer) => this.createReversedBuffer(buffer, context))
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

  async playRandomClick(options?: TypingSoundPlayOptions): Promise<void> {
    await this.playLayer('click', options)
  }

  private async playLayer(layerId: string, options?: TypingSoundPlayOptions): Promise<void> {
    if (!this.loaded || !this.audioContext || !this.masterGain) return

    await this.ensureContextRunning()

    const layer = this.layers[layerId]
    if (!layer || !layer.enabled || layer.assetIndexes.length === 0) return

    const assetIndex = layer.assetIndexes[Math.floor(Math.random() * layer.assetIndexes.length)]
    const buffer = this.buffers[assetIndex]
    if (!buffer) return

    const source = this.audioContext.createBufferSource()
    source.buffer = options?.reverse ? this.getReversedBuffer(assetIndex) : buffer

    if (options?.playbackRate !== undefined) {
      source.playbackRate.value = options.playbackRate
    }
    if (options?.detune !== undefined) {
      source.detune.value = options.detune
    }

    const effectiveGain = options?.gain ?? layer.gain
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

  private getReversedBuffer(assetIndex: number): AudioBuffer | null {
    if (!this.reversedBuffers) return null
    return this.reversedBuffers[assetIndex] ?? null
  }
}

export const typingSoundManager = new TypingSoundManager()
