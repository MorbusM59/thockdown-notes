// The persisted block map: the ONE place that knows the record's format.
//
// A note's block map is a structural index of its markdown -- one entry per
// top-level block, each a type and a 1-based source-line span -- stored in the
// note's own row and validated against the text it was computed from. It is
// LAYOUT-INDEPENDENT by construction: no pixels, no widths, no font, nothing
// about how the text is drawn. That is what lets one record serve edit view,
// render view, every window size and both size modes.
//
// It exists so that opening a note does not have to re-parse it. Rebuilding
// the map means running remark over the whole document, which on a large note
// is seconds; restoring it from ranges is a line split and some object
// construction.
//
// ## Why this module exists at all
//
// The record used to be built in FOUR places and validated in a fifth, each
// with its own copy of the same six lines. Predictably, they drifted: three
// wrote `PREVIEW_BLOCK_CACHE_VERSION` and the fourth wrote a literal `v: 1`.
// That field's entire job is to invalidate records whose shape changed, so
// the first bump would have had one writer stamping the old version onto
// new-format data and the reader trusting it. A format with four authors has
// no format.
//
// So: one module, both directions. `buildPersistedBlockMap` is the only thing
// that produces a record, `restorePersistedBlockMap` the only thing that
// accepts one, and the version constant is visible to neither caller.
//
// ## Absent is not the same as null
//
// `buildPersistedBlockMap` returns `undefined` when it has nothing to say --
// no in-memory map, or one computed from different text. Callers must OMIT
// the field in that case rather than writing null, and the difference is not
// pedantry: `saveNoteUiState` merges field by field, so an omitted field
// keeps whatever is on disk while an explicit null DESTROYS it.
//
// A record on disk is either provably good (its hash matches) or discarded on
// read. So keeping a possibly-stale one costs one hash on the next open, and
// destroying a valid one costs a full parse. The asymmetry is entirely one
// way, and every writer used to take the wrong side of it -- erasing a good
// record on disk because the in-memory copy happened to be missing.

import type { PersistedPreviewBlockCache } from '../shared/noteLifecycle'
import { hashNormalizedText } from '../shared/hashText'
import {
  restorePreviewBlockSplitCacheFromRanges,
  type PreviewBlockSplitCache,
} from './PreviewBlockSplit'

/**
 * Schema version of the persisted record. Bump when the range shape changes;
 * every existing record then fails `restorePersistedBlockMap` and the note
 * re-parses once, which is the whole point of the field.
 *
 * Deliberately not exported. A version a caller can reach is a version a
 * caller can write, and that is exactly how the literal `v: 1` got in.
 */
const PERSISTED_BLOCK_MAP_VERSION = 1

/**
 * The record to persist for `text`, or `undefined` when there is nothing
 * worth persisting -- which the caller must express by OMITTING the field,
 * never by writing null. See the module comment on why that difference
 * destroys data.
 *
 * The hash is computed here rather than by the caller so that the digest and
 * the ranges can never come from different text, and so that no caller has to
 * remember which normalization the reader will use.
 */
export async function buildPersistedBlockMap(
  cache: PreviewBlockSplitCache | null,
  text: string,
): Promise<PersistedPreviewBlockCache | undefined> {
  if (!cache || cache.text !== text) return undefined
  return {
    v: PERSISTED_BLOCK_MAP_VERSION,
    textHash: await hashNormalizedText(text),
    ranges: cache.ranges.map(({ type, rangeStartLine1, rangeEndLine1 }) => ({
      type,
      rangeStartLine1,
      rangeEndLine1,
    })),
  }
}

/** Why a record was not used, for the trace. `null` reason means it was. */
export interface RestoredBlockMap {
  cache: PreviewBlockSplitCache | null
  reason: 'restored' | 'absent' | 'wrong-version' | 'text-changed'
}

/**
 * Validates a persisted record against the text actually loaded, and hydrates
 * it if it holds.
 *
 * The hash check is what makes a stale record harmless rather than dangerous:
 * a note edited outside the app, restored from a backup, or synced from
 * elsewhere arrives with a record describing text it no longer has, and this
 * discards it instead of handing out a block map that points at the wrong
 * lines. A wrong map is not a slow note; it is a caret landing in the wrong
 * place.
 */
export async function restorePersistedBlockMap(
  record: PersistedPreviewBlockCache | null | undefined,
  text: string,
): Promise<RestoredBlockMap> {
  if (!record) return { cache: null, reason: 'absent' }
  if (record.v !== PERSISTED_BLOCK_MAP_VERSION) return { cache: null, reason: 'wrong-version' }
  if ((await hashNormalizedText(text)) !== record.textHash) return { cache: null, reason: 'text-changed' }
  return { cache: restorePreviewBlockSplitCacheFromRanges(text, record.ranges), reason: 'restored' }
}
