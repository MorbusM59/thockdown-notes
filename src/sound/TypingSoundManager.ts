import { TYPING_SOUND_ASSETS } from './typingSounds'

export interface TypingSoundLayerConfig {
  enabled: boolean
  gain: number
  assetIndexes: number[]
}

export interface TypingSoundPlayOptions {
  detune?: number
  playbackRate?: number
}

export class TypingSoundManager {
  private audioContext: AudioContext | null = null
  private masterGain: GainNode | null = null
  private buffers: AudioBuffer[] = []
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
    source.buffer = buffer

    if (options?.playbackRate !== undefined) {
      source.playbackRate.value = options.playbackRate
    }
    if (options?.detune !== undefined) {
      source.detune.value = options.detune
    }

    const gainNode = this.audioContext.createGain()
    gainNode.gain.value = layer.gain
    source.connect(gainNode).connect(this.masterGain)

    source.start()
    source.onended = () => {
      source.disconnect()
      gainNode.disconnect()
    }
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
}

export const typingSoundManager = new TypingSoundManager()
