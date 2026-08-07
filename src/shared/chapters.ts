import type { NoteDocument } from './noteLifecycle'

export const CHAPTER_CHANNELS = {
  list: 'chapters:list',
  create: 'chapters:create',
  reorder: 'chapters:reorder',
  remove: 'chapters:remove',
} as const;

/** One chapter: `chapterNoteId` is itself a full note, ordered (gapless, 0-indexed) among `parentNoteId`'s other chapters. */
export interface ChapterEntry {
  parentNoteId: string;
  position: number;
  chapterNoteId: string;
}

export interface ChaptersApi {
  listChapters(parentNoteId: string): Promise<ChapterEntry[]>;
  /** Creates a new empty `chapterOnly` note and appends it as `parentNoteId`'s last chapter. */
  createChapter(parentNoteId: string): Promise<{ chapters: ChapterEntry[]; created: NoteDocument }>;
  reorderChapters(parentNoteId: string, orderedChapterNoteIds: string[]): Promise<ChapterEntry[]>;
  removeChapter(parentNoteId: string, chapterNoteId: string): Promise<ChapterEntry[]>;
}
