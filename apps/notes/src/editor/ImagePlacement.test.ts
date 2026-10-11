import { describe, expect, it } from 'vitest'
import { insertAtBlockStart, locateImage, moveImage, reshapeImage } from './ImagePlacement'

type Change = { from: number; to: number; insert: string }
// Changes are in the coordinates of the original text: apply from the end.
const apply = (text: string, edit: Change | Change[] | null) =>
  (edit ? [edit].flat() : []).sort((a, b) => b.from - a.from).reduce((acc, c) => acc.slice(0, c.from) + c.insert + acc.slice(c.to), text)

describe('image placement', () => {
  const text = '# T\n\nFirst ![a](a.png "10em") and ![b](b.png).\n\n- item one\n\nLast.'
  it('locates an image by line and ordinal, only when the counts agree', () => {
    expect(locateImage(text, 2, 1, 2)?.layout.width).toBeNull()
    expect(locateImage(text, 2, 0, 2)?.layout.width).toEqual({ value: 10, unit: 'em' })
    expect(locateImage(text, 2, 0, 3)).toBeNull()
  })
  it('reshapes', () => {
    const image = locateImage(text, 2, 1, 2)!
    expect(apply(text, reshapeImage(text, image, { ...image.layout, width: { value: 5, unit: 'em' } })))
      .toContain('![b](b.png "5em").')
  })
  it('moves forward into a list item, after its marker', () => {
    const image = locateImage(text, 2, 0, 2)!
    expect(apply(text, moveImage(text, image, 4, 'right')))
      .toBe('# T\n\nFirst and ![b](b.png).\n\n- ![a](a.png "10em right") item one\n\nLast.')
  })
  it('moves backward, taking a line it leaves empty', () => {
    const own = '# T\n\nPara.\n\n![a](a.png)\n\nEnd.'
    const image = locateImage(own, 4, 0, 1)!
    expect(apply(own, moveImage(own, image, 2, 'left'))).toBe('# T\n\n![a](a.png "left") Para.\n\n\nEnd.')
  })
  it('refuses blocks an image cannot open', () => {
    const doc = '![a](a.png)\n\n| h |\n| - |\n\n```js\nx\n```\n\n---\n\n> - Quote.'
    const image = locateImage(doc, 0, 0, 1)!
    for (const line of [2, 5, 9]) {
      expect(moveImage(doc, image, line, 'left')).toBeNull()
      expect(insertAtBlockStart(doc, line, '![b](b.png)')).toBeNull()
    }
    expect(apply(doc, moveImage(doc, image, 11, 'left'))).toBe('\n| h |\n| - |\n\n```js\nx\n```\n\n---\n\n> - ![a](a.png "left") Quote.')
  })
  it('moves as a removal and an insertion, leaving the text between untouched', () => {
    const image = locateImage(text, 2, 0, 2)!
    const edit = moveImage(text, image, 6, 'left')!
    expect(edit.every((change) => change.insert === '' || change.insert.startsWith('![a]'))).toBe(true)
  })
})
