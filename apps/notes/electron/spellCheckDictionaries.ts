// verify: reads-temp (scripts/verify.mjs, "what a module reads from disk")
/*
 * The spell checker's dictionaries on disk (src/shared/spellCheck.ts).
 *
 * BUNDLED dictionaries are the `dictionary-<id>` packages, dependencies of
 * this app, read from wherever module resolution finds them (the repository's
 * node_modules in development, the app archive's in a packaged build). Their
 * files are `index.aff` and `index.dic` beside the package's entry point.
 *
 * The reader's own (CUSTOM) dictionaries are folders in
 * `<data root>/dictionaries/<id>/` (the data root, so a portable build keeps
 * them with its notes): an installed one holds a copy of its `index.aff` and
 * `index.dic`, so it keeps working when the original is moved or deleted; one
 * created blank holds nothing. The id is made up and unique; it is never read
 * for meaning. The USER dictionary (`user`) has no folder at all.
 *
 * Beside those, three things every dictionary may have, kept apart from its
 * files so restoring a bundled one is deleting them:
 * - its name, in `names.json` (a default otherwise: `BUNDLED_DICTIONARIES`, or
 *   from the file it came from, `dictionaryLabelFor`);
 * - its icon, in `icons.json`;
 * - the reader's EDITS, in `words/<id>.json`: the words added and the words
 *   removed, which the worker applies on top of the pair as Hunspell's
 *   run-time additions and removals. A dictionary without a pair records no
 *   removals: taking out a word it only has because it was added is enough.
 *
 * A reader comes home with one of three things, and all three install the
 * same way: a `.dic` and `.aff` pair (picked together, or the `.dic` alone with
 * its `.aff` beside it), or an archive holding pairs (`.oxt` from
 * LibreOffice, `.xpi` from Firefox, `.zip` of a folder of them).
 */
import { promises as fs } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { unzipSync } from 'fflate'
import { firstFreePresetName, PRESET_ICON_PATTERN } from '@thockdown/interaction/presetList'
import {
  BUNDLED_DICTIONARIES, dictionaryLabelFor, stemsOfDic, USER_DICTIONARY_ID, USER_DICTIONARY_LABEL,
  type SpellCheckDictionary, type SpellCheckDictionaryFiles,
} from '../src/shared/spellCheck'
import { writeFileDurably } from './durableWrite'

const requireFromHere = createRequire(import.meta.url)

const ARCHIVE_EXTENSIONS = new Set(['.oxt', '.xpi', '.zip'])
export const DICTIONARY_FILE_EXTENSIONS = ['dic', 'aff', 'oxt', 'xpi', 'zip']
const NAMES_FILE = 'names.json'
const ICONS_FILE = 'icons.json'
const WORDS_FOLDER = 'words'
const MAX_WORD_LENGTH = 100
/** Names a dictionary folder can never have: the user dictionary's id and the files beside the folders. */
const RESERVED_IDS = new Set([USER_DICTIONARY_ID, WORDS_FOLDER, NAMES_FILE, ICONS_FILE])
const MAX_LABEL_LENGTH = 64

/** An id usable as a folder name: letters, digits, `_`, `-`, `.`; never empty, never a path. */
export function installedDictionaryId(name: string): string | null {
  const base = name.replace(/[^\p{L}\p{N}_.-]/gu, '_').replace(/^\.+/, '')
  return base.length > 0 && base.length <= 64 ? base : null
}

/** A file's name without extension, or its folder's when the file is called `index`. */
export function dictionaryStem(filePath: string): string {
  const name = path.basename(filePath, path.extname(filePath))
  return name.toLowerCase() === 'index' ? path.basename(path.dirname(filePath)) : name
}

type Pair = { stem: string; aff: Uint8Array; dic: Uint8Array }

