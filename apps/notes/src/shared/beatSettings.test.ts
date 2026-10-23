import { describe, expect, it } from 'vitest'
import { BEAT_DELAY_MAX_MS, sanitizeBeatSettings } from './beatSettings'

describe('sanitizeBeatSettings: per-device delay', () => {
  it('keeps each device its own delay, rounded and bounded, and drops what is not a number', () => {
    const { delayMsByDevice } = sanitizeBeatSettings({ delayMsByDevice: { Speakers: 12.4, Headset: 9999, Broken: 'x', Off: Number.NaN } })
    expect(delayMsByDevice).toEqual({ Speakers: 12, Headset: BEAT_DELAY_MAX_MS })
  })

  it('starts every device at no delay', () => {
    expect(sanitizeBeatSettings(undefined).delayMsByDevice).toEqual({})
    expect(sanitizeBeatSettings({ enabled: true }).delayMsByDevice).toEqual({})
  })
})
