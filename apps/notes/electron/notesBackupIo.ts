// verify: reads-temp (scripts/verify.mjs, "what a module reads from disk")
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { DatabaseService } from './databaseService';
import type { NoteLifecycleService } from './noteLifecycleService';
import {
  BACKUP_MANIFEST_NAME, exportNoteText, IMAGE_IDS, importNoteText, NOTE_IDS, parseBackupManifest, planBackup,
  renameReferences, resolveImportIds, usedImagesIn, type ImportConflictMode, type ManifestChapter,
} from '../src/shared/notesBackup';
import type { BackupImportResult } from '../src/shared/fileSync';

/**
 * Writes and reads the Markdown backup laid out by src/shared/notesBackup.ts:
 * the planner and the resolver decide everything, this file only moves bytes
 * between them, the database and the disk.
 */

const normalize = (text: string) => text.replace(/\r\n?/g, '\n');

/** Writes every note and image into `root` (a new folder) with the manifest. */
export async function writeBackup(root: string, db: DatabaseService): Promise<void> {
  const records = db.listNoteRecords();
  const tagsOf = new Map(records.map((record) => [record.id, db.getNoteTags(record.id)]));
  const notes = records.map((record) => ({
    id: record.id,
    assignedId: record.assignedId,
    tags: tagsOf.get(record.id)!,
    createdAtMs: record.createdAtMs,
    updatedAtMs: record.updatedAtMs,
    isTimeless: record.isTimeless,
    isGenerated: record.isAutoToc || record.isAutoOpenItems,
  }));
  const chapters = [...new Set(records.map((record) => record.chapterParentId).filter((id): id is string => Boolean(id)))]
    .flatMap((parentId) => db.listChaptersForNote(parentId));
  const texts = new Map(records.map((record) => [record.id, db.readStoredNoteContent(record.id) ?? '']));
  const usedImageIds = new Set<string>();
  for (const record of records) {
    if (record.isTimeless || tagsOf.get(record.id)!.includes('deleted')) continue;
    for (const id of usedImagesIn(texts.get(record.id)!)) usedImageIds.add(id);
  }
  const aliases = db.listImageAliases();
  const stored = db.listImages();
  const plan = planBackup({
    notes,
    chapters,
    images: stored.map((image) => ({
      id: image.id, mime: image.mime, tags: image.tags, origin: image.origin, createdAt: image.createdAt, aliases: aliases.get(image.id) ?? [],
    })),
    usedImageIds,
    exportedAt: new Date().toISOString(),
  });

  const write = async (file: string, data: string | Buffer) => {
    const outPath = path.join(root, ...file.split('/'));
    await fs.mkdir(path.dirname(outPath), { recursive: true });
    await fs.writeFile(outPath, data);
  };
  const imageFileById = new Map(plan.imageFiles.map((entry) => [entry.imageId, entry.file]));
  const hashOf = new Map(stored.map((image) => [image.id, image.hash]));
  for (const entry of plan.imageFiles) {
    const blob = db.readImageBlob(hashOf.get(entry.imageId)!);
    if (blob) await write(entry.file, blob.data);
  }
  for (const entry of plan.noteFiles) {
    await write(entry.file, exportNoteText(texts.get(entry.noteId) ?? '', entry.file, imageFileById));
  }
  await write(BACKUP_MANIFEST_NAME, `${JSON.stringify(plan.manifest, null, 2)}\n`);
}

/**
 * Reads the backup whose manifest is `manifestPath` into the database.
 * Notes open in an editor are not rewritten here: their renames come back in
 * the result and the renderer applies them as edits, the way an image rename
 * reaches an open note (imageLibraryStore.ts's renameImage).
 */
