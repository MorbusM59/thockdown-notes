import { describe, expect, it } from 'vitest'
import type { StoredImageSummary } from '../shared/images'
import { imagesInView } from './imageLibraryViews'

const image = (id: string, extra: Partial<StoredImageSummary> = {}): StoredImageSummary => ({
  id, src: '', width: 1, height: 1, mime: 'image/png', byteLength: 1, origin: null,
  createdAt: '2026-10-11T00:00:00Z', tags: [], useCount: 1, trashedAt: null, ...extra,
})

describe('image library views', () => {
  const all = [
    image('&1', { tags: ['cats'], origin: '/pics/tom.png' }),
    image('&2', { useCount: 0, tags: ['cats', 'dogs'] }),
    image('&3', { trashedAt: '2026-10-11T01:00:00Z' }),
    image('&LOGO'),
  ]
  it('splits used, unused and trashed images between the views', () => {
    expect(imagesInView(all, 'date', '', false).map((i) => i.id)).toEqual(['&1', '&2', '&LOGO'])
    expect(imagesInView(all, 'category', '', false).map((i) => i.id)).toEqual(['&1', '&LOGO'])
    expect(imagesInView(all, 'archive', '', false).map((i) => i.id)).toEqual(['&2'])
    expect(imagesInView(all, 'trash', '', false).map((i) => i.id)).toEqual(['&3'])
  })
  it('searches ids, origins and tags', () => {
    expect(imagesInView(all, 'date', 'logo', false).map((i) => i.id)).toEqual(['&LOGO'])
    expect(imagesInView(all, 'date', 'tom', false).map((i) => i.id)).toEqual(['&1'])
    expect(imagesInView(all, 'date', '#dog', false).map((i) => i.id)).toEqual(['&2'])
  })
})
