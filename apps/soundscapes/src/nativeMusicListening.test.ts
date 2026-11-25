import { describe, expect, it, vi } from 'vitest'
import { createNativeMusicListening, type SpectrumMixPort } from './nativeMusicListening'
import { setSpectrumIncludesSoundscape } from '@thockdown/visualizer/visualizer/spectrumMix'
import type { NativeMusicPlugin } from './nativeMusic'
import { toBase64 } from '@thockdown/soundscape/halfScalePcm'

type Listener = (data: never) => void

function fakePlugin() {
  const listeners = new Map<string, Listener>()
  const plugin = {
    addListener: (event: string, listener: Listener) => {
      listeners.set(event, listener)
      return Promise.resolve({ remove: () => Promise.resolve() })
    },
    setSpectrum: vi.fn(() => Promise.resolve()),
    seek: vi.fn(() => Promise.resolve()),
  } as unknown as NativeMusicPlugin
  const emit = (event: string, data: unknown) => (listeners.get(event) as (data: unknown) => void)(data)
  return { plugin, emit }
}

const batch = (from: number, first: number, values: number[]) => ({ from, first, hop: 100, l: toBase64(Uint8Array.from(values)) })

describe('native music listening', () => {
  it('draws the frame at the playhead, a later batch replacing the frames from its start', () => {
    vi.spyOn(performance, 'now').mockReturnValue(0)
    vi.stubGlobal('document', { hidden: false, addEventListener: () => {}, removeEventListener: () => {} })
    vi.stubGlobal('location', { origin: 'https://localhost' })
    const { plugin, emit } = fakePlugin()
    const listening = createNativeMusicListening(plugin, () => ({ filePath: 'content://x/tree/a/document/b', durationSec: 100 }))
    const spectrum = listening.createSpectrum(new Float64Array(2))
    spectrum.start()
    emit('heard', { songId: 1, seconds: 3, frame: 1000, sampleRate: 1000, playing: true })
    // One band: frames at 900, 1000, 1100, 1200 at 0, -1, -2, -3 dB (two steps a dB).
    emit('spectrum', { batches: JSON.stringify([batch(900, 900, [0, 2, 4, 6])]) })
    const out = new Float32Array(1)
    spectrum.sample(0.15, out) // playhead 1150
    expect(out[0]).toBe(-2)
    // A splice from 1100: the frames from there are replaced.
    emit('spectrum', { batches: JSON.stringify([batch(1100, 1100, [20, 22])]) })
    spectrum.sample(0.2, out)
    expect(out[0]).toBe(-11)
    expect(listening.currentTime).toBe(3)
    expect(listening.trackUrl).toContain(encodeURIComponent('content://x/tree/a/document/b'))
  })
  it('adds the soundscape at the ratio heard, the louder one at full scale, and drops it when switched off or not heard', async () => {
    vi.spyOn(performance, 'now').mockReturnValue(0)
    vi.stubGlobal('document', { hidden: false, addEventListener: () => {}, removeEventListener: () => {} })
    const music = fakePlugin()
    const soundscape = fakePlugin()
    const getState = vi.fn(() => Promise.resolve({ source: 'regular', regular: 'playing' }))
    const session = { ...(soundscape.plugin as object), getState } as unknown as SpectrumMixPort['soundscape']
    let musicGain = 0.5
    const listening = createNativeMusicListening(music.plugin, () => null, { soundscape: session, musicGain: () => musicGain, soundscapeGain: () => 0.25 })
    const spectrum = listening.createSpectrum(new Float64Array(2))
    setSpectrumIncludesSoundscape(true)
    spectrum.start()
    await Promise.resolve()
    expect(soundscape.plugin.setSpectrum).toHaveBeenCalledWith({ bands: 1 })
    music.emit('heard', { songId: 1, seconds: 0, frame: 1000, sampleRate: 1000, playing: true })
    music.emit('spectrum', { batches: JSON.stringify([batch(1000, 1000, [40])]) }) // -20 dB
    soundscape.emit('spectrum', { batches: JSON.stringify([batch(500, 500, [40])]), playhead: 500 }) // -20 dB
    const out = new Float32Array(1)
    spectrum.sample(0, out)
    // Music at 1, soundscape at half its amplitude: powers 1 + 1/4 of -20 dB.
    expect(out[0]).toBeCloseTo(-20 + 10 * Math.log10(1.25), 4)
    expect(spectrum.hearing).toBe(true)
    // Music not heard: the soundscape alone, at full scale.
    musicGain = 0
    spectrum.sample(0, out)
    expect(out[0]).toBeCloseTo(-20, 4)
    // Switched off: the music alone, and the soundscape's renderer is told to stop.
    musicGain = 0.5
    setSpectrumIncludesSoundscape(false)
    spectrum.sample(0, out)
    expect(out[0]).toBeCloseTo(-20, 4)
    expect(soundscape.plugin.setSpectrum).toHaveBeenLastCalledWith({ bands: 0 })
    setSpectrumIncludesSoundscape(true)
  })
})
