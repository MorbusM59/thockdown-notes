import { existsSync, mkdirSync, readdirSync, renameSync, rmdirSync, unlinkSync } from 'node:fs'
import path from 'node:path'

/**
 * Moves an unpackaged (development) run's data from where it lived before the
 * desktop app moved into `apps/notes` to where it lives now.
 *
 * Before the move, `resolveDataRoot` returned `<repository>/data` for an
 * unpackaged run, because `APP_ROOT` was the repository root. `APP_ROOT` is now
 * `apps/notes`, so the same code returns `apps/notes/data`, and a checkout
 * that already had notes would open an empty database next to them. Packaged
 * and portable builds are unaffected: their data root never depended on the
 * source layout.
 *
 * The rules, chosen so the move can lose nothing:
 * - Nothing happens unless the old folder holds data and the new one holds
 *   none. Two databases are never merged; if both hold data the new one is
 *   used, the old one is left exactly as it was, and the result says so.
 * - Entries are RENAMED, not copied. Both folders are inside one checkout, so
 *   a rename is a single directory-entry change on one filesystem: the file
 *   is either at the old path or at the new one, never half-written, and no
 *   copy has to be verified against its source. The SQLite file and its
 *   `-wal`/`-shm` companions travel together, because this runs before the
 *   database is opened.
 * - The git placeholder `.gitkeep` is data in neither folder.
 * - The old folder is removed only once it is empty.
 *
 * It must run before anything opens a file under the data root.
 */
export type LegacyDevDataMove =
  | { kind: 'nothing-to-move' }
  | { kind: 'moved'; entries: string[] }
  | { kind: 'both-hold-data'; legacyDir: string }

const PLACEHOLDER = '.gitkeep'

function dataEntries(dir: string): string[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir).filter((name) => name !== PLACEHOLDER)
}

export function moveLegacyDevData(legacyDir: string, dataDir: string): LegacyDevDataMove {
  const legacy = dataEntries(legacyDir)
  if (legacy.length === 0) return { kind: 'nothing-to-move' }
  if (dataEntries(dataDir).length > 0) return { kind: 'both-hold-data', legacyDir }

  mkdirSync(dataDir, { recursive: true })
  for (const name of legacy) {
    renameSync(path.join(legacyDir, name), path.join(dataDir, name))
  }
  const placeholder = path.join(legacyDir, PLACEHOLDER)
  if (existsSync(placeholder)) unlinkSync(placeholder)
  rmdirSync(legacyDir)
  return { kind: 'moved', entries: legacy }
}
