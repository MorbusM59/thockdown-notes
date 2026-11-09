import { KEYSTROKE_CHANNEL_IDS, type KeystrokeChannelId, type KeystrokeChannelSettings } from '../shared/keystrokeSounds'
import { KEYSTROKE_CHANNEL_ASSETS } from './typingSounds'

// Physical left-to-right position (-1 leftmost .. 1 rightmost) of every key
// in the standard alphanumeric block, for the spatial slider's mode A
// (keyboard-position panning) -- keyed by KeyboardEvent.code, NOT by the
// character it produces. `code` identifies a physical key position and is
// the same regardless of the OS keyboard layout/language active (a US
// layout and a German QWERTZ layout both report `code: "KeyY"` for the key
// physically located where a US keyboard's Y sits, even though QWERTZ
// produces the character "Z" there). Keying this table by produced
// character instead would put e.g. German Z/Y panning on the wrong side
// (QWERTZ swaps their physical positions relative to QWERTY), and would
// have no entry at all for layout-specific keys like a German keyboard's
// dedicated Ä/Ö/Ü/ß keys. Row stagger is ignored -- only left-to-right
// order within a row matters for a pan value.
//
// IntlBackslash (the extra key ISO/European keyboards, including German,
// have between left Shift and Z -- absent on US ANSI keyboards) is
// included as the leftmost of the bottom row so it doesn't collapse onto
// KeyZ's position for the keyboards that do have it.
const KEYBOARD_PAN_ROWS_BY_CODE: string[][] = [
  ['Backquote', 'Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7', 'Digit8', 'Digit9', 'Digit0', 'Minus', 'Equal'],
  ['KeyQ', 'KeyW', 'KeyE', 'KeyR', 'KeyT', 'KeyY', 'KeyU', 'KeyI', 'KeyO', 'KeyP', 'BracketLeft', 'BracketRight', 'Backslash'],
  ['KeyA', 'KeyS', 'KeyD', 'KeyF', 'KeyG', 'KeyH', 'KeyJ', 'KeyK', 'KeyL', 'Semicolon', 'Quote'],
  ['IntlBackslash', 'KeyZ', 'KeyX', 'KeyC', 'KeyV', 'KeyB', 'KeyN', 'KeyM', 'Comma', 'Period', 'Slash'],
]

function buildKeyboardPanByCode(): ReadonlyMap<string, number> {
  const table = new Map<string, number>()
  for (const row of KEYBOARD_PAN_ROWS_BY_CODE) {
    const columnCount = row.length
    for (let index = 0; index < columnCount; index += 1) {
      const pan = columnCount > 1 ? (index / (columnCount - 1)) * 2 - 1 : 0
      table.set(row[index], pan)
    }
  }
  table.set('Space', 0)
  return table
}

const KEYBOARD_PAN_BY_CODE = buildKeyboardPanByCode()

// Exported standalone (rather than kept private on the class) so it's
// testable without an AudioContext, matching this file's existing pattern
// for pure decision logic (shouldSuppressPlainTypingSoundForInsertion).
// Purely a function of the physical key
// code, so mode A needs no per-locale table -- non-character keys (Tab,
// ArrowLeft, Backspace, ...) are simply absent from KEYBOARD_PAN_BY_CODE
// and resolve to center, matching "non character keys are centered".
export function resolveKeyboardPanForCode(physicalKeyCode?: string): number {
  if (!physicalKeyCode) return 0
  return KEYBOARD_PAN_BY_CODE.get(physicalKeyCode) ?? 0
}

let suppressNextPlainTypingSound = false

export function suppressNextPlainTypingSoundOnce(): void {
  suppressNextPlainTypingSound = true
}

export function shouldSuppressPlainTypingSoundForInsertion(event: {
  source: string
  text: string
  previousText: string
  selection: { start: number }
}): boolean {
  if (event.source !== 'user-input') return false
  if (suppressNextPlainTypingSound) {
    suppressNextPlainTypingSound = false
    return true
  }
  const delta = event.text.length - event.previousText.length
  if (delta !== 1) return false
  const insertedChar = event.text[event.selection.start - 1]
  return insertedChar === '\n' || insertedChar === '\r'
}

