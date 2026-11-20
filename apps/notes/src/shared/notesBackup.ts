import { buildNextAutoAssignedId, formatIdWithSigil, isAutoAssignedId, resolveLinkedNoteId } from './assignedIds'
import { buildNextAutoImageId, imageReferenceEditsBy, imageReferencesIn, normalizeImageId, withoutCodeSpans } from './images'
import { hierarchyFromTags } from './tagHierarchy'

/**
 * The Markdown backup (Options > Advanced > Data > Markdown): every note and
 * every image written as ordinary files a third-party Markdown reader can
 * open, plus a manifest that lets the app read the folder back into the same
 * structure.
 *
 *   thockdown.json                         the manifest (BackupManifest)
 *   notes/<primary>/<secondary>/$ID.md     a note, by its id
 *   notes/<primary>/<secondary>/$ID/$ID.md a note with chapters: a folder
 *   notes/<primary>/<secondary>/$ID/§CH.md   holding it and its chapters
 *   notes/Archive/...                      archived notes, the same tree
 *   images/<primary>/<secondary>/&ID.png   an image, by its id
 *
 * The folders are the Category view's tree (`hierarchyFromTags`, the one rule
 * both read). Image references in a note are written as RELATIVE paths to the
 * image files, so a reader outside the app shows them; reading the backup
 * back turns them into `&ID` again. Note links (`$ID§CH#anchor`) are written
 * as they are: they only mean something inside the app.
 *
 * Left out: trashed notes, the User Guide (timeless notes), the generated
 * chapters (contents and open items, which the app rebuilds), snapshots, and
 * trashed images no exported note uses.
 *
 * Reading a backup back resolves id conflicts with the notes and images
 * already there by one rule for both (`resolveImportIds`): an item identical
 * to the one already under its id is skipped, any other collision renames
 * either the incoming item (`-NEW`) or the existing one (`-OLD`), and an id
 * the backup itself holds twice is numbered on every holder (`-1`, `-2`).
 * A provisional id (`$12`, `&12`) carries no meaning anybody chose, so a
 * collision gives it the next free number instead of a suffix. Every link to
 * a renamed id is rewritten with it.
 *
 * Pure, so the layout and the resolution are tested without a database or a
 * disk; electron/notesBackupIo.ts does the reading and writing.
 */

export const BACKUP_MANIFEST_NAME = 'thockdown.json'
export const BACKUP_FORMAT = 'thockdown-backup'
export const BACKUP_VERSION = 1
export const NOTES_FOLDER = 'notes'
export const IMAGES_FOLDER = 'images'
export const ARCHIVE_FOLDER = 'Archive'

export interface BackupNoteSource {
  /** The database row id (never written out). */
  id: string
  assignedId: string | null
  tags: readonly string[]
  createdAtMs: number
  updatedAtMs: number
  isTimeless: boolean
  isGenerated: boolean
}

export interface BackupChapterSource {
  parentNoteId: string
  chapterNoteId: string
  position: number
  chapterId: string | null
}

export interface BackupImageSource {
  id: string
  mime: string
  tags: readonly string[]
  origin: string | null
  createdAt: string
  aliases: readonly string[]
}

export interface ManifestChapter {
  chapterId: string | null
  file: string
  tags: string[]
  createdAt: string
  updatedAt: string
}

export interface ManifestNote {
  id: string | null
  file: string
  tags: string[]
  createdAt: string
  updatedAt: string
  /** In the chapter bar's order. */
  chapters: ManifestChapter[]
}

export interface ManifestImage {
  id: string
  file: string
  tags: string[]
  origin: string | null
  createdAt: string
  /** Names the image had before a rename, which old text may still use. */
  aliases: string[]
}

export interface BackupManifest {
  format: typeof BACKUP_FORMAT
  version: number
  exportedAt: string
  notes: ManifestNote[]
  images: ManifestImage[]
}

export interface BackupPlan {
  manifest: BackupManifest
  /** Each note's file, paths relative to the backup folder with `/`. */
  noteFiles: Array<{ noteId: string; file: string }>
  imageFiles: Array<{ imageId: string; file: string }>
}

const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i
const MAX_NAME_LENGTH = 100

