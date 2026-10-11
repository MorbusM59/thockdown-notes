import { describe, expect, it } from 'vitest'
import { buildTagHierarchy, GENERAL_SECONDARY_NAME, UNCATEGORIZED_PRIMARY_NAME } from './tagHierarchy'

describe('buildTagHierarchy', () => {
  it('places each item once, by the order of its tags, skipping protected tags', () => {
    const items = [
      { id: 'a', tags: ['cats', 'tabby'] },
      { id: 'b', tags: ['archived', 'cats'] },
      { id: 'c', tags: ['tabby', 'cats', 'old'] },
      { id: 'd', tags: [] },
    ]
    const shape = buildTagHierarchy(items, (item) => item.tags, 'Images').map((primary) => [
      primary.name,
      primary.secondary.map((secondary) => [secondary.name, secondary.tertiary.map((tertiary) => [tertiary.name, tertiary.items.map((item) => item.id)])]),
    ])
    expect(shape).toEqual([
      ['cats', [[GENERAL_SECONDARY_NAME, [['Images', ['b']]]], ['tabby', [['Images', ['a']]]]]],
      ['tabby', [['cats', [['old', ['c']]]]]],
      [UNCATEGORIZED_PRIMARY_NAME, [[GENERAL_SECONDARY_NAME, [['Images', ['d']]]]]],
    ])
  })
})
