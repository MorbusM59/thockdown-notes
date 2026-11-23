import { describe, expect, it, vi } from 'vitest'
import { createNativeMusicListening } from './nativeMusicListening'
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
})
