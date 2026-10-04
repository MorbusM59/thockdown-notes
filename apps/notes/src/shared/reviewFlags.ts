export const REVIEW_FLAG_CHANNELS = {
  list: 'reviewFlags:list',
  set: 'reviewFlags:set',
  clear: 'reviewFlags:clear',
  sync: 'reviewFlags:sync',
} as const;

export type ReviewFlagSeverity = 'review' | 'warning';

/**
 * One flagged line. `lineNumber` is 1-indexed and is the app's best current
 * belief about which document line this flag belongs to -- kept exact via
 * live CM6 ChangeSet.mapPos remapping while a note is open (see CM6Editor's
 * flag-remap effect), so it only drifts from truth if remapping was bypassed
 * (crash before a debounced sync flushed, external file edit). `lineHash` is
 * a cheap non-cryptographic hash of that line's text at the moment it was
 * last confirmed correct -- used exclusively as a note-load sanity check
 * against that drift, never as the source of truth for position.
 */
export interface ReviewFlagEntry {
  id: number;
  noteId: string;
  lineNumber: number;
  severity: ReviewFlagSeverity;
  lineHash: string;
}

export interface ReviewFlagWrite {
  lineNumber: number;
  severity: ReviewFlagSeverity;
  lineHash: string;
}

/** One remapped flag, keyed by its existing row id, for the debounced post-edit sync. */
export interface ReviewFlagRemap {
  id: number;
  lineNumber: number;
  lineHash: string;
}

/** Cheap non-cryptographic hash (djb2) of a line's text -- a note-load sanity check only, never a source of truth for position. See ReviewFlagEntry.lineHash. */
export function hashLineText(text: string): string {
  let hash = 5381;
  for (let i = 0; i < text.length; i += 1) {
    hash = ((hash * 33) ^ text.charCodeAt(i)) >>> 0;
  }
  return hash.toString(16);
}

/** Ordering for remap collision resolution: when an edit merges two flagged lines into one, the more severe flag wins. */
export function reviewFlagSeverityRank(severity: ReviewFlagSeverity): number {
  return severity === 'warning' ? 1 : 0;
}

export interface ReviewFlagsApi {
  listReviewFlags(noteId: string): Promise<ReviewFlagEntry[]>;
  /** Upserts the flag at `lineNumber` (one flag per line per note) -- the click-cycle path. */
  setReviewFlag(noteId: string, flag: ReviewFlagWrite): Promise<ReviewFlagEntry[]>;
  /** Deletes the flag at `lineNumber`, if any -- the deliberate right-click-to-resolve path. */
  clearReviewFlag(noteId: string, lineNumber: number): Promise<ReviewFlagEntry[]>;
  /**
   * Applies exact post-edit line-number/hash corrections computed via CM6
   * ChangeSet.mapPos, keyed by each flag's row id. Any id present in a prior
   * `listReviewFlags` response but omitted here (the remap collided two
   * flags onto one line) is deleted -- collision resolution already happened
   * in the caller, which keeps the more severe flag.
   */
  syncReviewFlags(noteId: string, remaps: ReviewFlagRemap[]): Promise<ReviewFlagEntry[]>;
}
