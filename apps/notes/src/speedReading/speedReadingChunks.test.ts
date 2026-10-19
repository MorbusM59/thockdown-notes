import { describe, expect, it } from 'vitest'
import { displayWord, nextChunk, wordStartAt } from './speedReadingChunks'

function readAll(text: string, width: number): string[] {
  const out: string[] = []
  let pos = 0
  for (let guard = 0; guard < 1000; guard += 1) {
    const chunk = nextChunk(text, pos, width)
    if (!chunk) break
    expect(chunk.end).toBeGreaterThan(pos)
    out.push(chunk.text)
    pos = chunk.end
  }
  return out
}

describe('nextChunk', () => {
  it('packs as many whole words as fit the row', () => {
    expect(readAll('one two three four five six', 9)).toEqual(['one two', 'three', 'four five', 'six'])
  })

  it('never puts more letters in a chunk than the row holds', () => {
    const text = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore'
    for (const width of [6, 10, 17, 24, 40]) {
      for (const chunk of readAll(text, width)) expect(chunk.length).toBeLessThanOrEqual(width)
    }
  })

  it('stops at a line break and leaves block markup out', () => {
    expect(readAll('# Title here\n\n- [ ] **bold** item\n> quoted [link](http://x.y) end', 40))
      .toEqual(['Title here', 'bold item', 'quoted link end'])
  })

  it('cuts a word longer than the row and carries on inside it', () => {
    expect(readAll('a supercalifragilistic b', 8)).toEqual(['a', 'superca-', 'lifragi-', 'listic b'])
  })

  it('skips images and markup-only tokens', () => {
    expect(displayWord('![alt](img.png)')).toBe('')
    expect(displayWord('|')).toBe('')
    expect(displayWord('`code`')).toBe('code')
    expect(readAll('| a | b |\n![x](y)\nlast', 20)).toEqual(['a b', 'last'])
  })

  it('returns null past the last word', () => {
    expect(nextChunk('word   \n\n', 4, 10)).toBeNull()
  })
})

describe('wordStartAt', () => {
  it('backs up to the start of the word the caret is in', () => {
    expect(wordStartAt('hello world', 8)).toBe(6)
    expect(wordStartAt('hello world', 6)).toBe(6)
    expect(wordStartAt('hello world', 0)).toBe(0)
  })
})
