import { describe, expect, it } from 'vitest'
import { fileURLToPath } from 'node:url'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, normalize } from 'node:path'

/**
 * EVERY REPOSITORY PATH THE INDEX DOCUMENTS NAME EXISTS.
 *
 * CLAUDE.md is the document every session reads first, and it names files by
 * path hundreds of times; `apps/soundscapes/README.md` does the same for the Android
 * app. A path that no longer exists is a description that is believed and
 * wrong (engineering doctrine, rule 9), and a file move -- the Family
 * workspace migration moves most of the tree -- would otherwise leave every
 * such reference stale without anything saying so.
 *
 * A path is a backticked or link-target string starting with one of the
 * repository's top-level folders. Paths are resolved from the repository
 * root, except a link target starting with `./` or `../`, which resolves from
 * the document's own folder as a markdown viewer would. A `#anchor` is
 * dropped.
 *
 * Only these two documents for now: the handover documents under docs/ name
 * deleted files on purpose, as history, and need a superseded-marking pass of
 * their own before they can be held to this.
 */
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..')
const DOCUMENTS = ['CLAUDE.md', 'apps/soundscapes/README.md']
const TOP_LEVEL = ['apps', 'packages', 'scripts', 'docs', '.github']

/** Every path-like reference in `text`, as written. */
function pathReferences(text: string): string[] {
  const folders = TOP_LEVEL.map((f) => f.replace('.', '\\.')).join('|')
  const pattern = new RegExp(`(?:\`|\\]\\()((?:\\.{1,2}/)*(?:${folders})/[A-Za-z0-9_.@/-]*)(?=[\`)#])`, 'g')
  return [...text.matchAll(pattern)].map((m) => m[1])
}

describe('documented repository paths exist', () => {
  for (const document of DOCUMENTS) {
    it(document, () => {
      const text = readFileSync(join(ROOT, document), 'utf8')
      const missing = pathReferences(text)
        .filter((reference) => {
          const base = /^\.{1,2}\//.test(reference) ? join(ROOT, dirname(document)) : ROOT
          return !existsSync(normalize(join(base, reference)))
        })
      expect([...new Set(missing)]).toEqual([])
    })
  }
})
