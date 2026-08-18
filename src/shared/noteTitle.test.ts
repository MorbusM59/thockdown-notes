import { describe, expect, it } from 'vitest'
import { deriveNoteTitleFromText, deriveNoteTitleIncremental, type NoteTitleCache } from './noteTitle'

describe('deriveNoteTitleIncremental', () => {
  function expectMatchesFullScan(text: string, result: { title: string }) {
    expect(result.title).toBe(deriveNoteTitleFromText(text))
  }

  it('uses the first line only for a note title', () => {
    const text = '# My Title\nbody text'
    const result = deriveNoteTitleIncremental(text, null)
    expectMatchesFullScan(text, result)
    expect(result.title).toBe('My Title')
  })

  it('shows Missing title for a non-heading first line', () => {
    const text = 'plain intro\nbody text'
    const result = deriveNoteTitleIncremental(text, null)
    expectMatchesFullScan(text, result)
    expect(result.title).toBe('Missing title')
  })

  it('ignores headings that appear later in the document', () => {
    const text = 'plain intro\n# Later heading\nbody text'
    const result = deriveNoteTitleIncremental(text, null)
    expectMatchesFullScan(text, result)
    expect(result.title).toBe('Missing title')
  })

  it('treats an empty heading marker as missing title', () => {
    const text = '# \nbody text'
    const result = deriveNoteTitleIncremental(text, null)
    expectMatchesFullScan(text, result)
    expect(result.title).toBe('Missing title')
  })
})
