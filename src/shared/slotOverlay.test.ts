import { describe, expect, it } from 'vitest'
import { HELP_GUIDE_ROOT_ID, HELP_GUIDE_CHAPTER_IDS } from './helpGuide'
import {
  isOverlayLive,
  liveOccupancy,
  occupancyOf,
  PLAIN_NOTE_OCCUPANCY,
  planOverlayClose,
  planOverlayOpen,
  sectionShowingOverlay,
  type SlotOccupancy,
  type SlotOverlay,
} from './slotOverlay'

const GUIDE_CHAPTER = HELP_GUIDE_CHAPTER_IDS[0].noteId

describe('occupancyOf', () => {
  it('reads the guide from the note itself, with no record involved', () => {
    // The whole point: every route into the guide -- the window control, a
    // restored session, a chapter pill, one of the guide's own
    // cross-references -- lands here identically, because there is nothing
    // else to get right.
    expect(occupancyOf('left', HELP_GUIDE_ROOT_ID, null).kind).toBe('guide')
    expect(occupancyOf('left', GUIDE_CHAPTER, null).kind).toBe('guide')
  })

  it('lets both slots read as the guide when both hold guide notes', () => {
    // Not a defect: both really are showing it. Only the one carrying the
    // record can be closed back to something.
    const overlay: SlotOverlay = { kind: 'guide', sectionId: 'left', previousNoteId: 'note-a' }
    expect(occupancyOf('left', HELP_GUIDE_ROOT_ID, overlay).kind).toBe('guide')
    expect(occupancyOf('right', GUIDE_CHAPTER, overlay).kind).toBe('guide')
  })

  it('shows the adventure only while the slot is genuinely empty', () => {
    const overlay: SlotOverlay = { kind: 'adventure', sectionId: 'left', previousNoteId: 'note-a' }
    expect(occupancyOf('left', null, overlay).kind).toBe('adventure')
    // A note has arrived: the record is now inert, not wrong. This is the
    // case that used to leave the toggle lit over a game that was gone.
    expect(occupancyOf('left', 'note-b', overlay).kind).toBe('note')
    // And it says nothing at all about the other slot.
    expect(occupancyOf('right', null, overlay).kind).toBe('note')
  })

  it('shows an undocked note only while that exact note is the one active', () => {
    const overlay: SlotOverlay = { kind: 'undocked', sectionId: 'left', previousNoteId: 'note-a', noteId: 'note-x' }
    expect(occupancyOf('left', 'note-x', overlay)).toEqual({ kind: 'undocked', noteId: 'note-x' })
    expect(occupancyOf('left', 'note-y', overlay).kind).toBe('note')
  })

  it('never lets a record contradict the screen', () => {
    // The invariant, stated as a test. Every combination of a record and a
    // slot that disagree resolves in the slot's favour.
    const overlays: SlotOverlay[] = [
      { kind: 'adventure', sectionId: 'left', previousNoteId: null },
      { kind: 'undocked', sectionId: 'left', previousNoteId: null, noteId: 'note-x' },
      { kind: 'guide', sectionId: 'left', previousNoteId: null },
    ]
    for (const overlay of overlays) {
      // An ordinary note is showing, so an ordinary note is what is reported.
      expect(occupancyOf('left', 'some-other-note', overlay).kind).toBe('note')
    }
  })
})

describe('isOverlayLive', () => {
  it('recognizes a record whose slot has moved on', () => {
    const overlay: SlotOverlay = { kind: 'adventure', sectionId: 'left', previousNoteId: 'note-a' }
    expect(isOverlayLive(overlay, () => null)).toBe(true)
    expect(isOverlayLive(overlay, () => 'note-b')).toBe(false)
    expect(isOverlayLive(null, () => null)).toBe(false)
  })
})

