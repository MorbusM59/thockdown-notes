import { describe, expect, it } from 'vitest'
import { defaultVisualizer, FALL_MAX_SEC, FALL_MIN_SEC, pulseCurve, sanitizeVisualizer, SOURCE_SLIDER_MAX, SOURCE_SLIDER_MIN, sourceAtSlider, sourceSliderValue } from './visualizer'

describe('sanitizeVisualizer', () => {
  it('fills a layout saved before the visualizer with the defaults for its inversion', () => {
    expect(sanitizeVisualizer(undefined, false)).toEqual(defaultVisualizer(false))
    expect(sanitizeVisualizer(undefined, true)).toEqual(defaultVisualizer(true))
    expect(defaultVisualizer(true).shade.color).not.toBe(defaultVisualizer(false).shade.color)
  })

  it('keeps each block its own band, colour and effect, bounded', () => {
    const v = sanitizeVisualizer({
      shade: { source: 'snare', frequencyHz: 300, color: 'rgba(1, 2, 3, 0.5)', effect: -7 },
      outline: { source: 'cowbell', frequencyHz: 99999, color: '' },
    }, false)
    expect(v.shade).toMatchObject({ source: 'snare', frequencyHz: 300, color: 'rgba(1, 2, 3, 0.5)', effect: -1 })
    expect(v.outline.frequencyHz).toBe(20000)
    expect(v.outline.source).toBe('band')
    expect(v.outline.color).toBe(defaultVisualizer(false).outline.color)
    expect(v.caret.effect).toBe(0.6)
  })

  it('keeps only what the caret reads, so an older save with a source loads without it', () => {
    const v = sanitizeVisualizer({ caret: { effect: 0.3, shape: 0.2, fallSec: 0.5, source: 'snare', frequencyHz: 300, contrast: 0.2 } }, false)
    expect(v.caret).toEqual({ followsMusic: true, effect: 0.3, shape: 0.2, fallSec: 0.5 })
  })

  it('migrates a layout from before the caret switch: it followed the music whenever its caret had an effect', () => {
    expect(sanitizeVisualizer({ caret: { effect: 0.4 } }, false).caret.followsMusic).toBe(true)
    expect(sanitizeVisualizer({ caret: { effect: 0 } }, false).caret.followsMusic).toBe(false)
    expect(sanitizeVisualizer(undefined, false).caret.followsMusic).toBe(false)
    // The old bounce blink is now the switch's button.
    expect(sanitizeVisualizer(undefined, false, 'bounce').caret.followsMusic).toBe(true)
    expect(sanitizeVisualizer({ caret: { effect: 0 } }, false, 'bounce').caret.followsMusic).toBe(true)
    // A saved switch wins over both.
    expect(sanitizeVisualizer({ caret: { effect: 0.4, followsMusic: false } }, false, 'bounce').caret.followsMusic).toBe(false)
  })
})

it('reads a layout saved before the source existed', () => {
  const v = sanitizeVisualizer({ outline: { frequencyHz: 0 }, shade: { frequencyHz: 440 } }, false)
  expect(v.outline.source).toBe('kick')
  expect(v.shade).toMatchObject({ source: 'band', frequencyHz: 440 })
})

it('turns a saved amount and invert into a signed effect', () => {
  const v = sanitizeVisualizer({ caret: { amount: 0.4, invert: true }, shade: { amount: 0.3 } }, false)
  expect(v.caret.effect).toBe(-0.4)
  expect(v.shade.effect).toBe(0.3)
  expect(v.caret).not.toHaveProperty('invert')
})

it('reads the fall of a layout saved with one mass slider, or with the first fall shape', () => {
  const v = sanitizeVisualizer({ caret: { mass: 0 }, shade: { mass: 1 }, outline: { fallSec: 99, fallShape: 3 } }, false)
  expect(v.caret).toMatchObject({ shape: 1, fallSec: FALL_MIN_SEC })
  expect(v.shade.shape).toBe(-1)
  expect(v.shade.fallSec).toBeCloseTo(1.6, 6)
  expect(v.outline).toMatchObject({ shape: 1, fallSec: FALL_MAX_SEC })
})

