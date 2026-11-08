// verify: reads-temp (scripts/verify.mjs, "what a module reads from disk")
/*
 * The spell checker's dictionaries on disk (src/shared/spellCheck.ts).
 *
 * BUNDLED dictionaries are the `dictionary-<id>` packages, dependencies of
 * this app, read from wherever module resolution finds them (the repository's
 * node_modules in development, the app archive's in a packaged build). Their
 * files are `index.aff` and `index.dic` beside the package's entry point.
 *
 * INSTALLED dictionaries are copies in `<data root>/dictionaries/<id>/` (the
 * data root, so a portable build keeps them with its notes). Installing
 * copies rather than referring to the reader's file, so a dictionary keeps
 * working when the original is moved or deleted. The id is made up at
 * install time and unique; it is never read for meaning. What a dictionary is
 * CALLED is its label, kept for every dictionary (bundled ones included) in
 * `<data root>/dictionaries/names.json`, and set by default from the file it
 * came from (`dictionaryLabelFor`).
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
import { BUNDLED_DICTIONARIES, dictionaryLabelFor, type SpellCheckDictionary, type SpellCheckDictionaryFiles } from '../src/shared/spellCheck'
import { writeFileDurably } from './durableWrite'

const requireFromHere = createRequire(import.meta.url)

const ARCHIVE_EXTENSIONS = new Set(['.oxt', '.xpi', '.zip'])
export const DICTIONARY_FILE_EXTENSIONS = ['dic', 'aff', 'oxt', 'xpi', 'zip']
const NAMES_FILE = 'names.json'
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
  if (!BUNDLED_DICTIONARIES.some((entry) => entry.id === id)) return null
  try {
    return path.dirname(requireFromHere.resolve(`dictionary-${id}`))
  } catch {
    return null
  }
}

const isBundled = (id: string) => BUNDLED_DICTIONARIES.some((entry) => entry.id === id)

export class SpellCheckDictionaries {
  constructor(private readonly installedRoot: string) {}

  private installedFolder(id: string): string | null {
    if (isBundled(id) || installedDictionaryId(id) !== id) return null
    return path.join(this.installedRoot, id)
  }

  private async readNames(): Promise<Record<string, string>> {
    try {
      const parsed: unknown = JSON.parse(await fs.readFile(path.join(this.installedRoot, NAMES_FILE), 'utf8'))
      if (!parsed || typeof parsed !== 'object') return {}
      return Object.fromEntries(Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === 'string'))
    } catch {
      return {}
    }
  }

  private async writeNames(names: Record<string, string>): Promise<void> {
    await fs.mkdir(this.installedRoot, { recursive: true })
    await writeFileDurably(path.join(this.installedRoot, NAMES_FILE), JSON.stringify(names, null, 2))
  }

  async list(): Promise<SpellCheckDictionary[]> {
    const names = await this.readNames()
    const bundled = BUNDLED_DICTIONARIES.map((entry) => ({ ...entry, label: names[entry.id] ?? entry.label }))
    const installed: SpellCheckDictionary[] = []
    const entries = await fs.readdir(this.installedRoot, { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      if (!entry.isDirectory() || !this.installedFolder(entry.name)) continue
      installed.push({ id: entry.name, label: names[entry.name] ?? dictionaryLabelFor(entry.name), bundled: false })
    }
    installed.sort((a, b) => a.label.localeCompare(b.label))
    return [...bundled, ...installed]
  }

  async read(id: string): Promise<SpellCheckDictionaryFiles | null> {
    const folder = bundledFolder(id) ?? this.installedFolder(id)
    if (!folder) return null
    try {
      const [aff, dic] = await Promise.all([
        fs.readFile(path.join(folder, 'index.aff')),
        fs.readFile(path.join(folder, 'index.dic')),
      ])
      return { aff: new Uint8Array(aff), dic: new Uint8Array(dic) }
    } catch {
      return null
    }
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
  async install(filePaths: readonly string[]): Promise<SpellCheckDictionary[]> {
    const pairs = await this.pairsIn(filePaths)
    if (pairs.length === 0) return []
    const names = await this.readNames()
    const taken = new Set((await fs.readdir(this.installedRoot).catch(() => [] as string[])).map((name) => name.toLowerCase()))
    for (const entry of BUNDLED_DICTIONARIES) taken.add(entry.id)
    const installed: SpellCheckDictionary[] = []
    for (const pair of pairs) {
      const base = installedDictionaryId(pair.stem.toLowerCase()) ?? 'dictionary'
      let id = base
      for (let suffix = 2; taken.has(id) || id === NAMES_FILE; suffix += 1) id = `${base}-${suffix}`
      taken.add(id)
      const folder = path.join(this.installedRoot, id)
      await fs.mkdir(folder, { recursive: true })
      await fs.writeFile(path.join(folder, 'index.aff'), pair.aff)
      await fs.writeFile(path.join(folder, 'index.dic'), pair.dic)
      const label = dictionaryLabelFor(pair.stem).slice(0, MAX_LABEL_LENGTH) || id.toUpperCase()
      names[id] = label
      installed.push({ id, label, bundled: false })
    }
    await this.writeNames(names)
    return installed
  }

  async rename(id: string, label: string): Promise<boolean> {
    if (!isBundled(id) && !this.installedFolder(id)) return false
    const names = await this.readNames()
    const trimmed = label.trim().slice(0, MAX_LABEL_LENGTH)
    if (trimmed) names[id] = trimmed
    else if (isBundled(id)) delete names[id]
    else return false
    await this.writeNames(names)
    return true
  }

  async remove(id: string): Promise<boolean> {
    const folder = this.installedFolder(id)
    if (!folder) return false
    await fs.rm(folder, { recursive: true, force: true })
    const names = await this.readNames()
    if (id in names) {
      delete names[id]
      await this.writeNames(names)
    }
    return true
  }
}
