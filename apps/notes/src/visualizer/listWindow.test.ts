import { describe, expect, it } from 'vitest'
import { clampListOffset, maximumListOffset, visibleListWindow } from './listWindow'

const items = (entries: ReturnType<typeof visibleListWindow<string>>) => entries.map((entry) => (
  entry.kind === 'ellipsis' ? '...' : entry.value
))

describe('visualizer list window', () => {
  it('does not scroll or add markers when the whole list fits', () => {
    expect(maximumListOffset(5, 5)).toBe(0)
    expect(visibleListWindow(['a', 'b', 'c'], 2, 5)).toEqual([
      { kind: 'item', value: 'a' },
      { kind: 'item', value: 'b' },
      { kind: 'item', value: 'c' },
    ])
  })

  it('marks hidden entries below, above, and at both ends without wrapping', () => {
    const list = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']
    expect(items(visibleListWindow(list, 0, 5))).toEqual(['a', 'b', 'c', 'd', '...'])
    expect(items(visibleListWindow(list, 1, 5))).toEqual(['...', 'c', 'd', 'e', '...'])
    expect(items(visibleListWindow(list, 2, 5))).toEqual(['...', 'd', 'e', 'f', '...'])
    expect(items(visibleListWindow(list, 3, 5))).toEqual(['...', 'e', 'f', 'g', 'h'])
    expect(maximumListOffset(list.length, 5)).toBe(3)
    expect(clampListOffset(100, list.length, 5)).toBe(3)
  })

  it('keeps the final item in the final slot and handles a one-slot list', () => {
    expect(items(visibleListWindow(['a', 'b', 'c', 'd'], 2, 3))).toEqual(['...', 'c', 'd'])
    expect(items(visibleListWindow(['a', 'b', 'c'], 0, 1))).toEqual(['...'])
    expect(items(visibleListWindow(['a', 'b', 'c'], 2, 1))).toEqual(['c'])
  })
})
