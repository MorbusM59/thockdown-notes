import { describe, expect, it } from 'vitest'
import { deriveNoteTitleFromText } from './noteTitle'
import { normalizeInternalText } from '../editor/TextPolicy'
import { truncateTitle } from './textSanitization'

describe('deriveNoteTitleFromText', () => {
  it('uses the first line only for a note title', () => {
    const text = '# My Title\nbody text'
    expect(deriveNoteTitleFromText(text)).toBe('My Title')
  })

  it('shows Missing title for a non-heading first line', () => {
    const text = 'plain intro\nbody text'
    expect(deriveNoteTitleFromText(text)).toBe('Missing title')
  })

  it('ignores headings that appear later in the document', () => {
    const text = 'plain intro\n# Later heading\nbody text'
    expect(deriveNoteTitleFromText(text)).toBe('Missing title')
  })

  it('treats an empty heading marker as missing title', () => {
    const text = '# \nbody text'
    expect(deriveNoteTitleFromText(text)).toBe('Missing title')
  })

  /**
   * The whole point of the rewrite was reading one line instead of splitting
   * the document, so the test that matters is that it still agrees with the
   * obvious full-document implementation -- including on the inputs where
   * normalization and line-breaking interact (CRLF, a lone CR, the Unicode
   * line/paragraph separators, a leading BOM, tabs).
   */
  it('agrees with the full-document implementation it replaced', () => {
    const referenceImplementation = (text: string): string => {
      const firstLine = normalizeInternalText(text).split('\n')[0] ?? ''
      if (!firstLine.startsWith('# ')) return 'Missing title'
      return truncateTitle(firstLine.slice(2).trim()) || 'Missing title'
    }

    const samples = [
      '',
      '#',
      '# ',
      '# Title',
      '# Title\nbody',
      '# Title\r\nbody',
      '# Title\rbody',
      '# Title\u2028body',
      '# Title\u2029body',
      '\ufeff# Title\nbody',
      '\ufeff# Title',
      '#\tTabbed',
      '# \tTabbed',
      '#  Spaced out  \nbody',
      'plain\n# Later',
      '\n# Second line heading',
      '\r\n# After CRLF',
      `# ${'x'.repeat(200)}\nbody`,
      '# Title with # hash\nbody',
      '   # Indented heading',
    ]

    for (const sample of samples) {
      expect(deriveNoteTitleFromText(sample)).toBe(referenceImplementation(sample))
    }
  })
})
