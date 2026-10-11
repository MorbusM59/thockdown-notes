import type { InvokeChannels } from './ipcContract'

// STORED IMAGES: the bytes of an image kept in the database, and the `&ID`
// a note uses to name one (`![Logo](&LOGO)`). The tables, the scheme that
// serves the bytes and the reference index are in electron/databaseService.ts
// and electron/main.ts; the plan is /mnt/project-files/notes/images-plan.md.
//
// The renderer never builds an image's URL. It asks for an id and is told
// what to load (`src`) and how big the image is, so the preview can reserve
// its box before the bytes arrive and the page never reflows when they do.
// That also lets the browser-mode mock answer with a blob: URL where the
// real app answers with its own scheme.

export const IMAGE_CHANNELS = {
  importImage: 'images:import',
  resolveImages: 'images:resolve',
} as const satisfies InvokeChannels<ImagesApi>

/** The scheme stored images are served under (electron/main.ts). */
export const IMAGE_SCHEME = 'thockdown-image'

/** The largest image the app stores (decided 2026-10-11). */
export const MAX_STORED_IMAGE_BYTES = 20 * 1024 * 1024

export interface ImageImportRequest {
  bytes: Uint8Array
  /** The file path or URL the bytes came from; null for a clipboard image. What a restore writes back. */
  origin: string | null
}

export type ImageImportResult =
  | { ok: true; id: string }
  | { ok: false; reason: 'too-large' | 'not-an-image' }

export interface ResolvedImage {
  src: string
  /** Intrinsic size in pixels; 0 when the format did not say. */
  width: number
  height: number
}

export interface ImagesApi {
  /**
   * Stores an image and names it. Bringing in the same bytes from the same
   * origin again returns the id it already has; anything else gets the next
   * free automatic id (`&1`, `&2`, ...).
   */
  importImage(request: ImageImportRequest): Promise<ImageImportResult>
  /** What each id shows; an id with no stored image maps to null. */
  resolveImages(ids: string[]): Promise<Record<string, ResolvedImage | null>>
}

// An id is `&` and at least one character that is not whitespace, `;`
// (CommonMark would read `&NAME;` as a character entity), a bracket, a quote
// or another `&`. The same rule as the `&NAME` token in an image's title
// (shared/imageLayout.ts), which names an image before it is stored.
const IMAGE_ID = /^&([^\s;()"'&<>]+)$/

/**
 * The canonical form of an image id, `&` plus the name upper-cased, or null
 * when `raw` is not one. Case-insensitive like note ids, so `&logo` finds
 * `&LOGO`.
 */
export function normalizeImageId(raw: string): string | null {
  const match = IMAGE_ID.exec(raw.trim())
  return match ? `&${match[1].toUpperCase()}` : null
}

const AUTO_IMAGE_ID = /^&(\d+)$/

/** Lowest free `&n` (n from 1) among the ids in use, the same rule as a note's `$n`. */
export function buildNextAutoImageId(existingIds: Iterable<string>): string {
  const taken = new Set<string>()
  for (const id of existingIds) if (AUTO_IMAGE_ID.test(id)) taken.add(id)
  let candidate = 1
  while (taken.has(`&${candidate}`)) candidate += 1
  return `&${candidate}`
}

// An image whose destination is a stored id: `![alt](&ID` or `![alt](<&ID>`.
const IMAGE_REFERENCE = /!\[[^\]\n]*\]\([ \t]*<?(&[^\s;()"'&<>]+)/g

/**
 * Bump when imageReferencesIn changes what it finds: the reference index is
 * rebuilt for every note on the next launch (DatabaseService).
 */
export const IMAGE_REFERENCE_SCANNER_VERSION = 1

/**
 * Every stored image a note's text uses, normalized and de-duplicated. A
 * reference inside a code block is counted too: the scan is per line and
 * cannot see fences, and counting one there only keeps an image out of the
 * archive, which is the harmless direction.
 */
export function imageReferencesIn(text: string): string[] {
  if (!text.includes('](&') && !text.includes('](<&') && !/\]\([ \t]+<?&/.test(text)) return []
  const ids = new Set<string>()
  IMAGE_REFERENCE.lastIndex = 0
  for (let match = IMAGE_REFERENCE.exec(text); match; match = IMAGE_REFERENCE.exec(text)) {
    const id = normalizeImageId(match[1])
    if (id) ids.add(id)
  }
  return [...ids]
}

/** The Markdown a newly stored image is inserted as. */
export function imageMarkdown(alt: string, id: string): string {
  return `![${alt.replace(/[[\]\n]/g, ' ').trim()}](${id})`
}
