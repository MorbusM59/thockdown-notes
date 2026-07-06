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
  branchNoteFromSnapshot: 'notes:branch-from-snapshot',
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
}

export interface DeleteNoteInput {
  id: string;
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

export type NoteUiStatePayload = {
  progressPreview?: number | null;
  progressEdit?: number | null;
  cursorPos?: number | null;
  scrollTop?: number | null;
  sourceAnchorLine?: number | null;
  sourceAnchorText?: string | null;
};

export type NoteUiState = {
  progressPreview: number | null;
  progressEdit: number | null;
  cursorPos: number | null;
  scrollTop: number | null;
  sourceAnchorLine: number | null;
  sourceAnchorText: string | null;
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
  saveNoteSnapshot(input: { id: string; content: string; isManual?: boolean }): Promise<void>;
  getNoteSnapshots(input: LoadNoteInput): Promise<Array<{ id: number; noteId: string; content: string; timestamp: string; isManual: boolean }>>;
  branchNoteFromSnapshot(input: BranchNoteFromSnapshotInput): Promise<NoteDocument>;
}