/** Every `.dic` with an `.aff` of the same path in an archive. One pair is named after the archive. */
export function pairsInArchive(archivePath: string, data: Uint8Array): Pair[] {
  const files = unzipSync(data, { filter: (file) => /\.(dic|aff)$/i.test(file.name) })
  const pairs: Pair[] = []
  for (const [name, dic] of Object.entries(files)) {
    if (!/\.dic$/i.test(name)) continue
    const base = name.slice(0, -4)
    const aff = files[`${base}.aff`] ?? files[`${base}.AFF`]
    if (aff) pairs.push({ stem: dictionaryStem(name), aff, dic })
  }
  if (pairs.length === 1) pairs[0].stem = path.basename(archivePath, path.extname(archivePath))
  return pairs
}

function bundledFolder(id: string): string | null {
  if (!isBundled(id)) return null
  try {
    return path.dirname(requireFromHere.resolve(`dictionary-${id}`))
  } catch {
    return null
  }
}

const isBundled = (id: string) => BUNDLED_DICTIONARIES.some((entry) => entry.id === id)

type Edits = { added: string[]; removed: string[] }

/** The words of an edit request that can be words: strings without white space, at most `MAX_WORD_LENGTH` long. */
function cleanWords(words: unknown): string[] {
  if (!Array.isArray(words)) return []
  return [...new Set(words.filter((word): word is string => typeof word === 'string' && word.length > 0
    && word.length <= MAX_WORD_LENGTH && !/\s/u.test(word)))]
}

async function readJson(file: string): Promise<unknown> {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'))
  } catch {
    return null
  }
}

function stringRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object') return {}
  return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === 'string'))
}

export class SpellCheckDictionaries {
  /**
   * Every change is a read-modify-write of a small JSON file, so changes are
   * run one at a time: two quick edits must not both read the file before
   * either has written it.
   */
  private chain: Promise<unknown> = Promise.resolve()

  constructor(private readonly installedRoot: string) {}

  private serialized<T>(task: () => Promise<T>): Promise<T> {
    const next = this.chain.then(task, task)
    this.chain = next.catch(() => {})
    return next
  }

  private customFolder(id: string): string | null {
    if (isBundled(id) || RESERVED_IDS.has(id) || installedDictionaryId(id) !== id) return null
    return path.join(this.installedRoot, id)
  }

  private async kindOf(id: string): Promise<SpellCheckDictionary['kind'] | null> {
    if (id === USER_DICTIONARY_ID) return 'user'
    if (isBundled(id)) return 'bundled'
    const folder = this.customFolder(id)
    if (!folder) return null
    const stat = await fs.stat(folder).catch(() => null)
    return stat?.isDirectory() ? 'custom' : null
  }

  private async writeJson(file: string, value: unknown): Promise<void> {
    await fs.mkdir(path.dirname(file), { recursive: true })
    await writeFileDurably(file, JSON.stringify(value, null, 2))
  }

  private readNames = async () => stringRecord(await readJson(path.join(this.installedRoot, NAMES_FILE)))
  private writeNames = (names: Record<string, string>) => this.writeJson(path.join(this.installedRoot, NAMES_FILE), names)
  private readIcons = async () => stringRecord(await readJson(path.join(this.installedRoot, ICONS_FILE)))
  private writeIcons = (icons: Record<string, string>) => this.writeJson(path.join(this.installedRoot, ICONS_FILE), icons)
  private editsFile = (id: string) => path.join(this.installedRoot, WORDS_FOLDER, `${id}.json`)

  private async readEdits(id: string): Promise<Edits> {
    const value = await readJson(this.editsFile(id)) as Partial<Edits> | null
    return { added: cleanWords(value?.added), removed: cleanWords(value?.removed) }
  }

  private async writeEdits(id: string, edits: Edits): Promise<void> {
    if (edits.added.length === 0 && edits.removed.length === 0) {
      await fs.rm(this.editsFile(id), { force: true })
      return
    }
    await this.writeJson(this.editsFile(id), edits)
  }

  /** The folder holding a dictionary's Hunspell pair, or null when it has none (the user dictionary, a blank one). */
  private async pairFolder(id: string): Promise<string | null> {
    const folder = bundledFolder(id) ?? this.customFolder(id)
    if (!folder) return null
    const stat = await fs.stat(path.join(folder, 'index.dic')).catch(() => null)
    return stat?.isFile() ? folder : null
  }

