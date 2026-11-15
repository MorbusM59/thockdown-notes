import { describe, expect, it } from 'vitest'
import { decodeTooltip, encodeTooltip, tooltipLines, type TooltipElementVisibility } from './tooltipContent'

const ALL: TooltipElementVisibility = { intention: true, shortcut: true, gestures: true, value: true }
const keys = (id: string) => (id === 'speedReading' ? 'F9' : null)

describe('tooltip content', () => {
  it('keeps an intention-only tooltip a plain string, and reads a plain string as an intention', () => {
    expect(encodeTooltip({ intention: 'Bold' })).toBe('Bold')
    expect(decodeTooltip('Bold')).toEqual({ intention: 'Bold' })
  })

  it('round-trips structured content', () => {
    const content = { intention: 'Music', value: 'Song', gestures: [{ press: 'right' as const, intention: 'Skip forward' }] }
    expect(decodeTooltip(encodeTooltip(content))).toEqual(content)
  })

  it('renders every element, gestures in words', () => {
    const content = { intention: 'Speed reading', shortcut: 'speedReading', value: '300', gestures: [{ press: 'holdRight' as const, intention: 'Next song' }] }
    expect(tooltipLines(content, ALL, keys)).toEqual(['Speed reading: 300  [F9]', '[Hold right] Next song'])
  })

  it('shows nothing when no enabled element has anything to say', () => {
    expect(tooltipLines({ intention: 'Bold' }, { ...ALL, intention: false }, keys)).toEqual([])
    expect(tooltipLines({ intention: 'Delay', value: '0.6' }, { ...ALL, intention: false }, keys)).toEqual(['0.6'])
    expect(tooltipLines({ gestures: [{ press: 'right', intention: 'Reset' }] }, { ...ALL, intention: false }, keys)).toEqual(['[Right] Reset'])
  })

  it('reads malformed structured content as nothing', () => {
    expect(decodeTooltip('\u0002{oops')).toEqual({})
  })
})