export interface TypingSoundEchoOptions {
  delayMs: number
  count: number
  decay: number
}

export interface TypingSoundPlayOptions {
  /**
   * Names the key, so it always gets the same sample of each channel, the
   * same channel swap and the same place in the variance spread. A press
   * without one draws all of those afresh.
   */
  keyId?: string
  /** A click sample chosen by the caller (modulo each click channel's sample count) in place of the key's own. */
  assetIndex?: number
  detune?: number
  playbackRate?: number
  reverse?: boolean
  gain?: number
  echo?: TypingSoundEchoOptions
  // Caller-supplied spatial-mode-B position (-1 leftmost .. 1 rightmost),
  // e.g. from EditorAdapter.resolveCaretHorizontalWrapRatio(). Only
  // consulted when the spatial slider is dialed towards mode B -- see
  // resolveEffectivePan.
  pan?: number
  // The physical key (KeyboardEvent.code) that produced this press, for
  // spatial-mode-A (keyboard-position) panning -- see
  // resolveKeyboardPanForCode's doc comment for why this must be the
  // layout-independent physical code, not keyId's produced character.
  physicalKeyCode?: string
}

/**
 * What is fixed about a key: random draws made on its first press and kept,
 * stored as UNITS (each -1..1 or a coin) rather than as finished values, so
 * that the settings they are scaled by (variance, pitch, which channels are
 * on) can change without re-rolling anything and without a cache to throw
 * away.
 */
interface KeyCharacter {
  /** -1..1, scaled by variance into the key's playback-rate offset. */
  varianceUnit: number
  /** -1..1 per channel, scaled by variance into that channel's detune (up to 300 cents at full variance). */
  detuneUnits: Record<KeystrokeChannelId, number>
  /** The sample each channel plays for this key. */
  sample: Record<KeystrokeChannelId, number>
  /** Whether each channel plays this key with left and right swapped: the statistical centring of a stereo sample. */
  flip: Record<KeystrokeChannelId, boolean>
}

/** Every channel's buffers, in the four forms a press can ask for, decoded or computed once at load. */
interface ChannelBuffers {
  plain: AudioBuffer[]
  flipped: AudioBuffer[]
  reversed: AudioBuffer[]
  reversedFlipped: AudioBuffer[]
}

const OFF_CHANNEL: KeystrokeChannelSettings = { on: false, volume: 0, jitter: 0 }

/** Up to this many cents each way at full variance: the per-channel detune spread. */
const VARIANCE_DETUNE_CENTS = 300

/**
 * The keystroke sound engine. A keystroke is one VOICE: one buffer source
 * and one gain per channel that is on, summed into one optional stereo
 * panner, into the shared dry path and the shared reverb send (one
 * convolver for every voice, built once). Nothing is rendered ahead and
 * nothing is cached but the decoded samples, which is why no setting change
 * costs anything beyond writing a number: volume and jitter are per-press
 * gains and rates, variance and pitch scale the key's stored units at the
 * press, reverb and room write the shared send.
 *
 * Replaced a per-key BOUNCE (an OfflineAudioContext render of the summed
 * layers per key, kept in memory and on disk, swept in the background and
 * thrown away on every change of volume, set, variance or pitch). Summing
 * live is a few native nodes per press, so the bounce only ever saved that
 * summing, and with channels each mix of volumes would have been another
 * bounce.
 */
