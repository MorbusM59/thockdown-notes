import type { NoteDocument } from './noteLifecycle'

export const CHAPTER_CHANNELS = {
  list: 'chapters:list',
  create: 'chapters:create',
  addExisting: 'chapters:add-existing',
  reorder: 'chapters:reorder',
  remove: 'chapters:remove',
  setChapterId: 'chapters:set-chapter-id',
} as const;

/** One chapter: `chapterNoteId` is itself a full note, ordered (gapless, 0-indexed) among `parentNoteId`'s other chapters. `chapterId` is a user-assignable label (chapter bar right-click, or `$noteid§chapterid` links), unique per parentNoteId; null until first assigned. */
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
  /** Attaches an *existing* note (e.g. dragged in from the sidebar) as `parentNoteId`'s last chapter -- unlike createChapter, never touches `chapterOnly`, since the note may still have its own standalone life outside this parent's chapter bar. */
  addExistingChapter(parentNoteId: string, chapterNoteId: string): Promise<ChapterEntry[]>;
  reorderChapters(parentNoteId: string, orderedChapterNoteIds: string[]): Promise<ChapterEntry[]>;
  removeChapter(parentNoteId: string, chapterNoteId: string): Promise<ChapterEntry[]>;
  /** Assigns (or, given an empty string, clears) one chapter's label. Returns the final, collision-resolved id actually stored, or null if cleared. */
  setChapterId(parentNoteId: string, chapterNoteId: string, requestedId: string): Promise<string | null>;
}
