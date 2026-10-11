import { describe, expect, it } from 'vitest'
import { formatImageInset, formatImageLayout, imageLayoutStyles, parseImageTitle } from './imageLayout'

describe('the image title grammar', () => {
  it('reads every token kind, in any order', () => {
    expect(parseImageTitle('right 12em &LOGO')).toEqual({
      kind: 'layout',
      layout: { id: 'LOGO', width: { value: 12, unit: 'em' }, height: null, align: 'right', inset: null },
    })
    expect(parseImageTitle('x200px')).toMatchObject({ kind: 'layout', layout: { width: null, height: { value: 200, unit: 'px' } } })
    expect(parseImageTitle('50%x8em center')).toMatchObject({ kind: 'layout', layout: { width: { value: 50, unit: '%' }, height: { value: 8, unit: 'em' }, align: 'center' } })
  })

  it('keeps an ordinary title as a tooltip, unit-less numbers included', () => {
    expect(parseImageTitle('Sunset over the hills')).toEqual({ kind: 'tooltip', text: 'Sunset over the hills' })
    expect(parseImageTitle('2024').kind).toBe('malformed')
    expect(parseImageTitle('Left of the river').kind).toBe('tooltip')
  })

  it('calls a title made only of layout-shaped tokens with a typo malformed', () => {
    expect(parseImageTitle('12emm right').kind).toBe('malformed')
    expect(parseImageTitle('12em 20em').kind).toBe('malformed')
    expect(parseImageTitle('x50%').kind).toBe('malformed')
    expect(parseImageTitle('&AMP;').kind).toBe('malformed')
  })

  it('formats what it parses back to the same layout', () => {
    for (const title of ['&LOGO 12em right', 'x8em', '50%x200px center', 'left', '']) {
      const parsed = parseImageTitle(title)
      if (parsed.kind !== 'layout') throw new Error(title)
      expect(formatImageLayout(parsed.layout)).toBe(title)
    }
  })

  it('never stretches an image given both dimensions', () => {
    const parsed = parseImageTitle('20emx10em')
    if (parsed.kind !== 'layout') throw new Error('not layout')
    expect(imageLayoutStyles(parsed.layout)).toEqual({ frame: { width: '20em' }, image: { width: '100%', height: '10em' } })
  })
})

describe('tooltips that only resemble layout', () => {
  it('are tooltips, not malformed', () => {
    expect(parseImageTitle('left-handed').kind).toBe('tooltip')
    // A unit-less number stays malformed: a missing unit is the likeliest typo.
    expect(parseImageTitle('320 left').kind).toBe('malformed')
    expect(parseImageTitle('12emm right').kind).toBe('malformed')
  })
})

describe('the crop inset', () => {
  it('reads CSS shorthand after the alignment and formats it back shortest-first', () => {
    const parsed = parseImageTitle('12em right inset(10% 0 5%)')
    expect(parsed).toMatchObject({ kind: 'layout', layout: { inset: { top: 10, right: 0, bottom: 5, left: 0 } } })
    if (parsed.kind !== 'layout') throw new Error('expected a layout')
    expect(formatImageLayout(parsed.layout)).toBe('12em right inset(10% 0 5%)')
    expect(formatImageInset({ top: 5, right: 5, bottom: 5, left: 5 })).toBe('inset(5%)')
    expect(formatImageInset({ top: 0, right: 0, bottom: 0, left: 0 })).toBe('')
  })

  it('calls an inset that crops everything, or is not a percentage, malformed', () => {
    expect(parseImageTitle('right inset(60% 0 40%)').kind).toBe('malformed')
    expect(parseImageTitle('right inset(10px)').kind).toBe('malformed')
  })
})
