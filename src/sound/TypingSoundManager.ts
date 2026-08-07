import { BASS_TYPING_SOUND_ASSET, DEFAULT_TYPING_SOUND_SET, TREBLE_TYPING_SOUND_ASSET, TYPING_SOUND_ASSETS, TYPING_SOUND_SET_IDS, TypingSoundSetId } from './typingSounds'
import type { AudioBounceCacheHit } from '../shared/audioBounceCache'

// The plain-typing character set reachable via deriveTypingSoundKeyId
// (useEditorSectionMount.ts) -- every character that produces a `key:${c}`
// id through ordinary single-character insertion, called with no extra
// options. See maybeStartPrewarm's doc comment for why prewarming is scoped
// to exactly this set and not the whole keyboard.
const PREWARM_CHARSET = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 .,!?;:\'"-_()[]{}/\\@#$%^&*+=<>~`|'
const PREWARM_CHAR_KEY_IDS: string[] = Array.from(new Set(PREWARM_CHARSET.split(''))).map((char) => `key:${char}`)

type IdleRequestWindow = Window & {
  requestIdleCallback?: (callback: (deadline: { didTimeout: boolean; timeRemaining: () => number }) => void, options?: { timeout: number }) => number
}

// Runs work during idle time, chunked so it never competes with input
// handling -- falls back to a short setTimeout on browsers/contexts without
// requestIdleCallback (e.g. older Safari-based WebViews).
function scheduleIdleWork(callback: () => void): void {
  const idleWindow = window as IdleRequestWindow
  if (typeof idleWindow.requestIdleCallback === 'function') {
    idleWindow.requestIdleCallback(() => callback(), { timeout: 500 })
  } else {
    window.setTimeout(callback, 32)
  }
}

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
    D: [],
  }
  private reversedBufferGroups: Record<string, AudioBuffer[]> | null = null
  private flippedBufferGroups: Record<string, AudioBuffer[]> | null = null
  private reversedFlippedBufferGroups: Record<string, AudioBuffer[]> | null = null
  private reversedClickBuffersBySet: Record<TypingSoundSetId, AudioBuffer[]> | null = null
  private flippedClickBuffersBySet: Record<TypingSoundSetId, AudioBuffer[]> = {
    A: [],
    B: [],
    C: [],
    D: [],
  }
  private reversedFlippedClickBuffersBySet: Record<TypingSoundSetId, AudioBuffer[]> | null = null
  private activeKeySet: TypingSoundSetId = DEFAULT_TYPING_SOUND_SET
  private enabled = true
  private keyVariance = 0
  private pitch = 0
  private pitchJitterAmount = 0
  private recentKeySoundHistory: TypingSoundHistoryEntry[] = []
  // Per-key bounced (OfflineAudioContext-rendered) buffers -- see E1 in the
  // performance review. Keyed by keyId; a hit turns playback into a single
  // source.start() instead of rebuilding the full layer/convolver graph.
  // Only ever populated for keyIds whose call site always passes the same
  // fixed override options (see bounceKeySound's doc comment) -- invalidated
  // in lockstep with recentKeySoundHistory any time a setting that affects
  // the bounce changes.
  private boundKeyBuffers: Map<string, AudioBuffer> = new Map()
  private pendingBounces: Set<string> = new Set()
  private prewarmStarted = false
  private prewarmGeneration = 0
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
        D: clickBuffersBySet.D.map((buffer) => this.createReversedBuffer(buffer, context)),
      }

      this.flippedClickBuffersBySet = {
        A: clickBuffersBySet.A.map((buffer) => this.createFlippedBuffer(buffer, context)),
        B: clickBuffersBySet.B.map((buffer) => this.createFlippedBuffer(buffer, context)),
        C: clickBuffersBySet.C.map((buffer) => this.createFlippedBuffer(buffer, context)),
        D: clickBuffersBySet.D.map((buffer) => this.createFlippedBuffer(buffer, context)),
      }

      this.reversedFlippedClickBuffersBySet = {
        A: this.reversedClickBuffersBySet.A.map((buffer) => this.createFlippedBuffer(buffer, context)),
        B: this.reversedClickBuffersBySet.B.map((buffer) => this.createFlippedBuffer(buffer, context)),
        C: this.reversedClickBuffersBySet.C.map((buffer) => this.createFlippedBuffer(buffer, context)),
        D: this.reversedClickBuffersBySet.D.map((buffer) => this.createFlippedBuffer(buffer, context)),
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
      this.maybeStartPrewarm()
    })()

    return this.loadingPromise
  }

  // Resumes the (already-created) AudioContext ahead of the first keystroke,
  // so the one-time hardware spin-up cost lands on an earlier user gesture
  // (window focus, first click) instead of stalling the first typing sound.
  primeAudioContext(): void {
    void this.ensureContextRunning()
  }

  setLayerEnabled(layerId: string, enabled: boolean): void {
    const layer = this.layers[layerId]
    if (layer && layer.enabled !== enabled) {
      layer.enabled = enabled
      this.invalidateKeySoundCaches()
    }
  }

  setLayerGain(layerId: string, gain: number): void {
    const layer = this.layers[layerId]
    if (layer && layer.gain !== gain) {
      layer.gain = gain
      this.invalidateKeySoundCaches()
    }
  }

  // Whether *any* layer (click/bass/treble) is currently capable of
  // producing audible output at all, purely from the persistent slider/
  // toggle settings (layer.enabled, layer.gain) -- never the ephemeral
  // per-call `options.gain` multiplier passed into playLayer, which this
  // codebase only ever uses as a shaping factor (0.3-1), never a literal
  // mute. Used to skip the whole per-keystroke sound pipeline in one check
  // when the answer is already "no" (bass/treble volume both 0, or the
  // click layer off with bass/treble also silent) instead of discovering
  // that three separate times, once per layer, after doing real work.
  private isAnyLayerAudible(): boolean {
    return Object.values(this.layers).some(
      (layer) => layer.enabled && layer.gain > 0 && layer.assetIndexes.length > 0,
    )
  }

  // recentKeySoundHistory (per-key attributes) and boundKeyBuffers (per-key
  // bounced audio, see E1) must always invalidate together -- a bounce is
  // only correct for the attributes/settings it was rendered from.
  private invalidateKeySoundCaches(): void {
    this.recentKeySoundHistory = []
    this.boundKeyBuffers.clear()
    this.pendingBounces.clear()
    // Settings that invalidate the cache (reverb, layer gains, key set...)
    // are exactly the settings a bounce depends on -- rebuild the common
    // charset in the background again rather than waiting for each key to
    // be pressed once more before it's fast again. Bumping the generation
    // makes any in-flight sweep from before this change stop at its next
    // step instead of racing the new one.
    this.prewarmGeneration += 1
    this.prewarmStarted = false
    this.maybeStartPrewarm()
  }

  private getSoundAttributes(options?: TypingSoundPlayOptions) {
    const keyId = options?.keyId
    const existingIndex = keyId
      ? this.recentKeySoundHistory.findIndex((entry) => entry.keyId === keyId)
      : -1

    if (existingIndex !== -1) {
      const existing = this.recentKeySoundHistory[existingIndex]

      // Fill in any missing consistent attributes if they didn't exist in the history entry
      // (e.g. from an older version of the sound history)
      if (existing.attributes.frequencyScale === undefined) {
        const randomVariance = this.keyVariance > 0 ? (Math.random() * 2 - 1) * this.keyVariance : 0
        const varianceScale = randomVariance >= 0 ? 1 + randomVariance : 1 / (1 - randomVariance)
        const pitchScale = this.pitch >= 0 ? (100 + this.pitch) / 100 : 100 / (100 - this.pitch)
        existing.attributes.frequencyScale = varianceScale * pitchScale
      }

      if (!existing.attributes.flipChannels) {
        existing.attributes.flipChannels = {
          click: Math.random() < 0.5,
          bass: Math.random() < 0.5,
          treble: Math.random() < 0.5,
        }
      }

      // Promote the existing key to recent usage
      this.recentKeySoundHistory.splice(existingIndex, 1)
      this.recentKeySoundHistory.unshift(existing)

      // Return the cached attributes, but allow explicit overrides from options
      return {
        ...existing.attributes,
        assetIndex: options?.assetIndex !== undefined ? options.assetIndex : existing.attributes.assetIndex,
        detune: options?.detune !== undefined ? options.detune : existing.attributes.detune,
        playbackRate: options?.playbackRate !== undefined ? options.playbackRate : existing.attributes.playbackRate,
        reverse: options?.reverse !== undefined ? options.reverse : existing.attributes.reverse,
        gain: options?.gain !== undefined ? options.gain : existing.attributes.gain,
        echo: options?.echo !== undefined ? options.echo : existing.attributes.echo,
      }
    }

    // Base detune is only applied when either an explicit `detune` is
    // provided in options or when `keyVariance` is non-zero. Previously
    // getRandomLayerDetune() could produce large random detunes even with
    // `keyVariance === 0`, which made key sounds noticeably pitch-shifted
    // at the default variance. Scale the random detune by keyVariance so
    // zero variance yields no detune.
    const baseDetune = options?.detune ?? (this.keyVariance > 0 ? Math.round(this.getRandomLayerDetune() * this.keyVariance) : 0)
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
      // Additional layer detune offsets are likewise scaled by keyVariance
      // so they don't introduce audible pitch shifts when variance is 0.
      bassDetune: baseDetune + (this.keyVariance > 0 ? Math.round(this.getRandomLayerDetune() * this.keyVariance) : 0),
      trebleDetune: baseDetune + (this.keyVariance > 0 ? Math.round(this.getRandomLayerDetune() * this.keyVariance) : 0),
      frequencyScale: varianceScale * pitchScale,
      flipChannels,
    }

    if (keyId) {
      this.recentKeySoundHistory.unshift({ keyId, attributes })
      if (this.recentKeySoundHistory.length > 10) {
        this.recentKeySoundHistory.pop()
      }
    }

    return attributes
  }

  async playRandomClick(options?: TypingSoundPlayOptions): Promise<void> {
    if (!this.enabled) return
    // Bypasses the entire pipeline -- tryPlayBoundBuffer, getSoundAttributes
    // (both real per-keystroke synchronous work), all three playLayer calls,
    // and the background bounce scheduling -- when every layer is either
    // toggled off or has its volume slider at 0 (e.g. bass/treble volume
    // both 0, or the global key-click volume 0 with bass/treble also 0):
    // none of that work can ever produce audible output, so there is
    // nothing here worth doing on the keystroke's own call stack.
    if (!this.isAnyLayerAudible()) return

    const keyId = options?.keyId
    if (keyId && (await this.tryPlayBoundBuffer(keyId))) {
      return
    }

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

    // First press of this key this "generation" -- bounce it in the
    // background so every later press (the ones that matter for sustained
    // key-repeat) hits the fast single-buffer path instead.
    if (keyId) {
      this.scheduleBounce(keyId)
    }
  }

  setTypingSoundEnabled(enabled: boolean): void {
    if (this.enabled !== enabled) {
      this.enabled = enabled
      // invalidateKeySoundCaches() also (re)starts prewarming when enabled
      // is now true, since maybeStartPrewarm() checks this.enabled.
      this.invalidateKeySoundCaches()
    }
  }

  setTypingSoundVariance(amount: number): void {
    this.keyVariance = Math.max(0, Math.min(0.5, amount))
    this.invalidateKeySoundCaches()
  }

  setTypingSoundPitch(amount: number): void {
    this.pitch = Math.max(-100, Math.min(100, amount))
    this.invalidateKeySoundCaches()
  }

  // Unlike the other setters, this doesn't clear recentKeySoundHistory:
  // jitter must vary per press even for a key that's been pressed before,
  // so it's never baked into the cached per-key attributes -- it's applied
  // live in playLayer instead.
  setPitchJitterAmount(amount: number): void {
    this.pitchJitterAmount = Math.max(0, Math.min(0.5, amount))
  }

  setTypingSoundSet(setId: TypingSoundSetId): void {
    if (this.activeKeySet !== setId) {
      this.invalidateKeySoundCaches()
      this.activeKeySet = setId
    }
  }

  setReverbStrength(amount: number): void {
    const next = Math.max(0, Math.min(1, amount))
    if (this.reverbStrength !== next) {
      this.reverbStrength = next
      this.invalidateKeySoundCaches()
      if (this.reverbDryGain && this.reverbWetGain) {
        this.reverbDryGain.gain.value = 1 - this.reverbStrength
        this.reverbWetGain.gain.value = this.reverbStrength
      }
      this.updateReverbImpulseResponse()
    }
  }

  setReverbSpace(amount: number): void {
    const next = Math.max(0, Math.min(1, amount))
    if (this.reverbSpace !== next) {
      this.reverbSpace = next
      this.invalidateKeySoundCaches()
      if (this.reverbFilter) {
        const minFreq = 2000
        const maxFreq = 12000
        this.reverbFilter.frequency.value = minFreq + (maxFreq - minFreq) * (1 - this.reverbSpace)
        this.reverbFilter.Q.value = 0.7 + this.reverbSpace * 0.8
      }
      this.updateReverbImpulseResponse()
    }
  }

  private getRandomLayerDetune(): number {
    return Math.floor(Math.random() * 601) - 300
  }

  private async playLayer(layerId: string, options?: TypingSoundPlayOptions): Promise<void> {
    if (!this.loaded || !this.audioContext || !this.masterGain) return

    const layer = this.layers[layerId]
    if (!layer || !layer.enabled || layer.assetIndexes.length === 0) return

    // Skip the entire node-creation/connection/echo chain -- including the
    // AudioContext resume check below -- when this layer's own volume is 0:
    // every createBufferSource/createGain/connect/start() call further down
    // would run for zero audible output. options?.gain is only ever a
    // shaping multiplier in this codebase (0.3-1), never a literal mute, so
    // layer.gain alone (the user-controlled slider) is the real signal here.
    const effectiveGain = (options?.gain !== undefined ? options.gain : 1) * layer.gain
    if (effectiveGain <= 0) return

    await this.ensureContextRunning()

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

    // A fresh multiplier per press (not baked into the per-key attributes,
    // unlike frequencyScale) -- see setPitchJitterAmount. Skipped entirely
    // at the default 0 so there's no Math.random() call or playbackRate
    // write when the feature is off.
    const jitterMultiplier = this.pitchJitterAmount > 0
      ? 1 + (Math.random() * 2 - 1) * this.pitchJitterAmount
      : 1

    const basePlaybackRate = options?.frequencyScale !== undefined
      ? (options?.playbackRate ?? 1) * options.frequencyScale
      : options?.playbackRate
    if (basePlaybackRate !== undefined || jitterMultiplier !== 1) {
      source.playbackRate.value = (basePlaybackRate ?? 1) * jitterMultiplier
    }
    if (options?.detune !== undefined) {
      source.detune.value = options.detune
    }

    const gainNode = this.audioContext.createGain()
    gainNode.gain.value = effectiveGain
    source.connect(gainNode)

    if (this.reverbDryGain && this.reverbNode) {
      gainNode.connect(this.reverbDryGain)
      gainNode.connect(this.reverbNode)
    } else if (this.masterGain) {
      gainNode.connect(this.masterGain)
    }

    source.onended = () => {
      this.safeDisconnect(source)
      this.safeDisconnect(gainNode)
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
        echoSource.playbackRate.value = echoPlaybackRate * jitterMultiplier
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
        echoSource.onended = () => {
          this.safeDisconnect(echoSource)
          this.safeDisconnect(echoGainNode)
        }
        echoSources.push({ source: echoSource, gainNode: echoGainNode, delayMs: delayMs * i })
      }
    }

    source.start()
    for (let i = 0; i < echoSources.length; i += 1) {
      const echo = echoSources[i]
      echo.source.start(this.audioContext.currentTime + (options?.echo!.delayMs ?? 0) * (i + 1) / 1000)
    }
  }

  private safeDisconnect(node: AudioNode): void {
    try {
      node.disconnect()
    } catch {
      // best effort cleanup
    }
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

  // Plays a previously-bounced (OfflineAudioContext-rendered) buffer for
  // this key, if one exists -- a single source.start() instead of rebuilding
  // the full layer/gain/convolver graph. Returns false (no-op) on a cache
  // miss so the caller can fall back to live synthesis.
  private async tryPlayBoundBuffer(keyId: string): Promise<boolean> {
    const buffer = this.boundKeyBuffers.get(keyId)
    if (!buffer || !this.audioContext || !this.masterGain) return false

    await this.ensureContextRunning()

    const source = this.audioContext.createBufferSource()
    source.buffer = buffer

    // Jitter is never baked into the bounce (see setPitchJitterAmount) --
    // applied live here instead, same as the live-synthesis path.
    if (this.pitchJitterAmount > 0) {
      source.playbackRate.value = 1 + (Math.random() * 2 - 1) * this.pitchJitterAmount
    }

    source.connect(this.masterGain)
    source.onended = () => this.safeDisconnect(source)
    source.start()
    return true
  }

  // Idle-schedules a background bounce for a key that was just played live,
  // so the NEXT press of that key (the ones that matter for sustained
  // key-repeat) hits tryPlayBoundBuffer instead. No-op if already cached or
  // already in flight.
  private scheduleBounce(keyId: string): void {
    if (this.boundKeyBuffers.has(keyId) || this.pendingBounces.has(keyId)) return
    this.pendingBounces.add(keyId)
    scheduleIdleWork(() => {
      void this.bounceKeySound(keyId).finally(() => {
        this.pendingBounces.delete(keyId)
      })
    })
  }

  // Only meant to run once per "generation" (see invalidateKeySoundCaches):
  // idle-prewarms the plain typing charset (the keys reachable via
  // playRandomClick({ keyId }) with no other options -- see
  // deriveTypingSoundKeyId) so the FIRST press of an ordinary character
  // already hits the fast path, not just the second. Keys whose call site
  // always passes extra fixed options (arrows, backspace, tab, undo/redo --
  // see bounceKeySound) are intentionally excluded: prewarming them would
  // mean guessing those options, and guessing wrong would bake a wrong
  // detune/gain/echo into the cached bounce. Those still get bounced
  // reactively via scheduleBounce after their own first real press.
  private maybeStartPrewarm(): void {
    if (this.prewarmStarted || !this.loaded || !this.enabled) return
    this.prewarmStarted = true
    this.schedulePrewarm(this.prewarmGeneration)
  }

  private schedulePrewarm(generation: number): void {
    const keyIds = PREWARM_CHAR_KEY_IDS
    let index = 0

    const step = () => {
      if (generation !== this.prewarmGeneration) return
      if (index >= keyIds.length) return
      const keyId = keyIds[index]
      index += 1

      if (this.boundKeyBuffers.has(keyId) || this.pendingBounces.has(keyId)) {
        scheduleIdleWork(step)
        return
      }

      this.pendingBounces.add(keyId)
      // Seeds attributes exactly as a real plain-typing press would
      // (playRandomClick({ keyId }), no other options) so the bounce
      // matches what that press will actually sound like.
      this.getSoundAttributes({ keyId })
      void this.bounceKeySound(keyId).finally(() => {
        this.pendingBounces.delete(keyId)
        scheduleIdleWork(step)
      })
    }

    scheduleIdleWork(step)
  }

  // Renders one key's full sound (click + bass/treble layers, reverb, and
  // (for the few keyIds that use it) echo) to a single AudioBuffer via
  // OfflineAudioContext, using the attributes already assigned to that key
  // in recentKeySoundHistory. This is only correct because every call site
  // that passes a given keyId always passes the exact same detune/reverse/
  // gain/echo overrides for that keyId (verified against every
  // playRandomClick call site in the app) -- getSoundAttributes' override
  // merge means the cached attributes already reflect those fixed overrides
  // after the first real press, so re-reading them here is equivalent to
  // replaying that press.
  private async bounceKeySound(keyId: string): Promise<void> {
    if (!this.audioContext) return

    // E4: a disk hit for this exact (keyId, settingsSignature) skips the
    // OfflineAudioContext render entirely -- this is what makes a relaunch
    // (not just the rest of one session) skip the render, mirroring
    // useTextureSurface's persistent cache pattern.
    const signature = this.computeAudioBounceSignature()
    const diskBuffer = await this.tryLoadDiskBounce(keyId, signature)
    if (diskBuffer) {
      this.boundKeyBuffers.set(keyId, diskBuffer)
      return
    }

    const entry = this.recentKeySoundHistory.find((historyEntry) => historyEntry.keyId === keyId)
    if (!entry) return
    const attrs = entry.attributes

    type LayerBouncePlan = { buffer: AudioBuffer; detune: number; gainMultiplier: number }
    const layerPlans: LayerBouncePlan[] = []

    if (this.layers.click.enabled && this.layers.click.gain > 0) {
      const buffer = this.getLayerBuffer('click', attrs.assetIndex, attrs.reverse, attrs.flipChannels.click)
      if (buffer) layerPlans.push({ buffer, detune: attrs.detune, gainMultiplier: this.layers.click.gain })
    }
    // E3: mirrors A3's "skip zero-gain layers" guard, moved from the live
    // path (where it no longer applies -- see E1) to render time.
    if (this.layers.bass.enabled && this.layers.bass.gain > 0) {
      const buffer = this.getLayerBuffer('bass', 0, attrs.reverse, attrs.flipChannels.bass)
      if (buffer) layerPlans.push({ buffer, detune: attrs.bassDetune, gainMultiplier: this.layers.bass.gain })
    }
    if (this.layers.treble.enabled && this.layers.treble.gain > 0) {
      const buffer = this.getLayerBuffer('treble', 0, attrs.reverse, attrs.flipChannels.treble)
      if (buffer) layerPlans.push({ buffer, detune: attrs.trebleDetune, gainMultiplier: this.layers.treble.gain })
    }
    if (layerPlans.length === 0) return

    const effectiveRate = Math.max(0.01, attrs.playbackRate * attrs.frequencyScale)
    const echo = attrs.echo
    const echoTailSec = echo ? (echo.delayMs * echo.count) / 1000 : 0
    const reverbTailSec = this.reverbStrength > 0 ? 0.8 + this.reverbStrength * 1.7 : 0
    const maxRawDurationSec = Math.max(...layerPlans.map((plan) => plan.buffer.duration))
    const totalDurationSec = maxRawDurationSec / effectiveRate + echoTailSec + reverbTailSec + 0.1
    const sampleRate = this.audioContext.sampleRate
    const length = Math.max(1, Math.ceil(totalDurationSec * sampleRate))

    let offlineContext: OfflineAudioContext
    try {
      offlineContext = new OfflineAudioContext(2, length, sampleRate)
    } catch {
      return
    }

    const offlineMasterGain = offlineContext.createGain()
    offlineMasterGain.gain.value = 1
    offlineMasterGain.connect(offlineContext.destination)

    // E3: mirrors A2's "skip the convolver at zero reverb" guard.
    let offlineDryGain: GainNode | null = null
    let offlineReverbNode: ConvolverNode | null = null
    if (this.reverbStrength > 0 && this.reverbNode?.buffer) {
      offlineDryGain = offlineContext.createGain()
      const offlineWetGain = offlineContext.createGain()
      offlineReverbNode = offlineContext.createConvolver()
      const offlineReverbFilter = offlineContext.createBiquadFilter()
      offlineDryGain.gain.value = 1 - this.reverbStrength
      offlineWetGain.gain.value = this.reverbStrength
      offlineReverbFilter.type = 'lowpass'
      offlineReverbFilter.frequency.value = this.reverbFilter?.frequency.value ?? 12000
      offlineReverbFilter.Q.value = this.reverbFilter?.Q.value ?? 0.7
      // AudioBuffers aren't tied to the context that created them -- reusing
      // the live reverb tail avoids recomputing the same noise buffer here.
      offlineReverbNode.buffer = this.reverbNode.buffer
      offlineDryGain.connect(offlineMasterGain)
      offlineReverbNode.connect(offlineReverbFilter).connect(offlineWetGain).connect(offlineMasterGain)
    }

    const connectToDestination = (gainNode: GainNode) => {
      if (offlineDryGain && offlineReverbNode) {
        gainNode.connect(offlineDryGain)
        gainNode.connect(offlineReverbNode)
      } else {
        gainNode.connect(offlineMasterGain)
      }
    }

    const scheduleLayerSources = (startTimeSec: number, decayMultiplier: number) => {
      for (const plan of layerPlans) {
        const source = offlineContext.createBufferSource()
        source.buffer = plan.buffer
        source.playbackRate.value = effectiveRate
        source.detune.value = plan.detune
        const gainNode = offlineContext.createGain()
        gainNode.gain.value = (attrs.gain ?? 1) * plan.gainMultiplier * decayMultiplier
        source.connect(gainNode)
        connectToDestination(gainNode)
        source.start(startTimeSec)
      }
    }

    scheduleLayerSources(0, 1)
    if (echo) {
      for (let i = 1; i <= echo.count; i += 1) {
        scheduleLayerSources((echo.delayMs * i) / 1000, Math.pow(echo.decay, i))
      }
    }

    try {
      const renderedBuffer = await offlineContext.startRendering()
      this.boundKeyBuffers.set(keyId, renderedBuffer)
      this.saveDiskBounce(keyId, signature, renderedBuffer)
    } catch {
      // Offline render failed -- leave this key uncached; the live-synthesis
      // fallback in playRandomClick keeps working on every future press,
      // and scheduleBounce will simply be tried again next press.
    }
  }

  // Everything that affects a bounce's rendered PCM -- a disk-cached entry
  // is only valid for the exact signature it was rendered under. Per-key
  // randomized attributes (frequencyScale, detune, flipChannels...) are
  // deliberately NOT part of this: once a key has been bounced (this
  // session or a previous one), its sound stays whatever it first rolled
  // until a signature-affecting setting changes -- the same "deterministic
  // per key" contract recentKeySoundHistory already has in-session,
  // extended across relaunches.
  private computeAudioBounceSignature(): string {
    return [
      this.activeKeySet,
      this.reverbStrength.toFixed(3),
      this.reverbSpace.toFixed(3),
      this.layers.click.enabled ? 1 : 0,
      this.layers.click.gain.toFixed(3),
      this.layers.bass.enabled ? 1 : 0,
      this.layers.bass.gain.toFixed(3),
      this.layers.treble.enabled ? 1 : 0,
      this.layers.treble.gain.toFixed(3),
      this.keyVariance.toFixed(3),
      this.pitch.toFixed(3),
    ].join('|')
  }

  // window.thockdownAudioBounces only exists in the packaged Electron app
  // (see electron/preload.ts) -- absent in plain browser-dev mode, where E4
  // simply degrades to E1's in-memory-only, per-session cache.
  private async tryLoadDiskBounce(keyId: string, signature: string): Promise<AudioBuffer | null> {
    const api = window.thockdownAudioBounces
    if (!api) return null
    try {
      const hit = await api.getCachedBounce({ keyId, settingsSignature: signature })
      if (!hit) return null
      return this.deserializeAudioBuffer(hit)
    } catch {
      return null
    }
  }

  private saveDiskBounce(keyId: string, signature: string, buffer: AudioBuffer): void {
    const api = window.thockdownAudioBounces
    if (!api) return
    try {
      void api.saveCachedBounce({ keyId, settingsSignature: signature }, this.serializeAudioBuffer(buffer))
    } catch {
      // Best effort -- the in-memory cache (already populated by the
      // caller) keeps this session fast regardless of disk persistence.
    }
  }

  private serializeAudioBuffer(buffer: AudioBuffer): AudioBounceCacheHit {
    const numberOfChannels = buffer.numberOfChannels
    const length = buffer.length
    const combined = new Float32Array(numberOfChannels * length)
    for (let channel = 0; channel < numberOfChannels; channel += 1) {
      combined.set(buffer.getChannelData(channel), channel * length)
    }
    return {
      data: new Uint8Array(combined.buffer, combined.byteOffset, combined.byteLength),
      sampleRate: buffer.sampleRate,
      numberOfChannels,
      length,
    }
  }

  private deserializeAudioBuffer(hit: AudioBounceCacheHit): AudioBuffer | null {
    if (hit.numberOfChannels <= 0 || hit.length <= 0) return null
    if (hit.data.byteLength !== hit.numberOfChannels * hit.length * Float32Array.BYTES_PER_ELEMENT) return null

    const buffer = new AudioBuffer({
      numberOfChannels: hit.numberOfChannels,
      length: hit.length,
      sampleRate: hit.sampleRate,
    })
    // Rebuilt into a fresh, guaranteed-ArrayBuffer-backed Float32Array
    // rather than viewing hit.data.buffer directly -- that buffer's type is
    // the broader ArrayBufferLike (it could in principle be a
    // SharedArrayBuffer), which copyToChannel's stricter typing rejects.
    const floatView = new Float32Array(hit.numberOfChannels * hit.length)
    new Uint8Array(floatView.buffer).set(hit.data)
    for (let channel = 0; channel < hit.numberOfChannels; channel += 1) {
      buffer.copyToChannel(floatView.subarray(channel * hit.length, (channel + 1) * hit.length), channel)
    }
    return buffer
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
    const AudioContextConstructor =
      window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
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
