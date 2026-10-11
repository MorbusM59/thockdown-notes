import { describe, expect, it } from 'vitest'
import { locateImage, moveImage, reshapeImage } from './ImagePlacement'

const apply = (text: string, edit: { from: number; to: number; insert: string } | null) =>
  edit ? text.slice(0, edit.from) + edit.insert + text.slice(edit.to) : text

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
})