export class TypingSoundManager {
  private audioContext: AudioContext | null = null
  private masterGain: GainNode | null = null
  private reverbNode: ConvolverNode | null = null
  private reverbFilter: BiquadFilterNode | null = null
  private reverbDryGain: GainNode | null = null
  private reverbWetGain: GainNode | null = null
  private reverbStrength = 0
  private reverbSpace = 0
  private buffers: Partial<Record<KeystrokeChannelId, ChannelBuffers>> = {}
  private channels: Record<KeystrokeChannelId, KeystrokeChannelSettings> = Object.fromEntries(KEYSTROKE_CHANNEL_IDS.map((id) => [id, OFF_CHANNEL])) as Record<KeystrokeChannelId, KeystrokeChannelSettings>
  private enabled = false
  private volume = 1
  private keyVariance = 0
  private pitch = 0
  // -1..1. Negative dials in mode A (keyboard-position pan) by |amount|;
  // positive dials in mode B (caret-position pan, supplied per-call via
  // TypingSoundPlayOptions.pan) by amount; 0 is no panning. See
  // resolveEffectivePan.
  private spatialAmount = 0
  /** Per keyId, for as long as the app runs: a finite set (the keys on a keyboard plus a few named voices). */
  private keyCharacters: Map<string, KeyCharacter> = new Map()
  private loaded = false
  private loadingPromise: Promise<void> | null = null

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

      masterGain.gain.value = this.volume
      dryGain.gain.value = 1 - this.reverbStrength
      wetGain.gain.value = this.reverbStrength
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
      this.applyReverbSpace()
      this.updateReverbImpulseResponse()

