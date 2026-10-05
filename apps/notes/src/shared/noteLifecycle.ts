import { isExternalTagName } from './tags'

export const NOTE_LIFECYCLE_CHANNELS = {
  list: 'notes:list',
  load: 'notes:load',
  create: 'notes:create',
  save: 'notes:save',
  remove: 'notes:remove',
  getNoteTags: 'tags:get-note-tags',
  addTag: 'tags:add',
  removeTag: 'tags:remove',
  reorderTags: 'tags:reorder',
  renameTag: 'tags:rename',
  listTags: 'tags:list',
  saveNoteUiState: 'notes:save-note-ui-state',
  getNoteUiState: 'notes:get-note-ui-state',
  updateExternalNoteState: 'notes:update-external-note-state',
  syncExternalNoteToFile: 'notes:sync-external-note-to-file',
  getNoteIdByExternalPath: 'notes:get-note-id-by-external-path',
  saveNoteSnapshot: 'notes:save-note-snapshot',
  getNoteSnapshots: 'notes:get-note-snapshots',
  getFromDiskBaseline: 'notes:get-from-disk-baseline',
  deleteNoteSnapshot: 'notes:delete-note-snapshot',
  saveSnapshotAnchor: 'notes:save-snapshot-anchor',
  getSnapshotAnchor: 'notes:get-snapshot-anchor',
  branchNoteFromSnapshot: 'notes:branch-from-snapshot',
  setAssignedId: 'notes:set-internal-id',
  setTimeless: 'notes:set-timeless',
  restoreMissingNoteFile: 'notes:restore-missing-file',
  specifyMissingNoteFile: 'notes:specify-missing-file',
} as const;

/**
 * A note whose database entry outlived its `.md` file -- the file was moved,
 * renamed or deleted outside the app, or the app opened a data folder it did
 * not write. Such a note is KEPT, never purged on its own: the database holds
 * a copy of its text (`note_content`), so the file going missing is usually
 * recoverable, and deleting the entry is a decision only the reader can take.
 */
export interface MissingNoteFile {
  /** Whether the database holds a copy of the text to write the file back from. */
  hasStoredCopy: boolean;
}

export interface NoteSummary {
  id: string;
  fileName: string;
  title: string;
  tags: string[];
  /**
   * The first line of the note's content, or null when the content is blank
   * -- all an identity label needs (tabLabels.ts's resolveIdentityLabel).
   *
   * The content itself is deliberately NOT part of a summary. Summaries are
   * React state, and a render scope that holds one keeps it alive for as
   * long as any memoized callback created in that render survives -- so a
   * summary carrying a note's text retained one copy of the note per save
   * (editorSection/useDisplayedNoteText.ts has the mechanism). The main
   * process still sends the content (NoteSummaryWithContent); App's notes
   * setter moves it into a store and hands out `readNoteContent` instead.
   */
  leadLine: string | null;
  createdAtMs: number;
  updatedAtMs: number;
  sizeBytes: number;
  isExternal?: boolean;
  externalPath?: string | null;
  hasUnsavedChanges?: boolean;
  isInSync?: boolean;
  /** User-assignable tab-bar label. Null until first assigned (explicitly via `$id`, or lazily defaulted). */
  assignedId?: string | null;
  /** True for a note created only to be a chapter (via the chapter bar's "+" button, or cloned from a note dragged onto a chapter bar) -- excluded from every menu view except a deleted/archived chapter's own row in trash/archive (see isChapterOnlyNote's callers in App.tsx), only otherwise ever shown through its parent's chapter bar. Never true for a note that can also stand on its own. */
  chapterOnly: boolean;
  /** True for the one chapter (if any) that's the auto-generated table of contents for its parent's whole chapter family -- see databaseService.ts's `isAutoToc` column doc comment. Always false for a non-chapter note. */
  isAutoToc: boolean;
  /** True for the one chapter (if any) that's the auto-generated Open Items list for its parent's whole chapter family -- see databaseService.ts's `isAutoOpenItems` column doc comment. Always false for a non-chapter note. */
  isAutoOpenItems: boolean;
  /** True once this note has been frozen in time -- see databaseService.ts's `freezeNoteFamily`/`isTimeless` column doc comment. Stamped on every member of a chapter family together (root, every real chapter, the auto-TOC chapter), not cascade-derived from a parent lookup -- a chapterOnly note's own isTimeless is always in sync with its parent's. */
  isTimeless: boolean;
  /** The single note this note is a chapter of, or null when it isn't (any) chapter, OR when it's a chapter currently detached (sitting in Trash) -- see `detachedChapterParentId` below for that case. A regular note is always null (regular notes can never become chapters). */
  chapterParentId: string | null;
  /** Where a detached chapter (see databaseService.ts's detachChapterForTrash) was detached FROM, while it's sitting in Trash -- `chapterParentId` above goes null the moment a chapter is detached (it has no `chapters` row to derive it from any more), so anything that needs "whose chapter was this" for a detached chapter (the Trash row's `$ ` parent-title meta) must fall back to this field instead. Null except during that detached window; restoreDetachedChapter clears it back to null once it reattaches. */
  detachedChapterParentId: string | null;
  /** This chapter's own user-assignable id (the `chapters.chapterId` column) -- distinct from `assignedId` above, which is a different, note-level `$id` field a chapterOnly note's own tag bar never exposes a way to set. Null when unset, or when this note isn't a chapter. See tabLabels.ts's resolveIdentityLabel for how this resolves to a display label alongside a derived-from-content fallback -- the same rule the chapter bar's own pill uses, reused for a chapter's sidebar-list row (trash/archive) so the two read identically. */
  chapterId: string | null;
  /** Set while the note's `.md` file is missing; absent while it is where it belongs. See MissingNoteFile. */
  missingFile?: MissingNoteFile;
}

