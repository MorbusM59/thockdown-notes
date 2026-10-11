import { describe, expect, it } from 'vitest'
import type { NoteImageUse, StoredImageSummary } from '../shared/images'
import { GENERAL_SECONDARY_NAME } from '../shared/tagHierarchy'
import { BEFORE_FIRST_SECTION, groupCardsBySection, imagesInView, imageUseCards } from './imageLibraryViews'

const image = (id: string, extra: Partial<StoredImageSummary> = {}): StoredImageSummary => ({
  id, src: '', width: 1, height: 1, mime: 'image/png', byteLength: 1, origin: null,
  createdAt: '2026-10-11T00:00:00Z', tags: [], useCount: 1, trashedAt: null, ...extra,
})
const use = (id: string, alt: string, section: string | null, subsection: string | null, from: number): NoteImageUse => ({ id, alt, from, to: from + 1, section, subsection })

describe('image library views', () => {
  const all = [
    image('&1', { tags: ['cats'], origin: '/pics/tom.png' }),
    image('&2', { useCount: 0, tags: ['cats', 'dogs'] }),
    image('&3', { trashedAt: '2026-10-11T01:00:00Z' }),
    image('&LOGO'),
  ]
  it('archives every image outside the trash', () => {
    expect(imagesInView(all, 'archive', '', false).map((i) => i.id)).toEqual(['&1', '&2', '&LOGO'])
    expect(imagesInView(all, 'trash', '', false).map((i) => i.id)).toEqual(['&3'])
    expect(imagesInView(all, 'archive', 'tom', false).map((i) => i.id)).toEqual(['&1'])
    expect(imagesInView(all, 'archive', '#dog', false).map((i) => i.id)).toEqual(['&2'])
  })
  it('lists a card per use, in order, searchable by alt text', () => {
    const uses = [use('&2', 'lead', null, null, 0), use('&9', 'gone', 'A', null, 5), use('&2', 'again', 'A', 'B', 9)]
    expect(imageUseCards(uses, all, '', false).map((card) => card.use.alt)).toEqual(['lead', 'again'])
    expect(imageUseCards(uses, all, 'again', false).map((card) => card.use.alt)).toEqual(['again'])
    expect(groupCardsBySection(imageUseCards(uses, all, '', false)).map((group) => [group.name, group.secondary.map((s) => s.name)]))
      .toEqual([[BEFORE_FIRST_SECTION, [GENERAL_SECONDARY_NAME]], ['A', ['B']]])
  })
})