describe('planOverlayOpen', () => {
  it("remembers the slot's own note when nothing is holding it", () => {
    const plan = planOverlayOpen('adventure', 'left', 'note-a', null)
    expect(plan.overlay).toEqual({ kind: 'adventure', sectionId: 'left', previousNoteId: 'note-a' })
    expect(plan.handback).toBeNull()
  })

  it('remembers an empty slot as empty rather than as "no memory"', () => {
    expect(planOverlayOpen('adventure', 'left', null, null).overlay.previousNoteId).toBeNull()
  })

  it('inherits the displaced overlay\'s memory instead of recording its artefact', () => {
    // The original bug this module was written for: opening the adventure
    // over the guide used to record the GUIDE'S OWN NOTE as the thing to
    // restore, so leaving the adventure left the User Guide sitting in the
    // slot as an ordinary note with its toggle dark.
    const guide: SlotOverlay = { kind: 'guide', sectionId: 'left', previousNoteId: 'note-a' }
    const plan = planOverlayOpen('adventure', 'left', HELP_GUIDE_ROOT_ID, guide)
    expect(plan.overlay).toEqual({ kind: 'adventure', sectionId: 'left', previousNoteId: 'note-a' })
    expect(plan.handback).toBeNull()
  })

  it('is idempotent: re-opening the same kind here keeps the memory it had', () => {
    const guide: SlotOverlay = { kind: 'guide', sectionId: 'left', previousNoteId: 'note-a' }
    expect(planOverlayOpen('guide', 'left', HELP_GUIDE_ROOT_ID, guide).overlay.previousNoteId).toBe('note-a')
  })

  it('hands the other slot back its note when the overlay moves', () => {
    const guide: SlotOverlay = { kind: 'guide', sectionId: 'left', previousNoteId: 'note-a' }
    const plan = planOverlayOpen('adventure', 'right', 'note-b', guide)
    expect(plan.overlay).toEqual({ kind: 'adventure', sectionId: 'right', previousNoteId: 'note-b' })
    expect(plan.handback).toEqual({ sectionId: 'left', noteId: 'note-a' })
  })

  it('carries the note an undocked overlay is showing', () => {
    const plan = planOverlayOpen('undocked', 'left', 'note-a', null, 'note-x')
    expect(plan.overlay.noteId).toBe('note-x')
  })
})

describe('planOverlayClose', () => {
  it('sends the slot back to what it remembered', () => {
    const overlay: SlotOverlay = { kind: 'adventure', sectionId: 'left', previousNoteId: 'note-a' }
    expect(planOverlayClose(overlay)).toEqual({ overlay: null, restore: { sectionId: 'left', noteId: 'note-a' } })
  })

  it('sends a slot that was empty back to empty', () => {
    const overlay: SlotOverlay = { kind: 'guide', sectionId: 'left', previousNoteId: null }
    expect(planOverlayClose(overlay).restore).toEqual({ sectionId: 'left', noteId: null })
  })

  it('has nothing to restore when nothing was open', () => {
    expect(planOverlayClose(null)).toEqual({ overlay: null, restore: null })
  })
})

/**
 * A SLOT THAT IS NOT ON SCREEN REPORTS NOTHING.
 *
 * Occupancy is fed by each section from its own render, and unmounting is the
 * one event a reporter is not around for -- so the raw map keeps entries for
 * slots that have been closed. Believing one of those is how the window
 * control ended up lit, with a flame, over a section that no longer existed:
 * the toggle reads "is something showing the adventure", got a dead slot's id
 * back, and every press from then on tried to CLOSE a view nothing could
 * reach. The first press cleared the return record and found no slot to hand
 * back to; every press after that had nothing left to close and did literally
 * nothing. Lit for ever, dead for ever.
 */
describe('what the slots that exist are showing', () => {
  const closedSlotStillClaimingTheAdventure: Record<string, SlotOccupancy> = {
    left: PLAIN_NOTE_OCCUPANCY,
    gone: { kind: 'adventure' },
  }

  it('drops a report from a slot that is no longer on screen', () => {
    expect(liveOccupancy(['left'], closedSlotStillClaimingTheAdventure)).toEqual({ left: PLAIN_NOTE_OCCUPANCY })
  })

  it('never names a slot the reader cannot be sent to', () => {
    // The whole defect in one assertion: scanning every entry answers "gone",
    // and there is no such slot to close, focus, or draw a ring in.
    expect(sectionShowingOverlay(['left'], closedSlotStillClaimingTheAdventure, 'adventure')).toBeNull()
  })

  it('names the slot while it is still there', () => {
    expect(sectionShowingOverlay(['left', 'gone'], closedSlotStillClaimingTheAdventure, 'adventure')).toBe('gone')
  })

  it('answers in the slots own order, so two guides resolve to the leftmost', () => {
    // Two slots can genuinely both show the guide (see `occupancyOf`). Which
    // one is named has to be stable, and the reader's own left-to-right order
    // is the only stable one -- object key order is insertion order, which is
    // whichever section happened to mount first.
    const both: Record<string, SlotOccupancy> = { right: { kind: 'guide' }, left: { kind: 'guide' } }
    expect(sectionShowingOverlay(['left', 'right'], both, 'guide')).toBe('left')
  })

  it('is empty when nothing has reported yet', () => {
    expect(liveOccupancy(['left'], {})).toEqual({})
    expect(sectionShowingOverlay(['left'], {}, 'adventure')).toBeNull()
  })
})
