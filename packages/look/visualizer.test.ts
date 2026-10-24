import { describe, expect, it } from 'vitest'
import { defaultVisualizer, fallOf, sanitizeVisualizer, SOURCE_SLIDER_MAX, SOURCE_SLIDER_MIN, sourceAtSlider, sourceSliderValue } from './visualizer'

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
    const v = sanitizeVisualizer({ caret: { effect: 0.3, mass: 0.7, source: 'snare', frequencyHz: 300, contrast: 0.2 } }, false)
    expect(v.caret).toEqual({ effect: 0.3, mass: 0.7 })
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

it('reads a saved fall time as the mass that falls as long', () => {
  const v = sanitizeVisualizer({ caret: { fallSec: 0.25, fallShape: 3 }, shade: { fallSec: 99 } }, false)
  expect(v.caret.mass).toBeCloseTo(0.5, 2)
  expect(v.shade.mass).toBe(1)
  expect(fallOf(0.5).fallSec).toBeCloseTo(0.25, 1)
  expect(fallOf(0.5).fallShape).toBe(0)
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
