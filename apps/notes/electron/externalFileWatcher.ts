import { watch, type FSWatcher } from 'node:fs';
import path from 'node:path';

/**
 * Tells the window when the file behind an open external note changes on
 * disk, so the note can be reconciled with it (src/shared/externalFileReconcile.ts)
 * while the reader is looking at it rather than only when they next save.
 *
 * Watches the file's DIRECTORY and filters by name, not the file itself:
 * most editors save by writing a temporary file and renaming it over the
 * original, which replaces the inode a watch on the file is attached to, so
 * a file watch goes silent after the first such save.
 *
 * One change to a file arrives as several events (a write in chunks, a
 * rename and a change, one per stream flush), and a read in the middle of a
 * chunked write sees half a file. So a note's events are coalesced: it is
 * reported once, `settleMs` after its LAST event. That only spares the
 * reconciliation work it would otherwise repeat; reconciling is idempotent
 * and reaches a fixed point from any read, so a report that still lands
 * mid-write is followed by another that sees the finished file.
 */
/**
 * A file name as the directory's watch matches it. Windows and macOS file
 * systems ignore case by default, so a note's stored path may spell the name
 * differently from the event, which reports it as it is on disk.
 */
const nameKey = process.platform === 'win32' || process.platform === 'darwin'
  ? (name: string) => name.toLowerCase()
  : (name: string) => name;

export class ExternalFileWatcher {
  private readonly watchers = new Map<string, { directory: string; watcher: FSWatcher; names: Map<string, Set<string>> }>();
  private readonly pathByNote = new Map<string, string>();
  private readonly pending = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(
    private readonly onChanged: (noteId: string) => void,
    private readonly settleMs = 150,
  ) {}

  /** Watches exactly these notes' files, and stops watching every other. */
  setWatched(entries: ReadonlyArray<{ noteId: string; filePath: string }>): void {
    const wanted = new Map(entries.map((entry) => [entry.noteId, path.resolve(entry.filePath)]));
    for (const [noteId, filePath] of [...this.pathByNote]) {
      if (wanted.get(noteId) !== filePath) this.unwatch(noteId);
    }
    for (const [noteId, filePath] of wanted) {
      if (!this.pathByNote.has(noteId)) this.watchNote(noteId, filePath);
    }
  }

  dispose(): void {
    this.setWatched([]);
  }

  private watchNote(noteId: string, filePath: string): void {
    const directory = path.dirname(filePath);
    const name = nameKey(path.basename(filePath));
    let entry = this.watchers.get(directory);
    if (!entry) {
      let watcher: FSWatcher;
      try {
        watcher = watch(directory, { persistent: false }, (_event, changed) => this.handle(directory, changed));
      } catch (error) {
        // A directory that cannot be watched (gone, no permission, a file
        // system without notifications) leaves the note to be reconciled
        // when it is next opened or saved, as before.
        console.warn('[external-files] cannot watch directory', { directory, error });
        return;
      }
      watcher.on('error', (error) => {
        // A failed watch (the directory deleted, the volume gone) delivers
        // nothing more. Forgotten entirely, so the next `setWatched` that
        // names these notes builds a new one rather than reusing the dead one.
        console.warn('[external-files] directory watch failed', { directory, error });
        this.forgetDirectory(directory);
      });
      entry = { directory, watcher, names: new Map() };
      this.watchers.set(directory, entry);
    }
    const notes = entry.names.get(name) ?? new Set<string>();
    notes.add(noteId);
    entry.names.set(name, notes);
    this.pathByNote.set(noteId, filePath);
  }

  private forgetDirectory(directory: string): void {
    const entry = this.watchers.get(directory);
    if (!entry) return;
    for (const notes of [...entry.names.values()]) {
      for (const noteId of [...notes]) this.unwatch(noteId);
    }
    // unwatch closed it once its last note went; a directory with none left
    // is closed here.
    if (this.watchers.get(directory) === entry) {
      entry.watcher.close();
      this.watchers.delete(directory);
    }
  }

  private unwatch(noteId: string): void {
    const filePath = this.pathByNote.get(noteId);
    if (filePath === undefined) return;
    this.pathByNote.delete(noteId);
    const timer = this.pending.get(noteId);
    if (timer !== undefined) clearTimeout(timer);
    this.pending.delete(noteId);
    const entry = this.watchers.get(path.dirname(filePath));
    if (!entry) return;
    const name = nameKey(path.basename(filePath));
    const notes = entry.names.get(name);
    notes?.delete(noteId);
    if (notes && notes.size === 0) entry.names.delete(name);
    if (entry.names.size === 0) {
      entry.watcher.close();
      this.watchers.delete(entry.directory);
    }
  }

  private handle(directory: string, changed: string | Buffer | null): void {
    const entry = this.watchers.get(directory);
    if (!entry) return;
    // Some platforms omit the name; then any watched file here may be it.
    const names = changed === null ? [...entry.names.keys()] : [nameKey(changed.toString())];
    for (const name of names) {
      for (const noteId of entry.names.get(name) ?? []) {
        const previous = this.pending.get(noteId);
        if (previous !== undefined) clearTimeout(previous);
        this.pending.set(noteId, setTimeout(() => {
          this.pending.delete(noteId);
          this.onChanged(noteId);
        }, this.settleMs));
      }
    }
  }
}