export async function readBackup(
  manifestPath: string,
  options: { mode: ImportConflictMode; openNoteIds: readonly string[] },
  db: DatabaseService,
  lifecycle: NoteLifecycleService,
): Promise<BackupImportResult> {
  const root = path.dirname(manifestPath);
  const errors: string[] = [];
  const manifest = parseBackupManifest(JSON.parse(await fs.readFile(manifestPath, 'utf8')), new Date().toISOString());
  if (!manifest) throw new Error(`${path.basename(manifestPath)} is not a backup this version can read`);
  const fileOf = (file: string) => {
    const resolved = path.resolve(root, ...file.split('/'));
    if (!resolved.startsWith(root + path.sep)) throw new Error(`${file} lies outside the backup`);
    return resolved;
  };

  // Images first: the notes' texts are read back against their files.
  const images: Array<{ entry: (typeof manifest.images)[number]; bytes: Buffer; hash: string }> = [];
  for (const entry of manifest.images) {
    try {
      const bytes = await fs.readFile(fileOf(entry.file));
      images.push({ entry, bytes, hash: createHash('sha256').update(bytes).digest('hex') });
    } catch (error) {
      errors.push(`${entry.file}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  const imageIdByFile = new Map(images.map(({ entry }) => [entry.file, entry.id]));
  const readNote = async (file: string): Promise<string | null> => {
    try {
      return importNoteText(normalize(await fs.readFile(fileOf(file), 'utf8')), file, imageIdByFile);
    } catch (error) {
      errors.push(`${file}: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  };
  const notes: Array<{ entry: (typeof manifest.notes)[number]; text: string; chapters: Array<{ entry: ManifestChapter; text: string }> }> = [];
  for (const entry of manifest.notes) {
    const text = await readNote(entry.file);
    if (text === null) continue;
    const chapters: Array<{ entry: ManifestChapter; text: string }> = [];
    for (const chapter of entry.chapters) {
      const chapterText = await readNote(chapter.file);
      if (chapterText !== null) chapters.push({ entry: chapter, text: chapterText });
    }
    notes.push({ entry, text, chapters });
  }

  // Ids.
  const storedImages = db.listImages();
  const imageHash = new Map(storedImages.map((image) => [image.id, image.hash]));
  const incomingHash = new Map(images.map((image) => [image.entry.file, image.hash]));
  const imageResolution = resolveImportIds({
    incoming: images.map(({ entry }) => ({ key: entry.file, id: entry.id })),
    existing: new Set(imageHash.keys()),
    mode: options.mode,
    namespace: IMAGE_IDS,
    isIdentical: (file, id) => imageHash.get(id) === incomingHash.get(file),
  });
  const records = db.listNoteRecords();
  const recordByAssignedId = new Map(records.filter((record) => record.assignedId).map((record) => [record.assignedId!.toUpperCase(), record]));
  const noteByFile = new Map(notes.map((note) => [note.entry.file, note]));
  const withIds = notes.filter((note) => note.entry.id !== null);
  const noteResolution = resolveImportIds({
    incoming: withIds.map((note) => ({ key: note.entry.file, id: note.entry.id! })),
    existing: new Set(recordByAssignedId.keys()),
    mode: options.mode,
    namespace: NOTE_IDS,
    isIdentical: (file, id) => {
      const record = recordByAssignedId.get(id);
      const incoming = noteByFile.get(file);
      return Boolean(record && incoming && normalize(db.readStoredNoteContent(record.id) ?? '') === incoming.text);
    },
  });

  // Existing items renamed out of the way, with every reference to them in
  // the notes no editor holds.
  const open = new Set(options.openNoteIds);
  const renamedImages: Array<[string, string]> = [];
  for (const [from, to] of imageResolution.existingRenames) {
    const result = db.renameImage({ id: from, newId: to, openNoteIds: [...open] });
    if (result.ok) renamedImages.push([from, result.id]);
    else errors.push(`${from}: could not be renamed (${result.reason})`);
  }
  const renamedNotes: Array<[string, string]> = [];
  for (const [from, to] of noteResolution.existingRenames) {
    const record = recordByAssignedId.get(from)!;
    if (record.isTimeless) {
      errors.push(`${from}: belongs to the User Guide and keeps its id`);
      continue;
    }
    renamedNotes.push([from, db.setNoteAssignedId(record.id, to)]);
  }
  if (renamedNotes.length > 0) {
    const renames = new Map(renamedNotes);
    for (const record of db.listNoteRecords()) {
      if (open.has(record.id) || record.isTimeless || record.isTemp) continue;
      const text = db.readStoredNoteContent(record.id);
      if (text === null) continue;
      const next = renameReferences(text, renames, new Map());
      if (next !== text) db.upsertNoteContent({ ...record, text: next, externalPath: record.externalPath });
    }
  }

  // The incoming images.
  let importedImages = 0;
  for (const { entry, bytes } of images) {
    const resolved = imageResolution.incoming.get(entry.file);
    if (!resolved || resolved.skip) continue;
    const stored = db.importImage({ bytes: new Uint8Array(bytes), origin: entry.origin, requestedId: resolved.id });
    if (!stored.ok) {
      errors.push(`${entry.file}: ${stored.reason}`);
      continue;
    }
    db.setImageTags(stored.id, entry.tags);
    if (entry.tags.includes('deleted')) db.setImageTrashed(stored.id, true);
    db.addImageAliases(stored.id, entry.aliases);
    importedImages += 1;
  }

  // The incoming notes, their references following every incoming rename.
  const noteRenames = noteResolution.incomingRenames;
  const imageRenames = imageResolution.incomingRenames;
  const createdNoteIds: string[] = [];
  let skipped = 0;
  const restore = (id: string, tags: readonly string[], text: string, createdAt: string, updatedAt: string) => {
    tags.filter((tag) => tag !== 'external').forEach((tag, index) => db.addTagToNote(id, tag, index));
    const record = db.getNoteRecord(id)!;
    db.upsertNoteContent({ id, title: record.title, text, createdAtMs: Date.parse(createdAt), updatedAtMs: Date.parse(updatedAt) });
  };
  for (const note of notes) {
    const resolved = note.entry.id === null ? null : noteResolution.incoming.get(note.entry.file)!;
    let parentId: string;
    if (resolved?.skip) {
      parentId = recordByAssignedId.get(resolved.id)!.id;
      skipped += 1;
    } else {
      const text = renameReferences(note.text, noteRenames, imageRenames);
      const created = await lifecycle.createNote({ initialText: text });
      if (resolved) db.setNoteAssignedId(created.id, resolved.id);
      restore(created.id, note.entry.tags, text, note.entry.createdAt, note.entry.updatedAt);
      createdNoteIds.push(created.id);
      parentId = created.id;
    }
    const existingChapters = resolved?.skip ? db.listChaptersForNote(parentId) : [];
    for (const chapter of note.chapters) {
      const text = renameReferences(chapter.text, noteRenames, imageRenames);
      const same = existingChapters.find((entry) => entry.chapterId === chapter.entry.chapterId);
      if (same && normalize(db.readStoredNoteContent(same.chapterNoteId) ?? '') === text) continue;
      const created = await lifecycle.createNote({ initialText: text }, { skipAutoToc: true, skipProvisionalId: true });
      db.setNoteChapterOnly(created.id, true);
      db.addChapter(parentId, created.id);
      if (chapter.entry.chapterId) db.setChapterId(parentId, created.id, chapter.entry.chapterId);
      restore(created.id, chapter.entry.tags, text, chapter.entry.createdAt, chapter.entry.updatedAt);
      createdNoteIds.push(created.id);
    }
  }

  return {
    imported: createdNoteIds.length,
    createdNoteIds,
    importedImages,
    skipped,
    renamedNotes,
    renamedImages,
    errors,
  };
}