/** A summary as the main process sends it: with the note's content, which the renderer keeps out of React state (see NoteSummary.leadLine). */
export interface NoteSummaryWithContent extends NoteSummary {
  contentText: string;
}

export interface NoteDocument extends NoteSummaryWithContent {
  text: string;
}

export interface CreateNoteInput {
  initialText?: string;
  externalPath?: string;
  title?: string;
  initialTags?: string[];
}

export interface SaveNoteInput {
  id: string;
  text: string;
  // Piggybacked onto this same debounced write when the caller already has
  // a fresh cursor position on hand -- see databaseService.ts's
  // upsertNoteContent doc comment. Optional; omitting this never clears a
  // previously persisted position. Scroll position (anchorBlockIndex) is
  // NOT piggybacked here -- it's written only via saveNoteUiState, at the
  // enumerated leave-editor checkpoints (see docs/editor-contract.md).
  cursorPos?: number | null;
  /**
   * Persisted preview-block split cache, keyed to the saved note text by
   * its SHA-256 checksum. Allows the first edit->preview toggle after app
   * startup to warm-start from the previous session's parse. The renderer
   * validates the checksum before trusting the cache.
   */
  previewBlockCache?: PersistedPreviewBlockCache | null;
}

export interface DeleteNoteInput {
  id: string;
}

export interface DeleteNoteSnapshotInput {
  snapshotId: number;
}

export interface LoadNoteInput {
  id: string;
}

export interface AddTagInput {
  id: string;
  tagName: string;
  position: number;
}

export interface RemoveTagInput {
  id: string;
  tagName: string;
}

export interface ReorderTagsInput {
  id: string;
  tagNames: string[];
}

export interface RenameTagInput {
  fromName: string;
  toName: string;
}

export interface NoteTagsInput {
  id: string;
}

export interface BranchNoteFromSnapshotInput {
  sourceNoteId: string;
  snapshotId: number;
}

export interface TagSummary {
  name: string;
  usageCount: number;
}

export type PersistedPreviewBlockCache = {
  /** Schema version of this cache blob. Bumped whenever the structural shape changes. */
  v: number;
  /** SHA-256 hex digest of the normalized note text this cache was computed from. */
  textHash: string;
  /** Structural ranges produced by PreviewBlockSplit.ts. */
  ranges: Array<{
    type: string;
    /** 1-indexed, inclusive. */
    rangeStartLine1: number;
    /** 1-indexed, inclusive. */
    rangeEndLine1: number;
  }>;
};

export type NoteUiStatePayload = {
  /** The canonical mode-agnostic BLOCK -- an index into the note's current PreviewMarkdownBlock[] array. Never a pixel offset. */
  anchorBlockIndex?: number | null;
  cursorPos?: number | null;
  /**
   * Persisted preview-block split cache, keyed to the note text by
   * contentChecksum. Allows the first edit->preview toggle after app
   * startup to warm-start from the previous session's parse. Safe to
   * discard (renderer falls back to full parse) if invalid or stale.
   */
  previewBlockCache?: PersistedPreviewBlockCache | null;
};

export type NoteUiState = {
  anchorBlockIndex: number;
  cursorPos: number;
  previewBlockCache: PersistedPreviewBlockCache | null;
};

