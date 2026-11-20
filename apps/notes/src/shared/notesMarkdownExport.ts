import { hierarchyFromTags } from './tagHierarchy'

/**
 * Where each note goes when every note is exported as plain Markdown
 * (Options > Advanced > Data > Export). The folders are the Category view's
 * tree: a note's primary tag, then its secondary (`hierarchyFromTags`, the
 * one rule both read). A note with chapters becomes a folder of its own
 * holding the note first and its chapters after it, numbered in the chapter
 * bar's order, so the files sort the way the note reads. Archived notes get
 * the same tree under `Archive`.
 *
 * Left out: trashed notes, the User Guide (timeless notes), and the
 * generated chapters (contents and open items), which the app rebuilds from
 * the others and which are not anybody's writing.
 *
 * Pure, so the layout is tested without a database or a disk.
 */

export interface ExportableNote {
  id: string
  title: string
  tags: readonly string[]
  isTimeless: boolean
  isGenerated: boolean
}

export interface ExportChapter {
  parentNoteId: string
  chapterNoteId: string
  position: number
}

export interface PlannedFile {
  noteId: string
  /** Path segments under the export folder, the last one the file name. */
  segments: string[]
}

export const ARCHIVE_FOLDER = 'Archive'

const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i
const MAX_NAME_LENGTH = 100

/** A title or tag made safe as one file or folder name on every platform. */
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

function padTo(width: number, value: number): string {
  return String(value).padStart(width, '0')
}

export function planMarkdownExport(notes: readonly ExportableNote[], chapters: readonly ExportChapter[]): PlannedFile[] {
  const byId = new Map(notes.map((note) => [note.id, note]))
  const included = (note: ExportableNote | undefined): note is ExportableNote => (
    note !== undefined && !note.isTimeless && !note.isGenerated && !note.tags.includes('deleted')
  )

  const chaptersOf = new Map<string, ExportChapter[]>()
  const isChapter = new Set<string>()
  for (const chapter of chapters) {
    if (!included(byId.get(chapter.parentNoteId)) || !included(byId.get(chapter.chapterNoteId))) continue
    const list = chaptersOf.get(chapter.parentNoteId) ?? []
    list.push(chapter)
    chaptersOf.set(chapter.parentNoteId, list)
    isChapter.add(chapter.chapterNoteId)
  }

  // Names already taken per folder, compared case-insensitively because
  // Windows and macOS file systems are.
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

  const files: PlannedFile[] = []
  const sorted = notes.filter(included).sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }))
  for (const note of sorted) {
    if (isChapter.has(note.id)) continue
    const { primary, secondary } = hierarchyFromTags(note.tags)
    const folder = [
      ...(note.tags.includes('archived') ? [ARCHIVE_FOLDER] : []),
      safeName(primary, 'Tag'),
      safeName(secondary, 'Tag'),
    ]
    const title = safeName(note.title, 'Untitled')
    const family = (chaptersOf.get(note.id) ?? []).sort((a, b) => a.position - b.position)
    if (family.length === 0) {
      files.push({ noteId: note.id, segments: [...folder, claim(folder, title, '.md')] })
      continue
    }
    const familyFolder = [...folder, claim(folder, title, '')]
    const width = Math.max(2, String(family.length).length)
    files.push({ noteId: note.id, segments: [...familyFolder, claim(familyFolder, `${padTo(width, 0)} ${title}`, '.md')] })
    family.forEach((chapter, index) => {
      const chapterTitle = safeName(byId.get(chapter.chapterNoteId)!.title, 'Untitled')
      files.push({
        noteId: chapter.chapterNoteId,
        segments: [...familyFolder, claim(familyFolder, `${padTo(width, index + 1)} ${chapterTitle}`, '.md')],
      })
    })
  }
  return files
}
