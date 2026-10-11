import { describe, expect, it } from 'vitest'
import { collapsedSelectionAt } from './TransformResult'
import { resolveImageArrowTransform, resolveImageClearLayoutTransform, resolveImageSelectionStep } from './MarkdownImageTransforms'

const noFence = () => false
const caretIn = (text: string, marker: string) => collapsedSelectionAt(text.indexOf(marker))
const arrow = (text: string, direction: 'left' | 'right' | 'up' | 'down', at = 'png') =>
  resolveImageArrowTransform({ direction, text, selection: caretIn(text, at) }, noFence)?.text ?? null

describe('image keys in the edit view', () => {
  it('aligns along left, center, right, starting from either side', () => {
    expect(arrow('A ![x](a.png) b', 'right')).toBe('A ![x](a.png "right") b')
    expect(arrow('![x](a.png "right")', 'left')).toBe('![x](a.png "center")')
    expect(arrow('![x](a.png "center")', 'left')).toBe('![x](a.png "left")')
    expect(arrow('![x](a.png "left")', 'left')).toBeNull()
  })

  it('resizes in its own unit, and gives a first width in em', () => {
    expect(arrow('![x](a.png)', 'up')).toBe('![x](a.png "20em")')
    expect(arrow('![x](a.png "20em right")', 'down')).toBe('![x](a.png "19em right")')
    expect(arrow('![x](a.png "300px")', 'up')).toBe('![x](a.png "310px")')
    expect(arrow('![x](a.png "100%")', 'up')).toBeNull()
    expect(arrow('![x](a.png "x8em")', 'up')).toBe('![x](a.png "x9em")')
  })

  it('keeps the id and the caret, and leaves tooltips, code and other text alone', () => {
    expect(arrow('![x](a.png "&LOGO")', 'right')).toBe('![x](a.png "&LOGO right")')
    expect(arrow('![x](a.png "A photo")', 'right')).toBeNull()
    expect(arrow('plain text', 'right', 'text')).toBeNull()
    expect(resolveImageArrowTransform({ direction: 'up', text: '![x](a.png)', selection: caretIn('![x](a.png)', 'png') }, () => true)).toBeNull()
    const result = resolveImageArrowTransform({ direction: 'up', text: 'Hi ![x](a.png) there', selection: caretIn('Hi ![x](a.png) there', 'there') }, noFence)
    expect(result).toBeNull()
  })

  it('clears size and alignment but not the id', () => {
    const text = '![x](a.png "&LOGO 12em left")'
    expect(resolveImageClearLayoutTransform({ text, selection: caretIn(text, 'png') }, noFence)?.text).toBe('![x](a.png "&LOGO")')
    const bare = '![x](a.png "12em")'
    expect(resolveImageClearLayoutTransform({ text: bare, selection: caretIn(bare, 'png') }, noFence)?.text).toBe('![x](a.png)')
  })

  it('selects alt text, then the id, then the whole image', () => {
    const text = 'See ![Logo](a.png "&LOGO 12em") here'
    const first = resolveImageSelectionStep({ text, clickOffset: text.indexOf('ogo'), selection: collapsedSelectionAt(0) }, noFence)!
    expect(text.slice(first.start, first.end)).toBe('Logo')
    const selection = (range: { start: number; end: number }) => ({ anchor: range.start, focus: range.end, start: range.start, end: range.end, isCollapsed: false })
    const second = resolveImageSelectionStep({ text, clickOffset: first.start, selection: selection(first) }, noFence)!
    expect(text.slice(second.start, second.end)).toBe('&LOGO')
    const third = resolveImageSelectionStep({ text, clickOffset: second.start, selection: selection(second) }, noFence)!
    expect(text.slice(third.start, third.end)).toBe('![Logo](a.png "&LOGO 12em")')
  })
})

describe('malformedImageTitlesOnLine', () => {
  it('marks only a layout-shaped title that does not parse', async () => {
    const { malformedImageTitlesOnLine } = await import('./MarkdownImageTransforms')
    const line = '![a](x.png "12emm right") ![b](y.png "Sunset") ![c](z.png "12em right")'
    const ranges = malformedImageTitlesOnLine(line)
    expect(ranges.map((r) => line.slice(r.from, r.to))).toEqual(['12emm right'])
  })
})