export interface NoteLifecycleApi {
  listNotes(): Promise<NoteSummaryWithContent[]>;
  loadNote(input: LoadNoteInput): Promise<NoteDocument>;
  createNote(input?: CreateNoteInput): Promise<NoteDocument>;
  /** Returns the summary WITHOUT content: the caller holds the text it saved (see the renderer's save queue). */
  saveNote(input: SaveNoteInput): Promise<NoteSummary>;
  deleteNote(input: DeleteNoteInput): Promise<void>;
  getNoteTags(input: NoteTagsInput): Promise<string[]>;
  addTagToNote(input: AddTagInput): Promise<string[]>;
  removeTagFromNote(input: RemoveTagInput): Promise<string[]>;
  reorderNoteTags(input: ReorderTagsInput): Promise<string[]>;
  renameTag(input: RenameTagInput): Promise<{ updatedNoteIds: string[] }>;
  listTags(): Promise<TagSummary[]>;
  saveNoteUiState(input: { id: string; payload: NoteUiStatePayload }): Promise<void>;
  getNoteUiState(input: LoadNoteInput): Promise<NoteUiState>;
  updateExternalNoteState(input: { id: string; hasUnsavedChanges: boolean; syncMode: boolean }): Promise<NoteSummaryWithContent>;
  syncExternalNoteToFile(input: { id: string; content: string }): Promise<boolean>;
  getNoteIdByExternalPath(input: { externalPath: string }): Promise<string | null>;
  /** Returns the resulting snapshot's ID -- either newly inserted, or the existing latest one if the content is unchanged (dedup). */
  saveNoteSnapshot(input: { id: string; content: string; isManual?: boolean; isFromDisk?: boolean; timestamp?: string }): Promise<number>;
  getNoteSnapshots(input: LoadNoteInput): Promise<Array<{ id: number; noteId: string; content: string; timestamp: string; isManual: boolean; isFromDisk: boolean }>>;
  /**
   * An external note's baseline: the newest record of what its FILE held
   * (the latest snapshot with isFromDisk), or null if none was ever taken.
   * One row, where getNoteSnapshots returns every snapshot with its full text.
   */
  getFromDiskBaseline(input: LoadNoteInput): Promise<{ content: string; timestamp: string } | null>;
  deleteNoteSnapshot(input: DeleteNoteSnapshotInput): Promise<void>;
  /** A Timeline snapshot's own canonical BLOCK, independent of the live note's -- see docs/editor-contract.md's Viewport Model section. */
  saveSnapshotAnchor(input: { snapshotId: number; anchorBlockIndex: number | null }): Promise<void>;
  getSnapshotAnchor(input: { snapshotId: number }): Promise<number>;
  branchNoteFromSnapshot(input: BranchNoteFromSnapshotInput): Promise<NoteDocument>;
  /** Explicit `$id` assignment. Overwrites any existing ID; resolves collisions with a "-2", "-3", ... suffix. The only way a note's assignedId is ever written -- never auto-assigned as a side effect of anything else (pinning a tab, the auto-generated TOC needing one to link through, ...). */
  setNoteAssignedId(input: { id: string; requestedId: string }): Promise<NoteSummaryWithContent | null>;
  /** Freezes/unfreezes the whole chapter family `id` belongs to -- see databaseService.ts's freezeNoteFamily/unfreezeNoteFamily. */
  setNoteTimeless(input: { id: string; value: boolean }): Promise<NoteSummaryWithContent | null>;
  /** Writes a missing note's file back from the database's copy of its text, together with any of its chapters' that are missing too. */
  restoreMissingNoteFile(input: LoadNoteInput): Promise<void>;
  /** Asks the reader for a file and COPIES it into the notes folder as the missing note's file. False when the reader cancelled. */
  specifyMissingNoteFile(input: LoadNoteInput): Promise<boolean>;
}

export function isArchivedNote(note: NoteSummary): boolean {
  return note.tags.includes('archived')
}

export function isDeletedNote(note: NoteSummary): boolean {
  return note.tags.includes('deleted')
}

/**
 * Whether deleting this note removes it for good rather than moving it to
 * the trash: a note already in the trash, or one whose file is missing --
 * which is as gone as the trash would make it, with only the entry left.
 */
export function isDeletionPermanent(note: NoteSummary): boolean {
  return isDeletedNote(note) || Boolean(note.missingFile)
}

export function isExternalNote(note: NoteSummary): boolean {
  return note.tags.some((tag) => isExternalTagName(tag))
}

export function isChapterOnlyNote(note: NoteSummary): boolean {
  return note.chapterOnly
}

export function isTimelessNote(note: NoteSummary): boolean {
  return note.isTimeless
}

export function isSameNoteSummary(a: NoteSummary, b: NoteSummary): boolean {
  return (
    a.id === b.id &&
    a.fileName === b.fileName &&
    a.title === b.title &&
    a.leadLine === b.leadLine &&
    a.tags.length === b.tags.length &&
    a.tags.every((tag, index) => tag === b.tags[index]) &&
    a.createdAtMs === b.createdAtMs &&
    a.updatedAtMs === b.updatedAtMs &&
    a.sizeBytes === b.sizeBytes &&
    Boolean(a.hasUnsavedChanges) === Boolean(b.hasUnsavedChanges) &&
    (a.assignedId ?? null) === (b.assignedId ?? null) &&
    a.chapterOnly === b.chapterOnly &&
    a.isAutoToc === b.isAutoToc &&
    a.isAutoOpenItems === b.isAutoOpenItems &&
    a.isTimeless === b.isTimeless &&
    a.chapterParentId === b.chapterParentId &&
    (a.detachedChapterParentId ?? null) === (b.detachedChapterParentId ?? null) &&
    (a.chapterId ?? null) === (b.chapterId ?? null) &&
    (a.missingFile?.hasStoredCopy ?? null) === (b.missingFile?.hasStoredCopy ?? null)
  )
}
