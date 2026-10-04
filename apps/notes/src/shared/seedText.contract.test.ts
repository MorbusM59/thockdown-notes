import { describe, expect, it } from 'vitest'
import * as guide from '../../electron/help/helpGuideContent'
import * as welcome from '../../electron/help/helpNoteContent'
import { singleCellText } from './singleCellText'

/**
 * The text the app seeds as notes -- the User Guide and the welcome note --
 * already obeys the single-cell rule (singleCellText.ts). Otherwise it is
 * silently changed the moment it loads into the editor: an emoji in the
 * guide's prose would just vanish, and a guide note is read-only, so nobody
 * would ever see it said. Walks every string both modules export, so new
 * content is covered without joining a list.
 */
describe('seeded note text', () => {
  const strings: Array<[string, string]> = []
  const walk = (label: string, value: unknown) => {
    if (typeof value === 'string') strings.push([label, value])
    else if (Array.isArray(value)) value.forEach((entry, index) => walk(`${label}[${index}]`, entry))
    else if (value && typeof value === 'object') Object.entries(value).forEach(([key, entry]) => walk(`${label}.${key}`, entry))
  }
  walk('helpGuideContent', guide)
  walk('helpNoteContent', welcome)

  it('finds the seeded text at all', () => {
    expect(strings.length).toBeGreaterThan(10)
  })

  it('keeps every character to one cell of the editor grid', () => {
    const offenders = strings
      .map(([label, text]) => {
        const tabbed = text.replace(/\t/g, '   ')
        const removed = [...new Set([...tabbed].filter((char) => !singleCellText(char)))]
        return { label, removed: removed.map((char) => `U+${char.codePointAt(0)!.toString(16).toUpperCase()}`) }
      })
      .filter((entry) => entry.removed.length > 0)
    expect(offenders).toEqual([])
  })
})
