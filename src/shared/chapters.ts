import type { NoteDocument, NoteSummary } from './noteLifecycle'

export const CHAPTER_CHANNELS = {
  list: 'chapters:list',
  create: 'chapters:create',
  cloneFromNote: 'chapters:clone-from-note',
  reorder: 'chapters:reorder',
  remove: 'chapters:remove',
  detachForTrash: 'chapters:detach-for-trash',
  restoreDetached: 'chapters:restore-detached',
  setChapterId: 'chapters:set-chapter-id',
  createAutoToc: 'chapters:create-auto-toc',
  regenerateAutoToc: 'chapters:regenerate-auto-toc',
  regenerateAutoOpenItems: 'chapters:regenerate-auto-open-items',
  toggleOpenItem: 'chapters:toggle-open-item',
} as const;

/** One chapter: `chapterNoteId` is itself a full note, ordered (gapless, 0-indexed) among `parentNoteId`'s other chapters. A chapter note belongs to exactly one parent, ever. `chapterId` is a user-assignable label (chapter bar right-click, or `$noteid§chapterid` links), unique per parentNoteId; null until first assigned. */
export interface ChapterEntry {
  parentNoteId: string;
  position: number;
  chapterNoteId: string;
  chapterId: string | null;
}

export interface ChapterFamilySplit {
  /** Pinned first in the chapter bar, right after the parent tab. Not draggable, not reorderable, no user-assignable chapterId. Null if this parent has none yet. */
  autoTocChapter: ChapterEntry | null;
  /** Pinned second, right after the auto-TOC chapter. Same non-draggable, non-reorderable, no-chapterId treatment. Null if this parent has none yet (it only exists once at least one chapter has an unchecked checklist item). */
  autoOpenItemsChapter: ChapterEntry | null;
  /** Every other chapter, in chapter-bar order -- the only ones a user can drag-reorder, collapse, or assign a chapterId to. */
  realChapters: ChapterEntry[];
}

/**
 * The single source of truth for telling a parent's auto-TOC and
 * auto-Open-Items chapters apart from its real ones, by each chapter note's
 * own `isAutoToc`/`isAutoOpenItems` flag -- and *only* that; `chapters`
 * itself carries no such field (this note-level fact deliberately lives on
 * NoteSummary instead, see NoteSummary.isAutoToc's own doc comment). Every
 * frontend consumer that needs this split (pinning the two auto chapters to
 * the front of the bar, excluding them from drag-reorder, building the
 * regeneration index, ...) MUST call this rather than re-deriving its own
 * filter -- that duplication is exactly how the auto-Open-Items chapter
 * once got walked as if it were a real chapter and leaked its own group
 * headings into the generated TOC as duplicate entries (see
 * noteLifecycleService.ts's `getRealChapterRows`, the equivalent
 * single-source-of-truth for the main-process side, which this mirrors --
 * kept as two separate functions since a NoteSummary and a NoteRecord are
 * different shapes, but the *rule* must never drift between them).
 */
export function splitChapterFamily(chapters: ChapterEntry[], notes: NoteSummary[]): ChapterFamilySplit {
  const noteById = new Map(notes.map((note) => [note.id, note]));
  let autoTocChapter: ChapterEntry | null = null;
  let autoOpenItemsChapter: ChapterEntry | null = null;
  const realChapters: ChapterEntry[] = [];

  for (const chapter of chapters) {
    const note = noteById.get(chapter.chapterNoteId);
    if (note?.isAutoToc) {
      autoTocChapter = chapter;
      continue;
    }
    if (note?.isAutoOpenItems) {
      autoOpenItemsChapter = chapter;
      continue;
    }
    realChapters.push(chapter);
  }

  return { autoTocChapter, autoOpenItemsChapter, realChapters };
}

export interface ChaptersApi {
  listChapters(parentNoteId: string): Promise<ChapterEntry[]>;
  /** Creates a new empty `chapterOnly` note and appends it as `parentNoteId`'s last chapter. */
  createChapter(parentNoteId: string): Promise<{ chapters: ChapterEntry[]; created: NoteDocument }>;
  /** Clones `sourceNoteId`'s content into a brand-new `chapterOnly` note and appends that as `parentNoteId`'s last chapter (dragging a note from the sidebar onto a chapter bar). The source note is never touched, marked `chapterOnly`, or otherwise linked -- only already-`chapterOnly` notes can ever be chapters, so this is the only way a regular note's content reaches a chapter bar. */
  cloneNoteAsChapter(parentNoteId: string, sourceNoteId: string): Promise<{ chapters: ChapterEntry[]; created: NoteDocument }>;
  reorderChapters(parentNoteId: string, orderedChapterNoteIds: string[]): Promise<ChapterEntry[]>;
  removeChapter(parentNoteId: string, chapterNoteId: string): Promise<ChapterEntry[]>;
  /** Deletes-to-trash: tags `chapterNoteId` 'deleted' and detaches it from `parentNoteId`'s chapters table (closing the position gap, like removeChapter), remembering its parent + position so restoreDetachedChapter can put it back. */
  detachChapterForTrash(parentNoteId: string, chapterNoteId: string): Promise<ChapterEntry[]>;
  /** Reverses detachChapterForTrash: reattaches the chapter to its remembered parent at its remembered (clamped) position, shifting that position and everything after it forward to make room. Returns null if the chapter has no remembered detachment (e.g. already restored, or never a chapter). */
  restoreDetachedChapter(chapterNoteId: string): Promise<{ parentNoteId: string; chapters: ChapterEntry[] } | null>;
  /** Assigns (or, given an empty string, clears) one chapter's label. Returns the final, collision-resolved id actually stored, or null if cleared. */
  setChapterId(parentNoteId: string, chapterNoteId: string, requestedId: string): Promise<string | null>;
  /** Creates the auto-generated Table of Contents chapter, pinned to position 0, populated by the same regeneration pass regenerateAutoTocChapter uses. Throws if one already exists for this parent. */
  createAutoTocChapter(parentNoteId: string): Promise<{ chapters: ChapterEntry[]; created: NoteDocument }>;
  /** Refreshes the auto-TOC chapter's content from the current state of the parent and every real chapter -- see noteLifecycleService.ts's own doc comment for exactly what this does (anchor-linkifying headings that need it, rebuilding the master index). Throws if this parent has no auto-TOC chapter. */
  regenerateAutoTocChapter(parentNoteId: string): Promise<{ chapters: ChapterEntry[]; created: NoteDocument }>;
  /** Full-rescan refresh of the auto-Open-Items chapter: re-derives every family member's (parent + each real chapter's) own group from its current live checklist state, unlike the incremental single-note patch saveNote's checklist-diff hook normally applies. The Open Items manual-save-button's own refresh action. No-op if this parent has no auto-TOC chapter yet (regenerateOpenItemsGroup's own precondition). */
  regenerateAllOpenItems(parentNoteId: string): Promise<void>;
  /** Flips the real checklist item a click on one of the auto-Open-Items chapter's own (always-unchecked) checkboxes stands for -- `openItemsLineIndex` is that checkbox's own line within the chapter's current text. Writes straight to the source note without touching the Open Items chapter itself, so the list on screen doesn't change out from under the click; see noteLifecycleService.ts's own doc comment. Resolves to false (a silent no-op) if the click no longer resolves to a real item. */
  toggleOpenItem(openItemsChapterNoteId: string, openItemsLineIndex: number): Promise<boolean>;
}