  async list(): Promise<SpellCheckDictionary[]> {
    const [names, icons] = await Promise.all([this.readNames(), this.readIcons()])
    const entry = (id: string, label: string, kind: SpellCheckDictionary['kind']): SpellCheckDictionary => (
      { id, label: names[id] ?? label, icon: icons[id] ?? null, kind }
    )
    const custom: SpellCheckDictionary[] = []
    const folders = await fs.readdir(this.installedRoot, { withFileTypes: true }).catch(() => [])
    for (const folder of folders) {
      if (!folder.isDirectory() || !this.customFolder(folder.name)) continue
      custom.push(entry(folder.name, dictionaryLabelFor(folder.name), 'custom'))
    }
    custom.sort((a, b) => a.label.localeCompare(b.label))
    return [
      entry(USER_DICTIONARY_ID, USER_DICTIONARY_LABEL, 'user'),
      ...BUNDLED_DICTIONARIES.map((bundled) => entry(bundled.id, bundled.label, 'bundled')),
      ...custom,
    ]
  }

  async read(id: string): Promise<SpellCheckDictionaryFiles | null> {
    if (!await this.kindOf(id)) return null
    const folder = await this.pairFolder(id)
    const edits = await this.readEdits(id)
    if (!folder) return { aff: null, dic: null, added: edits.added, removed: [] }
    try {
      const [aff, dic] = await Promise.all([
        fs.readFile(path.join(folder, 'index.aff')),
        fs.readFile(path.join(folder, 'index.dic')),
      ])
      return { aff: new Uint8Array(aff), dic: new Uint8Array(dic), ...edits }
    } catch {
      return null
    }
  }

  async listWords(id: string): Promise<string[]> {
    const files = await this.read(id)
    if (!files) return []
    const removed = new Set(files.removed)
    const words = new Set(files.dic ? stemsOfDic(new TextDecoder().decode(files.dic)).filter((word) => !removed.has(word)) : [])
    for (const word of files.added) words.add(word)
    return [...words]
  }

  addWords(id: string, words: unknown): Promise<boolean> {
    return this.serialized(async () => {
      const wanted = cleanWords(words)
      if (wanted.length === 0 || !await this.kindOf(id)) return false
      const edits = await this.readEdits(id)
      const adding = new Set(wanted)
      await this.writeEdits(id, {
        added: [...new Set([...edits.added, ...wanted])],
        removed: edits.removed.filter((word) => !adding.has(word)),
      })
      return true
    })
  }

  removeWords(id: string, words: unknown): Promise<boolean> {
    return this.serialized(async () => {
      const unwanted = cleanWords(words)
      if (unwanted.length === 0 || !await this.kindOf(id)) return false
      const edits = await this.readEdits(id)
      const removing = new Set(unwanted)
      const hasPair = await this.pairFolder(id) !== null
      await this.writeEdits(id, {
        added: edits.added.filter((word) => !removing.has(word)),
        removed: hasPair ? [...new Set([...edits.removed, ...unwanted])] : [],
      })
      return true
    })
  }

  /** A free folder id from `stem`: the stem itself, else `<stem>-2`, `<stem>-3`, ... */
  private async freeId(stem: string, taken: Set<string>): Promise<string> {
    const base = installedDictionaryId(stem.toLowerCase()) ?? 'dictionary'
    let id = base
    for (let suffix = 2; taken.has(id) || RESERVED_IDS.has(id) || isBundled(id); suffix += 1) id = `${base}-${suffix}`
    taken.add(id)
    return id
  }

  private async takenIds(): Promise<Set<string>> {
    return new Set((await fs.readdir(this.installedRoot).catch(() => [] as string[])).map((name) => name.toLowerCase()))
  }

  create(): Promise<SpellCheckDictionary | null> {
    return this.serialized(async () => {
      const id = await this.freeId('dictionary', await this.takenIds())
      await fs.mkdir(path.join(this.installedRoot, id), { recursive: true })
      const names = await this.readNames()
      const labels = (await this.list()).map((entry) => entry.label)
      const label = firstFreePresetName('Dictionary', labels)
      names[id] = label
      await this.writeNames(names)
      return { id, label, icon: null, kind: 'custom' as const }
    })
  }

