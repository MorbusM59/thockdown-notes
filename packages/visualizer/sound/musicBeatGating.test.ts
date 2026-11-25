import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MusicListening } from './musicListening'

/**
 * WHAT KEEPS THE ANALYSIS RUNNING: a mix, a clock or the semitone row needs
 * the music decoded and analysed in a worker; a tempo reader alone (the
 * phone's glaze, drifting on every tab) does not, and runs on the 60 BPM
 * fallback rather than keeping the whole music analysed for it.
 */
describe('musicBeat: the analysis runs only for readers that need it', () => {
  const workers: Array<{ terminated: boolean }> = []
  let frames: Array<(time: number) => void> = []

  beforeEach(async () => {
    vi.resetModules()
    workers.length = 0
    frames = []
    vi.stubGlobal('Worker', class {
      terminated = false
      onmessage = null
      onerror = null
      constructor() { workers.push(this) }
      postMessage() {}
      terminate() { this.terminated = true }
    })
    vi.stubGlobal('requestAnimationFrame', (callback: (time: number) => void) => frames.push(callback))
    vi.stubGlobal('cancelAnimationFrame', () => {})
    vi.stubGlobal('document', { hidden: false, addEventListener() {}, removeEventListener() {} })
    const playing: MusicListening = {
      isPlaying: true,
      subscribePlaying: () => () => {},
      trackUrl: 'song',
      currentTime: 0,
      currentDurationSec: 100,
      setCurrentTimeFraction: () => {},
      outputLatencySec: () => 0,
      createSpectrum: () => ({ start: () => {}, stop: () => {}, hearing: false, sample: () => {} }),
    }
    // The same module instance musicBeat will import, after the reset.
    ;(await import('./musicListening')).setMusicListening(playing)
  })
  afterEach(() => vi.unstubAllGlobals())

  /** Runs the frames queued so far, `count` times over, at 60 per second. */
  const runFrames = (count: number) => {
    for (let index = 0; index < count; index += 1) {
      const queued = frames
      frames = []
      for (const callback of queued) callback(index * 16.7)
    }
  }

  it('drives a tempo reader alone at the fallback, with no worker, while music plays', async () => {
    const beat = await import('./musicBeat')
    const beats: number[] = []
    const unsubscribe = beat.subscribeMusicTempo((_passed, rate) => beats.push(rate))
    runFrames(5)
    expect(workers).toHaveLength(0)
    expect(beats.length).toBeGreaterThan(0)
    expect(beats.at(-1)).toBeCloseTo(1, 5)
    unsubscribe()
  })

  it('starts the worker for a mix and ends it when only the tempo reader is left, which carries on', async () => {
    const beat = await import('./musicBeat')
    const beats: number[] = []
    const unsubscribeTempo = beat.subscribeMusicTempo((_passed, rate) => beats.push(rate))
    const mix = beat.subscribeMusicMix({ mix: { thump: 1, pierce: 0, tick: 0 }, shape: 0, fallSec: 0.2 }, () => {})
    expect(workers).toHaveLength(1)
    runFrames(3)
    mix.unsubscribe()
    expect(workers[0].terminated).toBe(true)
    const before = beats.length
    runFrames(3)
    expect(beats.length).toBeGreaterThan(before)
    unsubscribeTempo()
  })
})
