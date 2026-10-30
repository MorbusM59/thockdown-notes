import { describe, expect, it } from 'vitest'
import { ALL_CHANNELS, applyStagedColor, copyIntoStaging, isAllChannels, selectChannel } from './colorStaging'

const NONE = { h: false, s: false, v: false, a: false }

describe('selectChannel', () => {
  it('a plain press selects that channel alone', () => {
    expect(selectChannel(ALL_CHANNELS, 's', false)).toEqual({ ...NONE, s: true })
  })

  it('an additive press toggles one channel and keeps the others', () => {
    expect(selectChannel({ ...NONE, h: true }, 'a', true)).toEqual({ ...NONE, h: true, a: true })
    expect(selectChannel({ ...NONE, h: true, a: true }, 'h', true)).toEqual({ ...NONE, a: true })
  })

  it('never leaves an empty mask: removing the last channel returns to all', () => {
    expect(selectChannel({ ...NONE, v: true }, 'v', true)).toBe(ALL_CHANNELS)
  })

  it('all four selected one by one is the same as the colour button', () => {
    let mask = { ...NONE, h: true }
    for (const channel of ['s', 'v', 'a'] as const) mask = selectChannel(mask, channel, true)
    expect(isAllChannels(mask)).toBe(true)
  })
})

describe('copyIntoStaging', () => {
  const staged = { h: 200, s: 0.5, v: 0.5, a: 0.5 }

  it('copies only the masked channels', () => {
    expect(copyIntoStaging(staged, { h: 10, s: 1, v: 1, a: 1 }, { ...NONE, s: true })).toEqual({ ...staged, s: 1 })
  })

  it('never takes a hue from a grey or black, nor a saturation from black', () => {
    expect(copyIntoStaging(staged, { h: 0, s: 0, v: 0.7, a: 1 }, ALL_CHANNELS)).toEqual({ h: 200, s: 0, v: 0.7, a: 1 })
    expect(copyIntoStaging(staged, { h: 0, s: 0, v: 0, a: 1 }, ALL_CHANNELS)).toEqual({ h: 200, s: 0.5, v: 0, a: 1 })
  })
})

describe('applyStagedColor', () => {
  it('writes only the masked channels into the target', () => {
    expect(applyStagedColor({ h: 30, s: 0.2, v: 0.9, a: 1 }, { h: 200, s: 0.8, v: 0.1, a: 0.3 }, { ...NONE, a: true }))
      .toEqual({ h: 30, s: 0.2, v: 0.9, a: 0.3 })
  })

  it('a grey target borrows the staged hue, so saturation alone tints it with that hue rather than red', () => {
    expect(applyStagedColor({ h: 0, s: 0, v: 0.6, a: 1 }, { h: 200, s: 0.8, v: 0.1, a: 1 }, { ...NONE, s: true }))
      .toEqual({ h: 200, s: 0.8, v: 0.6, a: 1 })
  })
})