      const decoded = await Promise.all(KEYSTROKE_CHANNEL_IDS.map(async (id) => {
        const plain = await Promise.all(KEYSTROKE_CHANNEL_ASSETS[id].map((url) => this.loadSingleBuffer(url, context)))
        const reversed = plain.map((buffer) => this.createReversedBuffer(buffer, context))
        const channel: ChannelBuffers = {
          plain,
          flipped: plain.map((buffer) => this.createFlippedBuffer(buffer, context)),
          reversed,
          reversedFlipped: reversed.map((buffer) => this.createFlippedBuffer(buffer, context)),
        }
        return [id, channel] as const
      }))
      this.buffers = Object.fromEntries(decoded)
      this.loaded = true
      this.applyContextState()
    })()

    return this.loadingPromise
  }

  // Resumes the (already-created) AudioContext ahead of the first keystroke,
  // so the one-time hardware spin-up cost lands on an earlier user gesture
  // (window focus, first click) instead of stalling the first typing sound.
  primeAudioContext(): void {
    if (!this.enabled) return
    void this.ensureContextRunning()
  }

  /** A channel's switch, volume and jitter. Nothing is invalidated: the next press reads them. */
  setChannel(id: KeystrokeChannelId, settings: KeystrokeChannelSettings): void {
    this.channels = { ...this.channels, [id]: { ...settings } }
  }

  /** The sum of the channels, 0..1. */
  setVolume(volume: number): void {
    this.volume = Math.max(0, Math.min(1, volume))
    if (this.masterGain) this.masterGain.gain.value = this.volume
  }

  // Whether anything could be heard: checked first on every press, so a
  // keystroke with every channel off or silent costs a few comparisons.
  private isAnyChannelAudible(): boolean {
    if (this.volume <= 0) return false
    return KEYSTROKE_CHANNEL_IDS.some((id) => this.channels[id].on && this.channels[id].volume > 0)
  }

  private characterOf(keyId: string | undefined): KeyCharacter {
    const existing = keyId ? this.keyCharacters.get(keyId) : undefined
    if (existing) return existing
    const unit = () => Math.random() * 2 - 1
    const perChannel = <T,>(draw: (id: KeystrokeChannelId) => T) => Object.fromEntries(KEYSTROKE_CHANNEL_IDS.map((id) => [id, draw(id)])) as Record<KeystrokeChannelId, T>
    const character: KeyCharacter = {
      varianceUnit: unit(),
      detuneUnits: perChannel(() => unit()),
      sample: perChannel((id) => Math.floor(Math.random() * KEYSTROKE_CHANNEL_ASSETS[id].length)),
      flip: perChannel(() => Math.random() < 0.5),
    }
    if (keyId) this.keyCharacters.set(keyId, character)
    return character
  }

  async playRandomClick(options?: TypingSoundPlayOptions): Promise<void> {
    if (!this.enabled || !this.isAnyChannelAudible()) return
    if (!this.loaded || !this.audioContext) return
    await this.ensureContextRunning()
    const context = this.audioContext
    const character = this.characterOf(options?.keyId)

    // The key's place in the variance spread and the global pitch, shared
    // by every channel so a key keeps one character across its layers.
    const varianceOffset = character.varianceUnit * this.keyVariance
    const varianceScale = varianceOffset >= 0 ? 1 + varianceOffset : 1 / (1 - varianceOffset)
    const pitchScale = this.pitch >= 0 ? (100 + this.pitch) / 100 : 100 / (100 - this.pitch)
    const baseRate = (options?.playbackRate ?? 1) * varianceScale * pitchScale
    const gainScale = options?.gain ?? 1
    const reverse = options?.reverse ?? false
    const echo = options?.echo
    const pan = this.resolveEffectivePan(options?.physicalKeyCode, options?.pan)

    // One panner per voice, and only when there is somewhere to pan to.
    let output: AudioNode | null = null
    if (pan !== 0) {
      const panner = context.createStereoPanner()
      panner.pan.value = Math.max(-1, Math.min(1, pan))
      this.connectToOutput(panner)
      output = panner
    }
    const nodes: AudioNode[] = []
    let longestSec = 0

    for (const id of KEYSTROKE_CHANNEL_IDS) {
      const channel = this.channels[id]
      if (!channel.on || channel.volume <= 0) continue
      const set = this.buffers[id]
      if (!set) continue
      const count = set.plain.length
      const index = options?.assetIndex !== undefined && count > 1 ? ((options.assetIndex % count) + count) % count : character.sample[id] % count
      const flip = character.flip[id]
      const buffer = (reverse ? (flip ? set.reversedFlipped : set.reversed) : (flip ? set.flipped : set.plain))[index]
      if (!buffer) continue

      // A fresh draw per press and per channel: the layers drift against
      // each other, which is much of what makes a layered key sound alive.
      const rate = channel.jitter > 0 ? baseRate * (1 + (Math.random() * 2 - 1) * channel.jitter) : baseRate
      const detune = (options?.detune ?? 0) + Math.round(character.detuneUnits[id] * this.keyVariance * VARIANCE_DETUNE_CENTS)
      const strikes = echo ? echo.count + 1 : 1
      for (let strike = 0; strike < strikes; strike += 1) {
        const source = context.createBufferSource()
        source.buffer = buffer
        if (rate !== 1) source.playbackRate.value = rate
        if (detune !== 0) source.detune.value = detune
        const gain = context.createGain()
        gain.gain.value = channel.volume * gainScale * (strike === 0 ? 1 : Math.pow(echo!.decay, strike))
        source.connect(gain)
        if (output) gain.connect(output)
        else this.connectToOutput(gain)
        const at = strike === 0 ? 0 : context.currentTime + (echo!.delayMs * strike) / 1000
        source.start(at)
        nodes.push(source, gain)
      }
      const playedSec = buffer.duration / Math.max(0.01, rate * Math.pow(2, detune / 1200)) + (echo ? (echo.delayMs * echo.count) / 1000 : 0)
      if (playedSec > longestSec) longestSec = playedSec
    }

    if (output) nodes.push(output)
    if (nodes.length === 0) return
    // Every node of the voice goes once its longest strike has played out:
    // one timer per voice rather than an onended per source.
    window.setTimeout(() => {
      for (const node of nodes) this.safeDisconnect(node)
    }, Math.ceil(longestSec * 1000) + 50)
  }

  // Off, nothing here may cost anything: the samples are not loaded until
  // the first time it is on, and a running AudioContext renders silence on
  // the audio thread for as long as it exists, so it is suspended. On, the
  // samples load and the context is primed at once rather than on the first
  // keystroke -- Electron's autoplay policy needs no gesture, and a typed
  // first action would otherwise take the ~100-300ms hardware spin-up.
  setTypingSoundEnabled(enabled: boolean): void {
    this.enabled = enabled
    if (enabled) void this.load()
    this.applyContextState()
  }

  // Runs again when a load finishes, since the setting may have changed
  // while it was in flight and the context is created running.
  private applyContextState(): void {
    if (this.enabled) {
      void this.ensureContextRunning()
    } else if (this.audioContext && this.audioContext.state !== 'closed') {
      void this.audioContext.suspend()
    }
  }

  setTypingSoundVariance(amount: number): void {
    this.keyVariance = Math.max(0, Math.min(0.5, amount))
  }

  setTypingSoundPitch(amount: number): void {
    this.pitch = Math.max(-100, Math.min(100, amount))
  }

  // Takes the -100..100 UI range; stored as -1..1 to multiply directly
  // against pan values. The sign selects the mode (negative = mode A,
  // positive = mode B) but the output uses its magnitude so the same
  // intensity is heard for +50 and -50 in the explicit-pan paths (such as
  // the escape menu's ring-burst sounds).
  setSpatialAmount(amount: number): void {
    this.spatialAmount = Math.max(-100, Math.min(100, amount)) / 100
  }

  // Lets callers (e.g. useEditorSectionMount) cheaply check whether mode B
  // is active before doing any work to compute a caret-position pan value
  // for TypingSoundPlayOptions.pan -- avoids that cost entirely when the
  // slider is neutral or in mode A.
  getSpatialAmount(): number {
    return this.spatialAmount
  }

  setReverbStrength(amount: number): void {
    const next = Math.max(0, Math.min(1, amount))
    if (this.reverbStrength === next) return
    this.reverbStrength = next
    if (this.reverbDryGain && this.reverbWetGain) {
      this.reverbDryGain.gain.value = 1 - this.reverbStrength
      this.reverbWetGain.gain.value = this.reverbStrength
    }
    this.updateReverbImpulseResponse()
  }

  setReverbSpace(amount: number): void {
    const next = Math.max(0, Math.min(1, amount))
    if (this.reverbSpace === next) return
    this.reverbSpace = next
    this.applyReverbSpace()
    this.updateReverbImpulseResponse()
  }

  private applyReverbSpace(): void {
    if (!this.reverbFilter) return
    const minFreq = 2000
    const maxFreq = 12000
    this.reverbFilter.frequency.value = minFreq + (maxFreq - minFreq) * (1 - this.reverbSpace)
    this.reverbFilter.Q.value = 0.7 + this.reverbSpace * 0.8
  }

  // The one place a voice reaches the speakers: the dry path and the reverb
  // send.
  private connectToOutput(node: AudioNode): void {
    if (this.reverbDryGain && this.reverbNode) {
      node.connect(this.reverbDryGain)
      node.connect(this.reverbNode)
    } else if (this.masterGain) {
      node.connect(this.masterGain)
    }
  }

  // An explicit pan from the caller (a caret position in mode B, or a sound
  // with a position of its own, such as the escape ring's cells) wins in
  // either mode, scaled by the slider's distance from centre. Without one,
  // mode A pans by the key's place on the keyboard and mode B does not pan.
  // Returns 0 (no panner node at all) whenever the slider is neutral or
  // nothing gives a position.
  private resolveEffectivePan(physicalKeyCode: string | undefined, explicitPan: number | undefined): number {
    const magnitude = Math.abs(this.spatialAmount)
    if (magnitude === 0) return 0
    if (explicitPan !== undefined) {
      return Math.max(-1, Math.min(1, explicitPan)) * magnitude
    }
    if (this.spatialAmount < 0) {
      const keyboardPan = resolveKeyboardPanForCode(physicalKeyCode)
      return keyboardPan === 0 ? 0 : keyboardPan * magnitude
    }
    return 0
  }

  private safeDisconnect(node: AudioNode): void {
    try {
      node.disconnect()
    } catch {
      // best effort cleanup
    }
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
    // Switched off while the resume was in flight (a quick on-off, or a
    // sound already past its own enabled check): put it back to sleep.
    if (!this.enabled) this.applyContextState()
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
