import { describe, expect, it } from 'vitest'
import { BEAT_DELAY_MAX_MS, BEAT_DELAY_OFFSET_MS, effectiveBeatDelayMs, sanitizeBeatSettings } from './beatSettings'

describe('sanitizeBeatSettings: per-device delay', () => {
  it('keeps each device its own delay, rounded and bounded, and drops what is not a number', () => {
    const { delayMsByDevice } = sanitizeBeatSettings({ delayMsByDevice: { Speakers: 12.4, Headset: 9999, LegacyNegative: -200, Broken: 'x', Off: Number.NaN } })
    expect(delayMsByDevice).toEqual({ Speakers: 12, Headset: BEAT_DELAY_MAX_MS, LegacyNegative: 0 })
  })

  it('starts every device at no delay', () => {
    expect(sanitizeBeatSettings(undefined).delayMsByDevice).toEqual({})
    expect(sanitizeBeatSettings({ enabled: true }).delayMsByDevice).toEqual({})
  })

  it('adds the internal offset to the per-device adjustment', () => {
    expect(effectiveBeatDelayMs(undefined)).toBe(BEAT_DELAY_OFFSET_MS)
    expect(effectiveBeatDelayMs(0)).toBe(BEAT_DELAY_OFFSET_MS)
    expect(effectiveBeatDelayMs(125)).toBe(BEAT_DELAY_OFFSET_MS + 125)
  })
})
