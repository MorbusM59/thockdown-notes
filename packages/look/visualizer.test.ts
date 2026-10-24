import { describe, expect, it } from 'vitest'
import { BEAT_FREQUENCY, defaultVisualizer, sanitizeVisualizer } from './visualizer'

describe('sanitizeVisualizer', () => {
  it('fills a layout saved before the visualizer with the defaults for its inversion', () => {
    expect(sanitizeVisualizer(undefined, false)).toEqual(defaultVisualizer(false))
    expect(sanitizeVisualizer(undefined, true)).toEqual(defaultVisualizer(true))
    expect(defaultVisualizer(true).shade.color).not.toBe(defaultVisualizer(false).shade.color)
  })

  it('keeps each block its own band, colour and invert, bounded', () => {
    const v = sanitizeVisualizer({
      shade: { frequencyHz: BEAT_FREQUENCY, invert: true, color: 'rgba(1, 2, 3, 0.5)', amount: 7 },
      outline: { frequencyHz: 99999, color: '' },
    }, false)
    expect(v.shade).toMatchObject({ frequencyHz: BEAT_FREQUENCY, invert: true, color: 'rgba(1, 2, 3, 0.5)', amount: 1 })
    expect(v.outline.frequencyHz).toBe(20000)
    expect(v.outline.color).toBe(defaultVisualizer(false).outline.color)
    expect(v.caret.invert).toBe(false)
  })
})
