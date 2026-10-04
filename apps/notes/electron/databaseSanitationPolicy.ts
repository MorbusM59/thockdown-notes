/**
 * Pure decision logic for DatabaseService.sanitizeDatabase()'s conditional
 * VACUUM step. Kept in its own file, deliberately free of any
 * better-sqlite3 import: that native module is compiled against Electron's
 * bundled Node ABI, not the plain Node ABI vitest runs under (confirmed
 * live -- importing it under vitest fails with a NODE_MODULE_VERSION
 * mismatch), so anything meant to be unit-testable has to live somewhere
 * that doesn't transitively pull it in.
 */

export interface VacuumBloatCheckInput {
  pageCount: number
  freelistCount: number
  pageSizeBytes: number
}

/**
 * SQLite never shrinks a .db file after deletes on its own -- freed pages go
 * onto an internal freelist and get reused by future writes, but the file
 * itself stays at its high-water-mark size until an explicit VACUUM
 * rewrites it compactly. VACUUM is not cheap: it holds an exclusive lock
 * and rewrites the whole file, so running it unconditionally on every app
 * launch would be a real, user-visible startup delay on a large database.
 * Gate it behind an actual bloat threshold instead -- both conditions
 * required, not either alone, so a small database with a coincidentally
 * high freelist *ratio* (a handful of pages either way) doesn't trigger a
 * pointless VACUUM, and a large database with a low ratio (proportionally
 * tidy, just big) doesn't either.
 */
export const VACUUM_FREELIST_RATIO_THRESHOLD = 0.3
export const VACUUM_MIN_RECLAIMABLE_BYTES = 20 * 1024 * 1024 // 20MB

export function shouldVacuumForBloat({ pageCount, freelistCount, pageSizeBytes }: VacuumBloatCheckInput): boolean {
  if (pageCount <= 0 || freelistCount <= 0) return false

  const freelistRatio = freelistCount / pageCount
  const reclaimableBytes = freelistCount * pageSizeBytes

  return freelistRatio > VACUUM_FREELIST_RATIO_THRESHOLD && reclaimableBytes > VACUUM_MIN_RECLAIMABLE_BYTES
}
