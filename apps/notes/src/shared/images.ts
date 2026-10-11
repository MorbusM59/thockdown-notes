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
  storeImageSources: 'images:store-sources',
  listImages: 'images:list',
  setImageTags: 'images:set-tags',
  setImageTrashed: 'images:set-trashed',
  purgeImage: 'images:purge',
  renameImage: 'images:rename',
} as const satisfies InvokeChannels<ImagesApi>

/** The scheme stored images are served under (electron/main.ts). */
export const IMAGE_SCHEME = 'thockdown-image'

/** The largest image the app stores (decided 2026-10-11). */
export const MAX_STORED_IMAGE_BYTES = 20 * 1024 * 1024

export interface ImageImportRequest {
  bytes: Uint8Array
  /** The file path or URL the bytes came from; null for a clipboard image. What a restore writes back. */
  origin: string | null
  /**
   * The id the reader chose (`&NAME` in the image's title), or null for the
   * next automatic one. Taken as asked when it is free or already names
   * these bytes; otherwise the image gets `&NAME-2` (then -3, ...), never
   * another picture's name.
   */
  requestedId?: string | null
}

export interface ImageSourceRequest {
  /** What the note points at: an http(s) URL, a file: URL or an absolute path. */
  source: string
  requestedId: string | null
}

export type ImageSourceResult =
  | ImageImportResult
  | { ok: false; reason: 'unreachable' | 'unsupported' }

export type ImageImportResult =
  | { ok: true; id: string }
  | { ok: false; reason: 'too-large' | 'not-an-image' }

/** Why an image could not be stored, in words for a tooltip. */
export function describeImageFailure(reason: 'too-large' | 'not-an-image' | 'unreachable' | 'unsupported'): string {
  switch (reason) {
    case 'too-large': return 'larger than 20 MB'
    case 'not-an-image': return 'not an image the app can show'
    case 'unreachable': return 'could not be fetched'
    case 'unsupported': return 'not a web address or a full file path'
  }
}

export interface ResolvedImage {
  src: string
  /** Intrinsic size in pixels; 0 when the format did not say. */
  width: number
  height: number
  /** The URL or file path it was stored from; null for a clipboard image. */
  origin: string | null
  /** In the library's trash: a note still using it shows that instead of the picture. */
  trashed: boolean
}

/**
 * One stored image as the library lists it. Whether it is ARCHIVED is not
 * stored anywhere: an image no note's current text uses is archived
 * (`useCount === 0`), so the library can never disagree with the notes.
 * Trash is the one deliberate state, and an image in it is in no other view.
 */
export interface StoredImageSummary {
  id: string
  src: string
  width: number
  height: number
  mime: string
  byteLength: number
  origin: string | null
  /** ISO time it was first stored. */
  createdAt: string
  /** The image's own tags, in order (an image's tags are not its notes'). */
  tags: string[]
  /** How many notes' current text uses it. */
  useCount: number
  /** ISO time it was put in the trash; null when it is not there. */
  trashedAt: string | null
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
  /**
   * Fetches what each source points at (a download or a file read) and
   * stores it, answering per source. Called only from the image button's
   * hold, which is the reader's consent to reach the web for these.
   */
  storeImageSources(requests: ImageSourceRequest[]): Promise<Record<string, ImageSourceResult>>
  /** Every stored image, newest first. */
  listImages(): Promise<StoredImageSummary[]>
  /** Replaces an image's tags (normalized like a note's, duplicates dropped); answers what was kept. */
  setImageTags(id: string, tags: string[]): Promise<string[]>
  /** Puts an image in the trash or takes it out. */
  setImageTrashed(id: string, trashed: boolean): Promise<void>
  /**
   * Removes an image that is in the trash for good: its name, tags and, when
   * no other name uses them, its bytes. False when it is not in the trash.
   */
  purgeImage(id: string): Promise<boolean>
  /**
   * Renames an image and rewrites every note whose current text uses it,
   * except those in `openNoteIds`: an open note gets the change as an editor
   * edit instead (so neither its undo history nor an unsaved edit is written
   * over), which the caller applies with renameImageReferences. Frozen notes
   * and snapshots keep the old name, which goes on resolving through an alias.
   */
  renameImage(request: { id: string; newId: string; openNoteIds: string[] }): Promise<ImageRenameResult>
}

export type ImageRenameResult =
  | { ok: true; id: string; rewrittenNoteIds: string[] }
  | { ok: false; reason: 'invalid' | 'taken' | 'missing' }

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
// The same, with everything before the id captured, for rewriting it.
const IMAGE_REFERENCE_WITH_PREFIX = /(!\[[^\]\n]*\]\([ \t]*<?)(&[^\s;()"'&<>]+)/g

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

/**
 * The edits that point every image reference to `fromId` in `text` at `toId`
 * instead (empty when it has none), in the text's own coordinates. Matches
 * the way imageReferencesIn finds them, so a rename reaches exactly what the
 * reference index counted.
 */
export function imageReferenceRenameEdits(text: string, fromId: string, toId: string): Array<{ from: number; to: number; insert: string }> {
  const from = normalizeImageId(fromId)
  if (!from) return []
  const edits: Array<{ from: number; to: number; insert: string }> = []
  IMAGE_REFERENCE_WITH_PREFIX.lastIndex = 0
  for (let match = IMAGE_REFERENCE_WITH_PREFIX.exec(text); match; match = IMAGE_REFERENCE_WITH_PREFIX.exec(text)) {
    if (normalizeImageId(match[2]) !== from) continue
    const at = match.index + match[1].length
    edits.push({ from: at, to: at + match[2].length, insert: toId })
  }
  return edits
}

/** `text` with imageReferenceRenameEdits applied, or null when there was nothing to rename. */
export function renameImageReferences(text: string, fromId: string, toId: string): string | null {
  const edits = imageReferenceRenameEdits(text, fromId, toId)
  if (edits.length === 0) return null
  let next = ''
  let at = 0
  for (const edit of edits) {
    next += text.slice(at, edit.from) + edit.insert
    at = edit.to
  }
  return next + text.slice(at)
}

/** The drag payload of an image card from the library (imageLibrary/): the image's id. */
export const IMAGE_DRAG_MIME_TYPE = 'application/x-thockdown-image'

/** The Markdown a newly stored image is inserted as. */
export function imageMarkdown(alt: string, id: string): string {
  return `![${alt.replace(/[[\]\n]/g, ' ').trim()}](${id})`
}

const IMAGE_EXTENSION = /\.(png|jpe?g|gif|webp|avif|svg)$/i

/**
 * Whether a dropped or pasted file should be offered to the image store.
 * The type the browser reports can be empty for a format it does not know
 * (AVIF on some systems), so the name counts too; the store decides from
 * the bytes either way (electron/imageSniff.ts).
 */
export function isImageFile(file: { type: string; name: string }): boolean {
  return file.type.startsWith('image/') || IMAGE_EXTENSION.test(file.name)
}
