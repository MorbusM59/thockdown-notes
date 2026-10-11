import { describe, expect, it } from 'vitest'
import { formatImageLayout, imageLayoutStyles, parseImageTitle } from './imageLayout'

describe('the image title grammar', () => {
  it('reads every token kind, in any order', () => {
    expect(parseImageTitle('right 12em &LOGO')).toEqual({
      kind: 'layout',
      layout: { id: 'LOGO', width: { value: 12, unit: 'em' }, height: null, align: 'right' },
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
    expect(imageLayoutStyles(parsed.layout)).toEqual({ frame: { width: '20em' }, image: { width: '100%', height: '10em', objectFit: 'contain' } })
  })
})
