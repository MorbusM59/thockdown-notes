import { describe, expect, it } from 'vitest'
import { imagesInLine } from './imageSyntax'

const parts = (line: string) => imagesInLine(line).map((span) => [
  line.slice(span.from, span.to),
  line.slice(span.destinationFrom, span.destinationTo),
  span.titleFrom === null ? null : line.slice(span.titleFrom, span.titleTo!),
])

describe('imagesInLine', () => {
  it('reads destinations with balanced parentheses, angle brackets and titles', () => {
    expect(parts('a ![w](https://e.org/Foo_(bar).png)![t](&1 "x)y") ![s](<C:/my pics/a.png> \'q\') ![]()')).toEqual([
      ['![w](https://e.org/Foo_(bar).png)', 'https://e.org/Foo_(bar).png', null],
      ['![t](&1 "x)y")', '&1', 'x)y'],
      ["![s](<C:/my pics/a.png> 'q')", '<C:/my pics/a.png>', 'q'],
      ['![]()', '', null],
    ])
  })
  it('rejects what is not an image', () => {
    expect(parts('![a](b(c) ![a] (b) ![a](b "t) ![a[b]](c)')).toEqual([])
  })
})
