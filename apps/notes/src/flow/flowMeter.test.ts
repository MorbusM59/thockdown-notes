import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_FLOW_SETTINGS } from '../shared/flowSettings'

/**
 * The live meter, driven by a fake clock and frame loop: the property is that
 * steady typing through the real plumbing raises what listeners see, and
 * stopping brings it back down.
 */
describe('flow meter', () => {
  let now = 0
  let frames: Array<() => void> = []

  beforeEach(() => {
    vi.resetModules()
    now = 0
    frames = []
    vi.stubGlobal('performance', { now: () => now })
    vi.stubGlobal('requestAnimationFrame', (cb: () => void) => { frames.push(cb); return frames.length })
    vi.stubGlobal('cancelAnimationFrame', () => { frames = [] })
  })
  afterEach(() => vi.unstubAllGlobals())

  /** Advances the clock by `ms` in 16ms frames, running the loop as it goes. */
  function advance(ms: number): void {
    for (let t = 0; t < ms; t += 16) {
      now += 16
      const due = frames
      frames = []
      for (const cb of due) cb()
    }
  }

  const key = (k: string) => ({ key: k, ctrlKey: false, metaKey: false, altKey: false, repeat: false }) as KeyboardEvent

  it('rises under steady typing and falls once it stops', async () => {
    const { flowMeter } = await import('./flowMeter')
    flowMeter.configure({ ...DEFAULT_FLOW_SETTINGS, enabled: true })
    let level = 0
    flowMeter.subscribe((l) => { level = l })

    for (let i = 0; i < 300; i += 1) {
      flowMeter.reportKey(key('a'))
      advance(160) // 75 wpm, well above the default pace
    }
    expect(level).toBeGreaterThan(0.4)

    flowMeter.reportKey(key('Backspace'))
    advance(DEFAULT_FLOW_SETTINGS.fadeSec * 1000 + 1000)
    expect(level).toBe(0)
  })

  it('stays at zero while switched off', async () => {
    const { flowMeter } = await import('./flowMeter')
    let level = 0
    flowMeter.subscribe((l) => { level = l })
    for (let i = 0; i < 100; i += 1) {
      flowMeter.reportKey(key('a'))
      advance(160)
    }
    expect(level).toBe(0)
  })
})
