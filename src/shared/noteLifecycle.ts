export const NOTE_LIFECYCLE_CHANNELS = {
  list: 'notes:list',
  load: 'notes:load',
  create: 'notes:create',
  save: 'notes:save',
  remove: 'notes:remove',
} as const;

export interface NoteSummary {
  id: string;
  fileName: string;
  title: string;
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

export interface NoteLifecycleApi {
  listNotes(): Promise<NoteSummary[]>;
  loadNote(input: LoadNoteInput): Promise<NoteDocument>;
  createNote(input?: CreateNoteInput): Promise<NoteDocument>;
  saveNote(input: SaveNoteInput): Promise<NoteSummary>;
  deleteNote(input: DeleteNoteInput): Promise<void>;
}
