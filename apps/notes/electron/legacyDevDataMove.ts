import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
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
 * - The old folder is RENAMED to the new path as a whole, in one call, after
 *   the new folder (which holds at most the git placeholder) is removed.
 *   Both are inside one checkout, so that is a single directory-entry change
 *   on one filesystem: everything is at the old path or everything is at the
 *   new one. Moving entry by entry would not have that property, and an
 *   interruption between two renames could leave the SQLite file in one
 *   folder and its `-wal` journal, holding the latest changes, in the other.
 *   Nothing is copied, so nothing has to be verified against a source.
 * - The git placeholder `.gitkeep` is data in neither folder, and is put back
 *   after the rename if the old folder did not have one.
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

  // The new folder holds no data (checked above), so removing it loses at
  // most the placeholder, which is restored below.
  rmSync(dataDir, { recursive: true, force: true })
  mkdirSync(path.dirname(dataDir), { recursive: true })
  renameSync(legacyDir, dataDir)
  const placeholder = path.join(dataDir, PLACEHOLDER)
  if (!existsSync(placeholder)) writeFileSync(placeholder, '')
  return { kind: 'moved', entries: legacy }
}
