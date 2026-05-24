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
} as const;

export interface NoteSummary {
  id: string;
  fileName: string;
  title: string;
  tags: string[];
  createdAtMs: number;
  updatedAtMs: number;
  sizeBytes: number;
}

export interface NoteDocument extends NoteSummary {
  text: string;
}

export interface CreateNoteInput {
  initialText?: string;
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

export interface TagSummary {
  name: string;
  usageCount: number;
}

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
}