/** A title, tag or id made safe as one file or folder name on every platform. */
export function safeName(raw: string, fallback: string): string {
  const cleaned = raw
    .replace(/[\\/:*?"<>|]/g, '-')
    // Control characters are not allowed in Windows file names.
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/, '')
    .slice(0, MAX_NAME_LENGTH)
    .trim()
  const name = cleaned || fallback
  return WINDOWS_RESERVED.test(name) ? `_${name}` : name
}

const IMAGE_EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/avif': 'avif',
  'image/svg+xml': 'svg',
}

export function imageExtensionFor(mime: string): string {
  return IMAGE_EXTENSIONS[mime] ?? 'bin'
}

const isTrashed = (tags: readonly string[]) => tags.includes('deleted')
const iso = (ms: number) => new Date(ms).toISOString()

/**
 * Where every note and image goes, and the manifest that records it.
 * `usedImageIds` are the images the exported notes reference, so a trashed
 * image a note still shows is kept with it.
 */
export function planBackup(input: {
  notes: readonly BackupNoteSource[]
  chapters: readonly BackupChapterSource[]
  images: readonly BackupImageSource[]
  usedImageIds: ReadonlySet<string>
  exportedAt: string
}): BackupPlan {
  const byId = new Map(input.notes.map((note) => [note.id, note]))
  const included = (note: BackupNoteSource | undefined): note is BackupNoteSource => (
    note !== undefined && !note.isTimeless && !note.isGenerated && !isTrashed(note.tags)
  )

  const chaptersOf = new Map<string, BackupChapterSource[]>()
  const isChapter = new Set<string>()
  for (const chapter of input.chapters) {
    // A generated chapter is never written, but it is still a chapter: it
    // must not turn up as a note of its own.
    isChapter.add(chapter.chapterNoteId)
    if (!included(byId.get(chapter.parentNoteId)) || !included(byId.get(chapter.chapterNoteId))) continue
    const list = chaptersOf.get(chapter.parentNoteId) ?? []
    list.push(chapter)
    chaptersOf.set(chapter.parentNoteId, list)
  }

  // Names already taken per folder, compared case-insensitively because
  // Windows and macOS file systems are. Only a sanitized id can collide; the
  // manifest records the real one, so the `(2)` is cosmetic.
  const taken = new Map<string, Set<string>>()
  const claim = (folder: string[], base: string, extension: string): string => {
    const key = folder.join('/')
    const used = taken.get(key) ?? new Set<string>()
    taken.set(key, used)
    let candidate = `${base}${extension}`
    for (let n = 2; used.has(candidate.toLowerCase()); n += 1) candidate = `${base} (${n})${extension}`
    used.add(candidate.toLowerCase())
    return candidate
  }
  const tagFolder = (tags: readonly string[]) => {
    const { primary, secondary } = hierarchyFromTags(tags)
    return [safeName(primary, 'Tag'), safeName(secondary, 'Tag')]
  }

  const noteFiles: BackupPlan['noteFiles'] = []
  const manifestNotes: ManifestNote[] = []
  const sortKey = (note: BackupNoteSource) => note.assignedId ?? `~${note.id}`
  const roots = input.notes.filter((note) => included(note) && !isChapter.has(note.id))
    .sort((a, b) => sortKey(a).localeCompare(sortKey(b), undefined, { numeric: true, sensitivity: 'base' }))
  for (const note of roots) {
    const folder = [
      NOTES_FOLDER,
      ...(note.tags.includes('archived') ? [ARCHIVE_FOLDER] : []),
      ...tagFolder(note.tags),
    ]
    // A note with no id (none was ever given) is named by its row id; the
    // manifest says it has none, so reading it back gives it a fresh one.
    const name = safeName(note.assignedId ? formatIdWithSigil(note.assignedId, '$') : `_${note.id}`, 'Note')
    const family = [...(chaptersOf.get(note.id) ?? [])].sort((a, b) => a.position - b.position)
    const noteFolder = family.length > 0 ? [...folder, claim(folder, name, '')] : folder
    const file = [...noteFolder, claim(noteFolder, name, '.md')].join('/')
    noteFiles.push({ noteId: note.id, file })
    const chapters: ManifestChapter[] = family.map((chapter, index) => {
      const chapterNote = byId.get(chapter.chapterNoteId)!
      const chapterFile = [...noteFolder, claim(noteFolder, safeName(formatIdWithSigil(chapter.chapterId ?? `§${index + 1}`, '§'), 'Chapter'), '.md')].join('/')
      noteFiles.push({ noteId: chapterNote.id, file: chapterFile })
      return {
        chapterId: chapter.chapterId,
        file: chapterFile,
        tags: [...chapterNote.tags],
        createdAt: iso(chapterNote.createdAtMs),
        updatedAt: iso(chapterNote.updatedAtMs),
      }
    })
    manifestNotes.push({
      id: note.assignedId,
      file,
      tags: [...note.tags],
      createdAt: iso(note.createdAtMs),
      updatedAt: iso(note.updatedAtMs),
      chapters,
    })
  }

  const imageFiles: BackupPlan['imageFiles'] = []
  const manifestImages: ManifestImage[] = []
  const images = input.images.filter((image) => !isTrashed(image.tags) || input.usedImageIds.has(image.id))
    .sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true, sensitivity: 'base' }))
  for (const image of images) {
    const folder = [IMAGES_FOLDER, ...tagFolder(image.tags)]
    const file = [...folder, claim(folder, safeName(image.id, 'Image'), `.${imageExtensionFor(image.mime)}`)].join('/')
    imageFiles.push({ imageId: image.id, file })
    manifestImages.push({
      id: image.id,
      file,
      tags: [...image.tags],
      origin: image.origin,
      createdAt: image.createdAt,
      aliases: [...image.aliases],
    })
  }

  return {
    manifest: { format: BACKUP_FORMAT, version: BACKUP_VERSION, exportedAt: input.exportedAt, notes: manifestNotes, images: manifestImages },
    noteFiles,
    imageFiles,
  }
}

