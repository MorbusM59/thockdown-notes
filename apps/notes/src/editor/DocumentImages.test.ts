import { describe, expect, it } from 'vitest'
import { splitPreviewBlockRangesProgressively } from './PreviewBlockSplit'
import { documentImagesIn } from './DocumentImages'

describe('documentImagesIn', () => {
  it('finds images with their source spans and skips code', () => {
    const text = '# T\n\nSee ![a](https://e.com/a.png "12em left") and `![no](x.png)`.\n\n```\n![no](y.png)\n```\n\n![b](&LOGO)\n'
    const images = documentImagesIn(text, splitPreviewBlockRangesProgressively)
    expect(images.map((image) => [text.slice(image.from, image.to), image.url, image.title])).toEqual([
      ['![a](https://e.com/a.png "12em left")', 'https://e.com/a.png', '12em left'],
      ['![b](&LOGO)', '&LOGO', null],
    ])
  })
  it('keeps offsets right deep into a long document', () => {
    const filler = Array.from({ length: 400 }, (_, i) => `Paragraph ${i}.\n`).join('\n')
    const text = `${filler}\n![z](z.png)\n`
    const [image] = documentImagesIn(text, splitPreviewBlockRangesProgressively)
    expect(text.slice(image.from, image.to)).toBe('![z](z.png)')
  })
})