describe('pulseCurve', () => {
  const shapes = Array.from({ length: 41 }, (_, i) => -1 + i / 20)
  const FRAME_SEC = 1 / 60

  it('falls from exactly 1 to exactly 0, never rising, at every shape', () => {
    for (const shape of shapes) {
      expect(pulseCurve(0, shape)).toBe(1)
      expect(pulseCurve(1, shape)).toBe(0)
      let last = 1
      for (let i = 1; i <= 1000; i++) {
        const value = pulseCurve(i / 1000, shape)
        expect(value).toBeLessThanOrEqual(last)
        last = value
      }
    }
  })

  // The property the fall is for: drawn at 60 frames a second, every frame of
  // its length shows a value of its own, and none of them is a jump to
  // nothing -- at the shortest fall the step is bounded, the landing is soft,
  // and every step shrinks in proportion as the fall gets longer.
  it('is drawn as a run of distinct values on every frame, with a soft landing', () => {
    for (const fallSec of [FALL_MIN_SEC, 0.25, 1, FALL_MAX_SEC]) {
      const frames = Math.floor(fallSec / FRAME_SEC)
      const scale = FALL_MIN_SEC / fallSec
      for (const shape of shapes) {
        let last = 1
        let biggest = 0
        for (let f = 1; f <= frames; f++) {
          const value = pulseCurve((f * FRAME_SEC) / fallSec, shape)
          expect(value).toBeLessThan(last)
          biggest = Math.max(biggest, last - value)
          last = value
        }
        // The step to nothing after the last frame drawn.
        expect(last).toBeLessThan(0.3 * scale + 1e-9)
        expect(biggest).toBeLessThan(Math.min(0.55, 0.55 * scale * 1.6 + 0.02))
      }
    }
  })

  it('puts a ride cymbal low early and a thump high late', () => {
    expect(pulseCurve(0.25, 1)).toBeLessThan(0.35)
    expect(pulseCurve(0.75, 1)).toBeGreaterThan(0)
    expect(pulseCurve(0.6, -1)).toBeGreaterThan(0.7)
  })
})

it('gives a save without the shade geometry its defaults, and bounds and rounds what it has', () => {
  expect(sanitizeVisualizer({ shade: {} }, false).shade).toMatchObject({ spreadPx: 0, blurPx: 32 })
  expect(sanitizeVisualizer({ shade: { spreadPx: 14.7, blurPx: 900 } }, false).shade).toMatchObject({ spreadPx: 15, blurPx: 200 })
  expect(sanitizeVisualizer({ shade: { spreadPx: -5, blurPx: 'x' } }, false).shade).toMatchObject({ spreadPx: 0, blurPx: 32 })
})

describe('the source slider', () => {
  it('puts the kick at the left end, the snare at the centre and the hat at the right end', () => {
    const at = (source: 'kick' | 'snare' | 'hat') => sourceSliderValue({ source, frequencyHz: 100 })
    expect(at('kick')).toBeGreaterThan(SOURCE_SLIDER_MIN)
    expect(at('hat')).toBeLessThan(SOURCE_SLIDER_MAX)
    expect(at('kick') - SOURCE_SLIDER_MIN).toBeCloseTo(SOURCE_SLIDER_MAX - at('hat'))
    expect(at('snare')).toBeCloseTo((SOURCE_SLIDER_MIN + SOURCE_SLIDER_MAX) / 2)
    expect(sourceAtSlider(SOURCE_SLIDER_MIN, 100).source).toBe('kick')
    expect(sourceAtSlider((SOURCE_SLIDER_MIN + SOURCE_SLIDER_MAX) / 2, 100).source).toBe('snare')
    expect(sourceAtSlider(SOURCE_SLIDER_MAX, 100).source).toBe('hat')
  })

  it('returns every source and band frequency to the position it came from', () => {
    for (const source of ['kick', 'snare', 'hat'] as const) {
      expect(sourceAtSlider(sourceSliderValue({ source, frequencyHz: 440 }), 440)).toEqual({ source, frequencyHz: 440 })
    }
    for (const frequencyHz of [20, 70, 440, 630, 640, 2000, 20000]) {
      expect(sourceAtSlider(sourceSliderValue({ source: 'band', frequencyHz }), 1)).toEqual({ source: 'band', frequencyHz })
    }
  })

  it('runs the spectrum upwards from left to right, through the snare', () => {
    let last = 0
    for (let v = SOURCE_SLIDER_MIN; v <= SOURCE_SLIDER_MAX; v += 0.01) {
      const at = sourceAtSlider(v, 1)
      if (at.source !== 'band') continue
      expect(at.frequencyHz).toBeGreaterThanOrEqual(last)
      last = at.frequencyHz
    }
    expect(last).toBeGreaterThan(19000)
  })
})
