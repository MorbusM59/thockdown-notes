import { describe, expect, it } from 'vitest'
import { splitPreviewBlockRangesProgressively } from './PreviewBlockSplit'
import { documentImagesIn } from './DocumentImages'
import { imageSourcesToStore, imageStorageState, rewriteToOrigins, rewriteToStored } from './ImageStorageRewrite'

const apply = (text: string, edit: { from: number; to: number; insert: string } | null) =>
  edit ? text.slice(0, edit.from) + edit.insert + text.slice(edit.to) : text

describe('the image button rewrites', () => {
  const original = 'A ![Logo](https://e.com/l.png "&LOGO 12em right") and ![Map](/home/j/map.png).\n\n![Tip](https://e.com/t.png "A tooltip")\n'

  it('asks for each source once, with the id its title chose', () => {
    expect(imageSourcesToStore(documentImagesIn(original, splitPreviewBlockRangesProgressively))).toEqual([
      { source: 'https://e.com/l.png', requestedId: '&LOGO' },
      { source: '/home/j/map.png', requestedId: null },
      { source: 'https://e.com/t.png', requestedId: null },
    ])
  })

  it('stores, then restores to the text it started from', () => {
    const stored = apply(original, rewriteToStored(original, documentImagesIn(original, splitPreviewBlockRangesProgressively), {
      'https://e.com/l.png': { ok: true, id: '&LOGO' },
      '/home/j/map.png': { ok: true, id: '&1' },
      'https://e.com/t.png': { ok: false, reason: 'unreachable' },
    }))
    expect(stored).toBe('A ![Logo](&LOGO "12em right") and ![Map](&1).\n\n![Tip](https://e.com/t.png "A tooltip")\n')
    expect(imageStorageState(documentImagesIn(stored, splitPreviewBlockRangesProgressively))).toBe('external')
    const restored = apply(stored, rewriteToOrigins(stored, documentImagesIn(stored, splitPreviewBlockRangesProgressively), {
      '&LOGO': 'https://e.com/l.png',
      '&1': '/home/j/map.png',
    }))
    expect(restored).toBe('A ![Logo](https://e.com/l.png "&LOGO 12em right") and ![Map](/home/j/map.png "&1").\n\n![Tip](https://e.com/t.png "A tooltip")\n')
  })

  it('leaves a stored image with no origin stored, and quotes an origin with spaces', () => {
    const text = '![a](&1) ![b](&2)'
    expect(apply(text, rewriteToOrigins(text, documentImagesIn(text, splitPreviewBlockRangesProgressively), { '&1': null, '&2': 'C:/My Pictures/b.png' })))
      .toBe('![a](&1) ![b](<C:/My Pictures/b.png> "&2")')
  })
})
