import { describe, expect, it, vi } from 'vitest'
import { createNativeMusicListening } from './nativeMusicListening'
import { setSpectrumIncludesSoundscape } from '@thockdown/visualizer/visualizer/spectrumMix'
import { soundscapeSignalsActive, takeSoundscapeHits } from '@thockdown/visualizer/sound/soundscapeSignals'
import { NativeSoundscapeVisuals, setSoundscapeVisualsHeardGain, type SoundscapeVisualsSession } from './nativeSoundscapeVisuals'
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

/** A soundscape session answering `setVisuals`; whether it is heard is the page's (`setSoundscapeVisualsHeardGain`). */
function fakeSession() {
  const { plugin, emit } = fakePlugin()
  const session = {
    ...(plugin as object),
    setVisuals: vi.fn(() => Promise.resolve()),
  } as unknown as SoundscapeVisualsSession & { setVisuals: ReturnType<typeof vi.fn> }
  return { plugin: session, emit }
}

const batch = (from: number, first: number, values: number[]) => ({ from, first, hop: 100, l: toBase64(Uint8Array.from(values)) })

describe('native music listening', () => {
  it('draws the frame at the playhead, a later batch replacing the frames from its start', () => {
    vi.spyOn(performance, 'now').mockReturnValue(0)
    vi.stubGlobal('document', { hidden: false, addEventListener: () => {}, removeEventListener: () => {} })
    vi.stubGlobal('location', { origin: 'https://localhost' })
    const { plugin, emit } = fakePlugin()
    const listening = createNativeMusicListening(plugin, () => ({ filePath: 'content://x/tree/a/document/b', durationSec: 100 }), () => 1)
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
    const session = fakeSession()
    setSoundscapeVisualsHeardGain(0.25)
    const visuals = new NativeSoundscapeVisuals(session.plugin)
    await Promise.resolve()
    let musicGain = 0.5
    const listening = createNativeMusicListening(music.plugin, () => null, () => musicGain, visuals)
    const spectrum = listening.createSpectrum(new Float64Array(2))
    setSpectrumIncludesSoundscape(true)
    spectrum.start()
    expect(session.plugin.setVisuals).toHaveBeenLastCalledWith({ bands: 1, signals: true })
    music.emit('heard', { songId: 1, seconds: 0, frame: 1000, sampleRate: 1000, playing: true })
    music.emit('spectrum', { batches: JSON.stringify([batch(1000, 1000, [40])]) }) // -20 dB
    session.emit('visuals', { visuals: JSON.stringify({ spectrum: [batch(500, 500, [40])], signals: [] }), playhead: 500, sampleRate: 1000 }) // -20 dB
    const out = new Float32Array(1)
    spectrum.sample(0, out)
    // Music at 1, soundscape at half its amplitude: powers 1 + 1/4 of -20 dB.
    expect(out[0]).toBeCloseTo(-20 + 10 * Math.log10(1.25), 4)
    expect(spectrum.hearing).toBe(true)
    // Music not heard: the soundscape alone, at full scale.
    musicGain = 0
    spectrum.sample(0, out)
    expect(out[0]).toBeCloseTo(-20, 4)
    // Switched off: the music alone, and the soundscape's renderer is told to stop its spectrum (its signals go on).
    musicGain = 0.5
    setSpectrumIncludesSoundscape(false)
    spectrum.sample(0, out)
    expect(out[0]).toBeCloseTo(-20, 4)
    expect(session.plugin.setVisuals).toHaveBeenLastCalledWith({ bands: 0, signals: true })
    setSpectrumIncludesSoundscape(true)
  })
})

describe('native soundscape visuals', () => {
  it('times each signal by the playhead it was sent with, and drops those still ahead once the session is not heard', async () => {
    let now = 10
    vi.spyOn(performance, 'now').mockImplementation(() => now * 1000)
    vi.stubGlobal('document', { hidden: false, addEventListener: () => {}, removeEventListener: () => {} })
    const session = fakeSession()
    // Heard because the page says so: the session never reports a play the page made itself.
    setSoundscapeVisualsHeardGain(0.25)
    new NativeSoundscapeVisuals(session.plugin)
    await Promise.resolve()
    const hit = (frame: number) => ({ frame, kind: 'drip', amplitude: 0.1, salience: 3 })
    // Playhead at 1000 of a 1000 Hz output: frame 1500 is heard half a second on, 3000 two seconds on.
    session.emit('visuals', { visuals: JSON.stringify({ spectrum: [], signals: [{ from: 1000, list: [hit(1500), hit(3000)] }] }), playhead: 1000, sampleRate: 1000 })
    expect(soundscapeSignalsActive(now)).toBe(true)
    now = 10.6
    expect(takeSoundscapeHits(now).map((taken) => taken.at)).toEqual([10.5])
    setSoundscapeVisualsHeardGain(0)
    now = 12.5
    expect(takeSoundscapeHits(now)).toEqual([])
    // Not heard: what arrives is not taken.
    session.emit('visuals', { visuals: JSON.stringify({ spectrum: [], signals: [{ from: 3000, list: [hit(3100)] }] }), playhead: 3000, sampleRate: 1000 })
    now = 13
    expect(takeSoundscapeHits(now)).toEqual([])
  })
})
