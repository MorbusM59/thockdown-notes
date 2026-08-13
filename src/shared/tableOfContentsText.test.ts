import { describe, expect, it } from 'vitest'
import { headingsChanged } from './tableOfContentsText'

describe('headingsChanged', () => {
  it('is false when nothing changed', () => {
    const text = '# Title\n\n## Section One\n\nbody\n\n## Section Two'
    expect(headingsChanged(text, text)).toBe(false)
  })

  it('is false for a change that touches only non-heading text', () => {
    const oldText = '## Section\n\nold body'
    const newText = '## Section\n\nnew body, totally different'
    expect(headingsChanged(oldText, newText)).toBe(false)
  })

  it('is true when a heading is added', () => {
    const oldText = '## Section One'
    const newText = '## Section One\n\n## Section Two'
    expect(headingsChanged(oldText, newText)).toBe(true)
  })

  it('is true when a heading is removed', () => {
    const oldText = '## Section One\n\n## Section Two'
    const newText = '## Section One'
    expect(headingsChanged(oldText, newText)).toBe(true)
  })

  it('is true when a heading is relabeled', () => {
    const oldText = '## Old Label'
    const newText = '## New Label'
    expect(headingsChanged(oldText, newText)).toBe(true)
  })

  it('is true when a heading changes level', () => {
    const oldText = '## Section'
    const newText = '### Section'
    expect(headingsChanged(oldText, newText)).toBe(true)
  })

  it('ignores headings inside fenced code blocks on both sides', () => {
    const oldText = 'intro\n\n```\n# not a real heading\n```\n\n## Real'
    const newText = 'intro\n\n```\n# still not a real heading, edited\n```\n\n## Real'
    expect(headingsChanged(oldText, newText)).toBe(false)
  })
})
