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
 * data root, so a portable build keeps them with its notes), the id being the
 * `.dic` file's name without extension as the reader picked it. Installing
 * copies rather than referring to the reader's file, so a dictionary keeps
 * working when the original is moved or deleted.
 */
import { createRequire } from 'node:module'
import path from 'node:path'
import { promises as fs } from 'node:fs'
import { BUNDLED_DICTIONARIES, type SpellCheckDictionary, type SpellCheckDictionaryFiles } from '../src/shared/spellCheck'

const requireFromHere = createRequire(import.meta.url)

/** A file name usable as an id and a folder name: letters, digits, `_`, `-`, `.`; never empty, never a path. */
export function installedDictionaryId(dicFileName: string): string | null {
  const base = path.basename(dicFileName, path.extname(dicFileName)).replace(/[^\p{L}\p{N}_.-]/gu, '_').replace(/^\.+/, '')
  return base.length > 0 && base.length <= 64 ? base : null
}

function bundledFolder(id: string): string | null {
  if (!BUNDLED_DICTIONARIES.some((entry) => entry.id === id)) return null
  try {
    return path.dirname(requireFromHere.resolve(`dictionary-${id}`))
  } catch {
    return null
  }
}

export class SpellCheckDictionaries {
  constructor(private readonly installedRoot: string) {}

  private installedFolder(id: string): string | null {
    if (installedDictionaryId(id) !== id) return null
    return path.join(this.installedRoot, id)
  }

  async list(): Promise<SpellCheckDictionary[]> {
    const installed: SpellCheckDictionary[] = []
    const entries = await fs.readdir(this.installedRoot, { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      if (!entry.isDirectory() || BUNDLED_DICTIONARIES.some((bundled) => bundled.id === entry.name)) continue
      if (installedDictionaryId(entry.name) !== entry.name) continue
      installed.push({ id: entry.name, label: entry.name, bundled: false })
    }
    installed.sort((a, b) => a.label.localeCompare(b.label))
    return [...BUNDLED_DICTIONARIES, ...installed]
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

  /** Copies `<name>.dic` and the `<name>.aff` beside it in. Null when the pair is incomplete or the name clashes with a bundled one. */
  async install(dicPath: string): Promise<SpellCheckDictionary | null> {
    const id = installedDictionaryId(dicPath)
    if (!id || BUNDLED_DICTIONARIES.some((entry) => entry.id === id)) return null
    const affPath = path.join(path.dirname(dicPath), `${path.basename(dicPath, path.extname(dicPath))}.aff`)
    let aff: Buffer
    let dic: Buffer
    try {
      [aff, dic] = await Promise.all([fs.readFile(affPath), fs.readFile(dicPath)])
    } catch {
      return null
    }
    const folder = path.join(this.installedRoot, id)
    await fs.mkdir(folder, { recursive: true })
    await fs.writeFile(path.join(folder, 'index.aff'), aff)
    await fs.writeFile(path.join(folder, 'index.dic'), dic)
    return { id, label: id, bundled: false }
  }

  async remove(id: string): Promise<boolean> {
    if (BUNDLED_DICTIONARIES.some((entry) => entry.id === id)) return false
    const folder = this.installedFolder(id)
    if (!folder) return false
    await fs.rm(folder, { recursive: true, force: true })
    return true
  }
}
