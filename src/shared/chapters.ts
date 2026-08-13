import type { NoteDocument } from './noteLifecycle'

export const CHAPTER_CHANNELS = {
  list: 'chapters:list',
  create: 'chapters:create',
  cloneFromNote: 'chapters:clone-from-note',
  reorder: 'chapters:reorder',
  promote: 'chapters:promote-to-parent',
  remove: 'chapters:remove',
  setChapterId: 'chapters:set-chapter-id',
} as const;

/** One chapter: `chapterNoteId` is itself a full note, ordered (gapless, 0-indexed) among `parentNoteId`'s other chapters. A chapter note belongs to exactly one parent, ever. `chapterId` is a user-assignable label (chapter bar right-click, or `$noteid§chapterid` links), unique per parentNoteId; null until first assigned. */
export interface ChapterEntry {
  parentNoteId: string;
  position: number;
  chapterNoteId: string;
  chapterId: string | null;
}

export interface ChaptersApi {
  listChapters(parentNoteId: string): Promise<ChapterEntry[]>;
  /** Creates a new empty `chapterOnly` note and appends it as `parentNoteId`'s last chapter. */
  createChapter(parentNoteId: string): Promise<{ chapters: ChapterEntry[]; created: NoteDocument }>;
  /** Clones `sourceNoteId`'s content into a brand-new `chapterOnly` note and appends that as `parentNoteId`'s last chapter (dragging a note from the sidebar onto a chapter bar). The source note is never touched, marked `chapterOnly`, or otherwise linked -- only already-`chapterOnly` notes can ever be chapters, so this is the only way a regular note's content reaches a chapter bar. */
  cloneNoteAsChapter(parentNoteId: string, sourceNoteId: string): Promise<{ chapters: ChapterEntry[]; created: NoteDocument }>;
  reorderChapters(parentNoteId: string, orderedChapterNoteIds: string[]): Promise<ChapterEntry[]>;
  /** Special-case chapter drag to the first slot: the dragged chapter becomes the parent note, the old parent becomes its first chapter, and the remaining siblings keep order after it. */
  promoteChapterToParent(parentNoteId: string, chapterNoteId: string): Promise<ChapterEntry[]>;
  removeChapter(parentNoteId: string, chapterNoteId: string): Promise<ChapterEntry[]>;
  /** Assigns (or, given an empty string, clears) one chapter's label. Returns the final, collision-resolved id actually stored, or null if cleared. */
  setChapterId(parentNoteId: string, chapterNoteId: string, requestedId: string): Promise<string | null>;
}