// ── Paths ───────────────────────────────────────────────────────────────

const dirOf = (file: string) => file.split('/').slice(0, -1)

/** A path segment as a Markdown link destination may hold it: percent-encoded, parentheses included. */
function encodeSegment(segment: string): string {
  return encodeURIComponent(segment).replace(/[()]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
}

/** `target` relative to the folder holding `fromFile`, both backup paths, encoded for a link. */
export function relativeLink(fromFile: string, target: string): string {
  const from = dirOf(fromFile)
  const to = target.split('/')
  let common = 0
  while (common < from.length && common < to.length - 1 && from[common] === to[common]) common += 1
  return [...from.slice(common).map(() => '..'), ...to.slice(common).map(encodeSegment)].join('/')
}

/** The backup path a link destination in `fromFile` points at, or null when it leaves the backup or is not a path. */
export function resolveLink(fromFile: string, destination: string): string | null {
  if (/^[a-z][a-z0-9+.-]*:/i.test(destination) || destination.startsWith('/')) return null
  const parts = dirOf(fromFile)
  for (const raw of destination.split('/')) {
    let segment = raw
    try {
      segment = decodeURIComponent(raw)
    } catch {
      // A malformed escape is taken as written.
    }
    if (segment === '' || segment === '.') continue
    if (segment === '..') {
      if (parts.length === 0) return null
      parts.pop()
    } else {
      parts.push(segment)
    }
  }
  return parts.join('/')
}

function applyEdits(text: string, edits: ReadonlyArray<{ from: number; to: number; insert: string }>): string {
  if (edits.length === 0) return text
  const sorted = [...edits].sort((a, b) => a.from - b.from)
  let next = ''
  let at = 0
  for (const edit of sorted) {
    next += text.slice(at, edit.from) + edit.insert
    at = edit.to
  }
  return next + text.slice(at)
}

/** A note's text as the backup writes it: every stored image it uses pointed at the image's file. */
export function exportNoteText(text: string, noteFile: string, imageFileById: ReadonlyMap<string, string>): string {
  return applyEdits(text, imageReferenceEditsBy(text, (id) => {
    const target = imageFileById.get(id)
    return target ? relativeLink(noteFile, target) : null
  }))
}

// An image destination that is a path rather than an id: what exportNoteText wrote.
const IMAGE_PATH_DESTINATION = /(!\[[^\]\n]*\]\([ \t]*<?)([^\s<>()&][^\s<>()]*)/g

/** The inverse of exportNoteText: every image path that names a file of the backup turned back into that image's id. */
export function importNoteText(text: string, noteFile: string, imageIdByFile: ReadonlyMap<string, string>): string {
  if (!text.includes('](')) return text
  const scanned = withoutCodeSpans(text)
  const edits: Array<{ from: number; to: number; insert: string }> = []
  IMAGE_PATH_DESTINATION.lastIndex = 0
  for (let match = IMAGE_PATH_DESTINATION.exec(scanned); match; match = IMAGE_PATH_DESTINATION.exec(scanned)) {
    const target = resolveLink(noteFile, match[2])
    const id = target === null ? undefined : imageIdByFile.get(target)
    if (!id) continue
    const at = match.index + match[1].length
    edits.push({ from: at, to: at + match[2].length, insert: id })
  }
  return applyEdits(text, edits)
}

// ── References to renamed ids ───────────────────────────────────────────

// A note link's destination: `](` then `$`, and the note part up to the
// chapter sign, the anchor or the end of the destination.
const NOTE_LINK = /(\]\([ \t]*<?)\$([^#§\s)>]*)/g

/**
 * The edits that rewrite every reference to a renamed note or image in
 * `text`, both found in ONE pass over the original text, so renames that
 * chain (`A` to `A-OLD` while another `B` becomes `A`) cannot apply twice.
 * Keys are normalized ids (`$12`, `FOO`, `&LOGO`).
 */
export function referenceRenameEdits(
  text: string,
  noteRenames: ReadonlyMap<string, string>,
  imageRenames: ReadonlyMap<string, string>,
): Array<{ from: number; to: number; insert: string }> {
  const edits = imageRenames.size > 0 ? imageReferenceEditsBy(text, (id) => imageRenames.get(id) ?? null) : []
  if (noteRenames.size > 0 && text.includes('$')) {
    const scanned = withoutCodeSpans(text)
    NOTE_LINK.lastIndex = 0
    for (let match = NOTE_LINK.exec(scanned); match; match = NOTE_LINK.exec(scanned)) {
      if (match[2].length === 0) continue
      const to = noteRenames.get(resolveLinkedNoteId(match[2]).toUpperCase())
      if (!to) continue
      const at = match.index + match[1].length
      edits.push({ from: at, to: at + 1 + match[2].length, insert: formatIdWithSigil(to, '$') })
    }
  }
  return edits.sort((a, b) => a.from - b.from)
}

export function renameReferences(text: string, noteRenames: ReadonlyMap<string, string>, imageRenames: ReadonlyMap<string, string>): string {
  return applyEdits(text, referenceRenameEdits(text, noteRenames, imageRenames))
}

// ── Id conflicts ────────────────────────────────────────────────────────

export type ImportConflictMode = 'rename-incoming' | 'rename-existing'

export interface IdNamespace {
  isAuto: (id: string) => boolean
  nextAuto: (taken: ReadonlySet<string>) => string
}

export const NOTE_IDS: IdNamespace = {
  isAuto: (id) => isAutoAssignedId(id),
  nextAuto: (taken) => buildNextAutoAssignedId(taken),
}

export const IMAGE_IDS: IdNamespace = {
  isAuto: (id) => /^&\d+$/.test(id),
  nextAuto: (taken) => buildNextAutoImageId(taken),
}

export interface ImportIdResolution {
  /** Per incoming key: the id it is stored under, and whether it is skipped as identical to the item already there. */
  incoming: Map<string, { id: string; skip: boolean }>
  /** Renames to the incoming items' own references (an id the backup holds once and that changed). */
  incomingRenames: Map<string, string>
  /** Renames to existing items (rename-existing), for them and every reference to them. */
  existingRenames: Map<string, string>
}

/**
 * Settles the id every incoming item is stored under. `incoming` is in the
 * backup's order with normalized ids; `existing` holds the ids in use;
 * `isIdentical(key, id)` says whether the item already under `id` is the same
 * as incoming `key` (same bytes, same text).
 */
export function resolveImportIds(input: {
  incoming: ReadonlyArray<{ key: string; id: string }>
  existing: ReadonlySet<string>
  mode: ImportConflictMode
  namespace: IdNamespace
  isIdentical: (key: string, id: string) => boolean
}): ImportIdResolution {
  const { namespace } = input
  const taken = new Set<string>(input.existing)
  const counts = new Map<string, number>()
  for (const item of input.incoming) {
    taken.add(item.id)
    counts.set(item.id, (counts.get(item.id) ?? 0) + 1)
  }
  const fresh = (id: string, word: string): string => {
    let candidate = namespace.isAuto(id) ? namespace.nextAuto(taken) : `${id}-${word}`
    for (let n = 2; taken.has(candidate); n += 1) candidate = `${id}-${word}-${n}`
    taken.add(candidate)
    return candidate
  }

  const result: ImportIdResolution = { incoming: new Map(), incomingRenames: new Map(), existingRenames: new Map() }
  const seen = new Map<string, number>()
  const numbered = new Set<string>()
  for (const item of input.incoming) {
    let id = item.id
    const count = counts.get(id) ?? 1
    if (count > 1) {
      // Held twice by the backup itself: every holder is numbered, and a link
      // to the bare id stays as written, since nothing says which was meant.
      if (namespace.isAuto(id)) {
        id = namespace.nextAuto(taken)
      } else {
        let n = (seen.get(item.id) ?? 0) + 1
        while (counts.has(`${item.id}-${n}`) || numbered.has(`${item.id}-${n}`)) n += 1
        seen.set(item.id, n)
        id = `${item.id}-${n}`
      }
      numbered.add(id)
      taken.add(id)
    }
    if (input.existing.has(id)) {
      if (input.isIdentical(item.key, id)) {
        result.incoming.set(item.key, { id, skip: true })
        continue
      }
      if (input.mode === 'rename-incoming') {
        id = fresh(id, 'NEW')
      } else {
        result.existingRenames.set(id, fresh(id, 'OLD'))
      }
    }
    result.incoming.set(item.key, { id, skip: false })
    if (count === 1 && id !== item.id) result.incomingRenames.set(item.id, id)
  }
  return result
}

// ── Manifest ────────────────────────────────────────────────────────────

const isString = (value: unknown): value is string => typeof value === 'string'
const strings = (value: unknown): string[] => (Array.isArray(value) ? value.filter(isString) : [])
const isoOr = (value: unknown, fallback: string) => (isString(value) && Number.isFinite(Date.parse(value)) ? value : fallback)

/** A manifest read from disk, checked field by field; null when it is not one this build reads. */
export function parseBackupManifest(raw: unknown, now: string): BackupManifest | null {
  if (!raw || typeof raw !== 'object') return null
  const value = raw as Record<string, unknown>
  if (value.format !== BACKUP_FORMAT || typeof value.version !== 'number' || value.version > BACKUP_VERSION) return null
  const record = (entry: unknown) => (entry && typeof entry === 'object' ? entry as Record<string, unknown> : null)
  const notes: ManifestNote[] = []
  for (const entry of Array.isArray(value.notes) ? value.notes : []) {
    const note = record(entry)
    if (!note || !isString(note.file)) continue
    const createdAt = isoOr(note.createdAt, now)
    notes.push({
      id: isString(note.id) && note.id.trim() ? note.id.trim().toUpperCase() : null,
      file: note.file,
      tags: strings(note.tags),
      createdAt,
      updatedAt: isoOr(note.updatedAt, createdAt),
      chapters: (Array.isArray(note.chapters) ? note.chapters : []).flatMap((item) => {
        const chapter = record(item)
        if (!chapter || !isString(chapter.file)) return []
        const chapterCreatedAt = isoOr(chapter.createdAt, now)
        return [{
          chapterId: isString(chapter.chapterId) && chapter.chapterId.trim() ? chapter.chapterId.trim() : null,
          file: chapter.file,
          tags: strings(chapter.tags),
          createdAt: chapterCreatedAt,
          updatedAt: isoOr(chapter.updatedAt, chapterCreatedAt),
        }]
      }),
    })
  }
  const images: ManifestImage[] = []
  for (const entry of Array.isArray(value.images) ? value.images : []) {
    const image = record(entry)
    const id = image && isString(image.id) ? normalizeImageId(image.id) : null
    if (!image || !id || !isString(image.file)) continue
    images.push({
      id,
      file: image.file,
      tags: strings(image.tags),
      origin: isString(image.origin) ? image.origin : null,
      createdAt: isoOr(image.createdAt, now),
      aliases: strings(image.aliases).map((alias) => normalizeImageId(alias)).filter((alias): alias is string => alias !== null),
    })
  }
  return { format: BACKUP_FORMAT, version: value.version, exportedAt: isoOr(value.exportedAt, now), notes, images }
}

/** The stored images `text` uses: what keeps a trashed image in the backup. */
export const usedImagesIn = imageReferencesIn
