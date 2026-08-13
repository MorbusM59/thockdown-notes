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
  deleteNoteSnapshot: 'notes:delete-note-snapshot',
  saveSnapshotAnchor: 'notes:save-snapshot-anchor',
  getSnapshotAnchor: 'notes:get-snapshot-anchor',
  branchNoteFromSnapshot: 'notes:branch-from-snapshot',
  setAssignedId: 'notes:set-internal-id',
  ensureAssignedId: 'notes:ensure-internal-id',
} as const;

export interface NoteSummary {
  id: string;
  fileName: string;
  title: string;
  tags: string[];
  contentText?: string;
  createdAtMs: number;
  updatedAtMs: number;
  sizeBytes: number;
  isExternal?: boolean;
  externalPath?: string | null;
  hasUnsavedChanges?: boolean;
  isInSync?: boolean;
  /** User-assignable tab-bar label. Null until first assigned (explicitly via `$id`, or lazily defaulted). */
  assignedId?: string | null;
  /** True for a note created only to be a chapter (via the chapter bar's "+" button, or cloned from a note dragged onto a chapter bar) -- excluded from every menu view (date/category/archive/trash), only ever shown through its parent's chapter bar. Never true for a note that can also stand on its own. */
  chapterOnly: boolean;
  /** True for the one chapter (if any) that's the auto-generated table of contents for its parent's whole chapter family -- see databaseService.ts's `isAutoToc` column doc comment. Always false for a non-chapter note. */
  isAutoToc: boolean;
  /** True for the one chapter (if any) that's the auto-generated Open Items list for its parent's whole chapter family -- see databaseService.ts's `isAutoOpenItems` column doc comment. Always false for a non-chapter note. */
  isAutoOpenItems: boolean;
  /** The single note this note is a chapter of, or null when it isn't (any) chapter. A `chapterOnly` note always has a non-null parent; a regular note is always null (regular notes can never become chapters). */
  chapterParentId: string | null;
}

export interface NoteDocument extends NoteSummary {
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
  listNotes(): Promise<NoteSummary[]>;
  loadNote(input: LoadNoteInput): Promise<NoteDocument>;
  createNote(input?: CreateNoteInput): Promise<NoteDocument>;
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
  updateExternalNoteState(input: { id: string; hasUnsavedChanges: boolean; syncMode: boolean }): Promise<NoteSummary>;
  syncExternalNoteToFile(input: { id: string; content: string }): Promise<boolean>;
  getNoteIdByExternalPath(input: { externalPath: string }): Promise<string | null>;
  /** Returns the resulting snapshot's ID -- either newly inserted, or the existing latest one if the content is unchanged (dedup). */
  saveNoteSnapshot(input: { id: string; content: string; isManual?: boolean }): Promise<number>;
  getNoteSnapshots(input: LoadNoteInput): Promise<Array<{ id: number; noteId: string; content: string; timestamp: string; isManual: boolean }>>;
  deleteNoteSnapshot(input: DeleteNoteSnapshotInput): Promise<void>;
  /** A Timeline snapshot's own canonical BLOCK, independent of the live note's -- see docs/editor-contract.md's Viewport Model section. */
  saveSnapshotAnchor(input: { snapshotId: number; anchorBlockIndex: number | null }): Promise<void>;
  getSnapshotAnchor(input: { snapshotId: number }): Promise<number>;
  branchNoteFromSnapshot(input: BranchNoteFromSnapshotInput): Promise<NoteDocument>;
  /** Explicit `$id` assignment. Overwrites any existing ID; resolves collisions with a "-2", "-3", ... suffix. */
  setNoteAssignedId(input: { id: string; requestedId: string }): Promise<NoteSummary | null>;
  /** Lazily assigns + returns the default ID (first 8 chars of title) if the note doesn't have one yet. */
  ensureNoteAssignedId(input: { id: string }): Promise<string | null>;
}

export function isArchivedNote(note: NoteSummary): boolean {
  return note.tags.includes('archived')
}

export function isDeletedNote(note: NoteSummary): boolean {
  return note.tags.includes('deleted')
}

export function isExternalNote(note: NoteSummary): boolean {
  return note.tags.some((tag) => isExternalTagName(tag))
}

export function isChapterOnlyNote(note: NoteSummary): boolean {
  return note.chapterOnly
}

export function isSameNoteSummary(a: NoteSummary, b: NoteSummary): boolean {
  return (
    a.id === b.id &&
    a.fileName === b.fileName &&
    a.title === b.title &&
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
    a.chapterParentId === b.chapterParentId
  )
}
