import { describe, expect, it } from 'vitest'
import { imageUsesIn } from './images'

describe('imageUsesIn', () => {
  it('lists uses in order with their headings, skipping code', () => {
    const text = [
      '![lead](&1)',
      '## Cats',
      'text ![tom](&2 "left 10em") and `![no](&9)`',
      '### Tabby',
      '![again](&1)',
      '```',
      '## Not a heading ![x](&8)',
      '```',
      '## Dogs ##',
      '![rex](<&3>)',
    ].join('\n')
    expect(imageUsesIn(text).map((use) => [use.id, use.alt, use.section, use.subsection])).toEqual([
      ['&1', 'lead', null, null],
      ['&2', 'tom', 'Cats', null],
      ['&1', 'again', 'Cats', 'Tabby'],
      ['&3', 'rex', 'Dogs', null],
    ])
    expect(text.slice(imageUsesIn(text)[1].from).startsWith('![tom]')).toBe(true)
  })
})
