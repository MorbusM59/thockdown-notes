import type { StoredImageSummary } from '../shared/images'
import { matchesNoteSearchQuery } from '../shared/noteSearch'

// WHICH IMAGES EACH SIDEBAR VIEW SHOWS, as a pure function of the list.
//
//   date      every image not in the trash, newest first
//   category  images some note uses, grouped by their own tags
//   archive   images no note uses (archived by derivation), grouped likewise
//   trash     images in the trash, most recently trashed first
//
// The trees are the notes' own (`shared/tagHierarchy.ts`): an image sits in
// one place, its first tag the primary group, its second the secondary. Search matches the id, the
// origin and the tags, and `#tag` only the tags, as it does for notes.

export type ImageLibraryView = 'date' | 'category' | 'archive' | 'trash'

export function matchesImageSearch(image: StoredImageSummary, query: string, caseSensitive: boolean): boolean {
  return matchesNoteSearchQuery({ title: image.id, fileName: image.origin ?? '', tags: image.tags }, query, caseSensitive)
}

export function imagesInView(images: readonly StoredImageSummary[], view: ImageLibraryView, query: string, caseSensitive: boolean): StoredImageSummary[] {
  const shown = images.filter((image) => {
    if ((image.trashedAt !== null) !== (view === 'trash')) return false
    if (view === 'category' && image.useCount === 0) return false
    if (view === 'archive' && image.useCount > 0) return false
    return matchesImageSearch(image, query, caseSensitive)
  })
  if (view === 'trash') return shown.sort((a, b) => (b.trashedAt ?? '').localeCompare(a.trashedAt ?? ''))
  return shown
}
