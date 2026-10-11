import type { NoteImageUse, StoredImageSummary } from '../shared/images'
import { matchesNoteSearchQuery } from '../shared/noteSearch'
import { GENERAL_SECONDARY_NAME, type TagPrimaryGroup } from '../shared/tagHierarchy'

// WHAT EACH SIDEBAR VIEW SHOWS IN IMAGE MODE, as pure functions.
//
//   date      "Images in Order": every image in the current note, stored or
//             external, in the order the note uses them, a card per use
//   category  "Images by Section": the same uses, grouped by the `##` and
//             `###` headings they fall under, in the note's order
//   archive   "Image Archive": every image not in the trash, grouped by its
//             own tags in the notes' tree (shared/tagHierarchy.ts)
//   trash     images in the trash, most recently trashed first
//
// Search matches an image's id, origin and tags, a use's alt text too, and
// `#tag` only the tags, as it does for notes.

export type ImageLibraryView = 'date' | 'category' | 'archive' | 'trash'

/** An image in the current note, with the stored image it names (null for an external one). */
export interface ImageUseCard {
  use: NoteImageUse
  image: StoredImageSummary | null
  /** Stable while the note is typed: the image's id and which of its uses this is. */
  key: string
}

/** The group of the uses before a note's first `##` heading. */
export const BEFORE_FIRST_SECTION = 'Opening'

export function matchesImageSearch(image: StoredImageSummary, query: string, caseSensitive: boolean, alt = ''): boolean {
  return matchesNoteSearchQuery({ title: `${image.id} ${alt}`, fileName: image.origin ?? '', tags: image.tags }, query, caseSensitive)
}

export function imagesInView(images: readonly StoredImageSummary[], view: 'archive' | 'trash', query: string, caseSensitive: boolean): StoredImageSummary[] {
  const shown = images.filter((image) => (image.trashedAt !== null) === (view === 'trash') && matchesImageSearch(image, query, caseSensitive))
  if (view === 'trash') return shown.sort((a, b) => (b.trashedAt ?? '').localeCompare(a.trashedAt ?? ''))
  return shown
}

/**
 * The uses whose image is external or in the library, and that match the
 * search, in the note's order. A stored id with nothing behind it is left
 * out: the render view already says it is missing.
 */
export function imageUseCards(uses: readonly NoteImageUse[], images: readonly StoredImageSummary[], query: string, caseSensitive: boolean): ImageUseCard[] {
  const byId = new Map(images.map((image) => [image.id, image]))
  const seen = new Map<string, number>()
  return uses.flatMap<ImageUseCard>((use) => {
    const ordinal = seen.get(use.src) ?? 0
    seen.set(use.src, ordinal + 1)
    const key = `${use.src}#${ordinal}`
    if (use.id === null) {
      return matchesNoteSearchQuery({ title: use.alt, fileName: use.src, tags: [] }, query, caseSensitive) ? [{ use, image: null, key }] : []
    }
    const image = byId.get(use.id)
    return image && matchesImageSearch(image, query, caseSensitive, use.alt) ? [{ use, image, key }] : []
  })
}

/**
 * The cards grouped by section and subsection, in the shape the category
 * tree draws (components/CategoryTree.tsx): groups in the note's order, a use
 * with no `###` under its section's unlabelled general group.
 */
export function groupCardsBySection(cards: readonly ImageUseCard[]): TagPrimaryGroup<ImageUseCard>[] {
  const sections = new Map<string, Map<string, ImageUseCard[]>>()
  for (const card of cards) {
    const sectionName = card.use.section ?? BEFORE_FIRST_SECTION
    let subsections = sections.get(sectionName)
    if (!subsections) sections.set(sectionName, subsections = new Map())
    const subsectionName = card.use.subsection ?? GENERAL_SECONDARY_NAME
    let list = subsections.get(subsectionName)
    if (!list) subsections.set(subsectionName, list = [])
    list.push(card)
  }
  return [...sections].map(([name, subsections]) => ({
    name,
    secondary: [...subsections].map(([subsectionName, items]) => ({ name: subsectionName, tertiary: [{ name: '', items }] })),
  }))
}
