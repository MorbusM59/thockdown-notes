import { describe, expect, it } from 'vitest'
import { isWhitespaceAt, readFenceTokenAt } from './textScanning'

/**
 * These replaced two regexes that were correct. The only thing worth testing
 * is that they still answer identically -- so each case runs the regex it
 * replaced as the oracle, rather than restating an expected value by hand.
 */
describe('isWhitespaceAt', () => {
  it('agrees with /\\s/u at every index of a string covering every relevant class', () => {
    const text = 'a \t\n\r\v\fZ       　﻿​中\u{1f600}.'
    for (let index = 0; index < text.length; index += 1) {
      expect(isWhitespaceAt(text, index), `index ${index}: ${JSON.stringify(text[index])}`)
        .toBe(/\s/u.test(text[index]))
    }
  })
})

describe('readFenceTokenAt', () => {
  const oracle = (line: string) => {
    const match = line.match(/^\s*(```+|~~~+)/)
    if (!match) return null
    return { char: match[1].charCodeAt(0) === 96 ? '`' : '~', length: match[1].length }
  }

  const expectAgrees = (line: string) => {
    // Read as a line embedded in a document, which is how the scanner calls
    // it -- the bounds, not a slice, are what confine it.
    const text = `before\n${line}\nafter`
    const lineStart = 'before\n'.length
    expect(readFenceTokenAt(text, lineStart, lineStart + line.length), JSON.stringify(line))
      .toEqual(oracle(line))
  }

  it('agrees on hand-picked shapes', () => {
    for (const line of [
      '', '`', '``', '```', '````', '`````js', '~~~', '~~', '~~~~yaml',
      '   ```', '\t```', '  ~~~~', '```  ', 'text ```', '`` `', '~~~```',
      ' ```', 'a```', '```~~~',
    ]) expectAgrees(line)
  })

  it('agrees on randomized lines', () => {
    let seed = 424242
    const rng = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff }
    const alphabet = ['`', '~', ' ', '\t', 'a', '1', ' ', '-']
    for (let trial = 0; trial < 3000; trial += 1) {
      let line = ''
      const length = Math.floor(rng() * 10)
      for (let i = 0; i < length; i += 1) line += alphabet[Math.floor(rng() * alphabet.length)]
      expectAgrees(line)
    }
  })

  it('stops at the line end rather than running into the next line', () => {
    const text = '``\n`more'
    // Two backticks then a newline is not a fence, even though the document
    // continues with another one.
    expect(readFenceTokenAt(text, 0, 2)).toBeNull()
  })
})