  /** The pairs in what the reader picked; a file that is not part of one is passed over. */
  private async pairsIn(filePaths: readonly string[]): Promise<Pair[]> {
    const pairs: Pair[] = []
    const seen = new Set<string>()
    for (const filePath of filePaths) {
      const extension = path.extname(filePath).toLowerCase()
      try {
        if (ARCHIVE_EXTENSIONS.has(extension)) {
          pairs.push(...pairsInArchive(filePath, new Uint8Array(await fs.readFile(filePath))))
          continue
        }
        if (extension !== '.dic' && extension !== '.aff') continue
        const base = filePath.slice(0, -extension.length)
        if (seen.has(base)) continue
        seen.add(base)
        // The other half: picked with it under any case of extension, or beside it on disk.
        const sibling = async (wanted: string) => {
          const picked = filePaths.find((other) => other.slice(0, -4) === base && other.slice(-4).toLowerCase() === wanted)
          return fs.readFile(picked ?? `${base}${wanted}`)
        }
        const [aff, dic] = await Promise.all([sibling('.aff'), sibling('.dic')])
        pairs.push({ stem: dictionaryStem(filePath), aff: new Uint8Array(aff), dic: new Uint8Array(dic) })
      } catch {
        // Unreadable, not an archive, or missing its other half.
      }
    }
    return pairs
  }

  /** Copies in every pair found in `filePaths`, each under a new id. */
  install(filePaths: readonly string[]): Promise<SpellCheckDictionary[]> {
    return this.serialized(async () => {
      const pairs = await this.pairsIn(filePaths)
      if (pairs.length === 0) return []
      const names = await this.readNames()
      const taken = await this.takenIds()
      const installed: SpellCheckDictionary[] = []
      for (const pair of pairs) {
        const id = await this.freeId(pair.stem, taken)
        const folder = path.join(this.installedRoot, id)
        await fs.mkdir(folder, { recursive: true })
        await fs.writeFile(path.join(folder, 'index.aff'), pair.aff)
        await fs.writeFile(path.join(folder, 'index.dic'), pair.dic)
        const label = dictionaryLabelFor(pair.stem).slice(0, MAX_LABEL_LENGTH) || id.toUpperCase()
        names[id] = label
        installed.push({ id, label, icon: null, kind: 'custom' })
      }
      await this.writeNames(names)
      return installed
    })
  }

  rename(id: string, label: string): Promise<boolean> {
    return this.serialized(async () => {
      const trimmed = typeof label === 'string' ? label.trim().slice(0, MAX_LABEL_LENGTH) : ''
      if (!trimmed || !await this.kindOf(id)) return false
      const names = await this.readNames()
      names[id] = trimmed
      await this.writeNames(names)
      return true
    })
  }

  setIcon(id: string, icon: string | null): Promise<boolean> {
    return this.serialized(async () => {
      if (!await this.kindOf(id) || (icon !== null && !PRESET_ICON_PATTERN.test(icon))) return false
      const icons = await this.readIcons()
      if (icon === null) delete icons[id]
      else icons[id] = icon
      await this.writeIcons(icons)
      return true
    })
  }

  /** Empties the user dictionary, restores a bundled one as shipped, deletes a custom one. */
  reset(id: string): Promise<boolean> {
    return this.serialized(async () => {
      const kind = await this.kindOf(id)
      if (!kind) return false
      await fs.rm(this.editsFile(id), { force: true })
      if (kind === 'user') return true
      const [names, icons] = await Promise.all([this.readNames(), this.readIcons()])
      if (id in names) { delete names[id]; await this.writeNames(names) }
      if (id in icons) { delete icons[id]; await this.writeIcons(icons) }
      if (kind === 'custom') await fs.rm(path.join(this.installedRoot, id), { recursive: true, force: true })
      return true
    })
  }
}
