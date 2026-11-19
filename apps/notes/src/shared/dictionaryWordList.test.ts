import { describe, expect, it } from 'vitest'
import { DICTIONARY_DIVIDER_THRESHOLD, groupDictionaryWords } from './dictionaryWordList'

describe('groupDictionaryWords', () => {
  it('lists a short dictionary by first letter, case and accents aside', () => {
    const groups = groupDictionaryWords(['eclipse', 'Éclair', 'apple', '3rd', 'Apricot'], '')
    expect(groups.map((group) => [group.label, group.words])).toEqual([
      ['#', ['3rd']],
      ['A', ['apple', 'Apricot']],
      ['E', ['Éclair', 'eclipse']],
    ])
    expect(groups.every((group) => group.dividers === null)).toBe(true)
  })

  it('divides a long one by second letter, and filters anywhere in a word', () => {
    const words = Array.from({ length: DICTIONARY_DIVIDER_THRESHOLD }, (_, index) => `${index % 2 ? 'ba' : 'bo'}${index}`)
    const [group] = groupDictionaryWords(words, '')
    expect(group.label).toBe('B')
    expect(group.dividers?.map((divider) => [divider.label, divider.words.length])).toEqual([['Ba', 250], ['Bo', 250]])
    expect(groupDictionaryWords(words, 'A49').flatMap((entry) => entry.words)).toEqual(['ba49', 'ba491', 'ba493', 'ba495', 'ba497', 'ba499'])
  })
})
