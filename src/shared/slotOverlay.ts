// What a slot is showing when it is not simply showing a note, and how it
// gets back.
//
// THE INVARIANT THIS MODULE EXISTS TO ENFORCE:
//
//   Stored state may never contradict the screen. Where the two disagree,
//   the screen wins -- by construction of `occupancyOf`, not by a
//   correction applied afterwards.
//
// That is worth stating plainly because the previous design was the other
// way round. It kept three nullable records ("the guide is up here", "the
// adventure is up here", "an undocked note is here") beside the thing that
// was actually on screen -- each section's own active note, owned and
// persisted separately -- and reconciled the two with effects pointing in
// both directions: one forcing the note to match the records, two others
// watching the note and retracting the records. Opening a view is two
// non-atomic steps (mark the slot, then load or clear the note), so the two
// facts legitimately disagreed for a window on every single open, and every
// defect in this area lived in that window:
//
//   - A link into the guide from an ordinary note (the `$HELP` id, since
//     retired) activated a guide note without setting any record,
//     so the guide appeared as an ORDINARY note: dark toggle, its own temp
//     tab, and clicking that tab called revealNoteInMenu, which cleared the
//     reader's month/year filters to "reveal" a note that is filtered out of
//     every sidebar list. That is what "the date view broke" was.
//   - A note arriving during the gap left the retraction's latch unarmed,
//     so the record stayed lit over a view that was gone -- and pressing the
//     lit toggle then "closed" nothing and yanked the reader elsewhere.
//   - Three independent nullable fields for three mutually exclusive things
//     is eight representable states, of which four are legal.
//
// So: ONE record, and it is not the source of truth for what is displayed.
//
//   - The GUIDE is not recorded at all for display purposes. Showing the
//     guide IS having one of its notes active. Every route in -- the window
//     control, a restored session, a chapter pill, one of the guide's own
//     cross-references -- therefore reads as the guide with no code of its
//     own, and the
//     orphan class above is not merely fixed but unrepresentable.
//   - The ADVENTURE and an UNDOCKED note are the two occupants that nothing
//     on screen can identify (one is an empty slot, the other an ordinary
//     note). They read the record -- but always corroborated against the
//     slot: the adventure counts only while the slot is genuinely empty, an
//     undocked note only while that exact note is active. A record that has
//     gone stale is therefore INERT rather than wrong.
//
// What the record is really for is the RETURN: what the slot must go back
// to when the overlay closes. That is the one piece of state here that
// cannot be derived from anything, and it is also the safe kind: a stale
// return can only send the reader to a different note than they expected.
// It can never make the app claim something the screen contradicts.
//
// Pure and shape-only: no React, no persistence, no note loading. The
// caller applies the plan (App.tsx).

import { HELP_GUIDE_NOTE_IDS } from './helpGuide'

export type SlotOverlayKind = 'guide' | 'adventure' | 'undocked'

/**
 * The one record. At most one overlay exists across the whole app: opening
 * one closes any other, which is why this is a single value rather than a
 * field per kind.
 */
export interface SlotOverlay {
  kind: SlotOverlayKind
  sectionId: string
  /** What this slot must go back to when the overlay closes. Null means empty. */
  previousNoteId: string | null
  /** Only meaningful for 'undocked': which note is being shown out of place. */
  noteId?: string | null
}

/** What a given slot is actually showing, derived. */
export type SlotOccupancy =
  | { kind: 'note' }
  | { kind: 'guide' }
  | { kind: 'adventure' }
  | { kind: 'undocked'; noteId: string }

export const PLAIN_NOTE_OCCUPANCY: SlotOccupancy = { kind: 'note' }

/**
 * THE derivation. Every consumer -- the window control's lit state, the tab
 * bar's identity pill, the editor's chrome -- asks this and nothing else,
 * so there is no second opinion about what a slot is showing.
 *
 * Note that two slots can both read as `guide` if both happen to hold a
 * guide note. That is not a defect: both really are showing the guide. Only
 * one of them carries the return record, and only that one can be closed
 * back to something.
 */
export function occupancyOf(
  sectionId: string,
  activeNoteId: string | null,
  overlay: SlotOverlay | null,
): SlotOccupancy {
  if (activeNoteId !== null && HELP_GUIDE_NOTE_IDS.has(activeNoteId)) return { kind: 'guide' }

  if (overlay && overlay.sectionId === sectionId) {
    // Corroborated, always: the record alone is never enough to claim a
    // slot is showing something.
    if (overlay.kind === 'adventure' && activeNoteId === null) return { kind: 'adventure' }
    if (overlay.kind === 'undocked' && overlay.noteId && activeNoteId === overlay.noteId) {
      return { kind: 'undocked', noteId: overlay.noteId }
    }
  }

  return PLAIN_NOTE_OCCUPANCY
}

/** Whether the record still describes something real. A stale record is inert, but worth tidying. */
export function isOverlayLive(overlay: SlotOverlay | null, activeNoteIdOf: (sectionId: string) => string | null): boolean {
  if (!overlay) return false
  return occupancyOf(overlay.sectionId, activeNoteIdOf(overlay.sectionId), overlay).kind === overlay.kind
}

export interface SlotHandback {
  sectionId: string
  /** The note that slot must go back to; null means it must go back to empty. */
  noteId: string | null
}

export interface SlotOverlayOpenPlan {
  overlay: SlotOverlay
  /**
   * The slot the OUTGOING overlay was holding, if it was a different one.
   * A view can be lit in a slot the reader has since navigated away from,
   * and it still owes that slot its note back.
   */
  handback: SlotHandback | null
}

/**
 * Opening `kind` in `sectionId`, given what that slot shows right now.
 *
 * Re-opening into a slot that already carries an overlay INHERITS its
 * memory rather than re-recording. What the reader wants back is the note
 * they were on before any of this started, never the previous overlay's own
 * artefact -- recording it literally is how leaving the adventure once
 * restored the User Guide as an ordinary note.
 */
export function planOverlayOpen(
  kind: SlotOverlayKind,
  sectionId: string,
  currentNoteId: string | null,
  current: SlotOverlay | null,
  noteId?: string | null,
): SlotOverlayOpenPlan {
  const heldHere = current?.sectionId === sectionId ? current : null
  const previousNoteId = heldHere ? heldHere.previousNoteId : currentNoteId

  const handback: SlotHandback | null =
    current && current.sectionId !== sectionId
      ? { sectionId: current.sectionId, noteId: current.previousNoteId }
      : null

  return {
    overlay: { kind, sectionId, previousNoteId, ...(noteId === undefined ? {} : { noteId }) },
    handback,
  }
}

/** Closing whatever overlay is up: the slot it holds goes back to what it remembers. */
export function planOverlayClose(current: SlotOverlay | null): { overlay: null; restore: SlotHandback | null } {
  return {
    overlay: null,
    restore: current ? { sectionId: current.sectionId, noteId: current.previousNoteId } : null,
  }
}
