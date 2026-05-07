const fs = require('fs');
let code = fs.readFileSync('src/components/MarkdownEditor.tsx', 'utf-8');

const t0 = `import {
  ArchivedParagraphHistoryEntry,
  EditHistoryEntry,
  EditSnapshot,
  Note,
  NoteEditHistoryState,
  RecentEditHistoryEntry,
} from '../shared/types';`;
code = code.replace(t0, `import { EditSnapshot, Note } from '../shared/types';`);

const t1 = `const EMPTY_EDIT_HISTORY_STATE: NoteEditHistoryState = {
  recent: [],
  archived: [],
  redo: [],
  storedChangeCount: 0,
};`;
code = code.replace(t1, ``);

const t2 = `function cloneEmptyEditHistoryState(): NoteEditHistoryState {
  return {
    recent: [],
    archived: [],
    redo: [],
    storedChangeCount: 0,
  };
}

function countLineBreaks(text: string): number {
  return (text.match(/\\n/g) || []).length;
}

function splitTextIntoLines(text: string): string[] {
  return text.split('\\n');
}

function createArchivedParagraphEntry(entry: RecentEditHistoryEntry): ArchivedParagraphHistoryEntry | null {
  if (countLineBreaks(entry.after.content) <= countLineBreaks(entry.before.content)) return null;

  const beforeLines = splitTextIntoLines(entry.before.content);
  const afterLines = splitTextIntoLines(entry.after.content);

  let startLine = 0;
  while (
    startLine < beforeLines.length
    && startLine < afterLines.length
    && beforeLines[startLine] === afterLines[startLine]
  ) {
    startLine += 1;
  }

  let commonSuffix = 0;
  while (
    commonSuffix < (beforeLines.length - startLine)
    && commonSuffix < (afterLines.length - startLine)
    && beforeLines[beforeLines.length - 1 - commonSuffix] === afterLines[afterLines.length - 1 - commonSuffix]
  ) {
    commonSuffix += 1;
  }

  const extractedBefore = beforeLines.slice(startLine, beforeLines.length - commonSuffix);
  const extractedAfter = afterLines.slice(startLine, afterLines.length - commonSuffix);

  return {
    storage: 'archive',
    kind: 'paragraph',
    timestamp: entry.timestamp,
    reason: entry.reason,
    beforeSelection: entry.before,
    afterSelection: entry.after,
    startLine,
    beforeEndLine: beforeLines.length - commonSuffix,
    afterEndLine: afterLines.length - commonSuffix,
    beforeLines: extractedBefore,
    afterLines: extractedAfter,
  };
}

function addRecentHistoryEntry(history: NoteEditHistoryState, entry: RecentEditHistoryEntry): NoteEditHistoryState {
  let nextRecent = [...history.recent, entry];
  let nextArchived = [...history.archived];

  if (nextRecent.length > 50) {
    const oldest = nextRecent[0];
    nextRecent = nextRecent.slice(1);
    const compact = createArchivedParagraphEntry(oldest);
    if (compact) {
      nextArchived.push(compact);
    }
  }

  if (nextArchived.length > 500) {
    const overflow = nextArchived.length - 500;
    nextArchived = nextArchived.slice(overflow);
  }

  return {
    ...history,
    recent: nextRecent,
    archived: nextArchived,
    redo: [],
    storedChangeCount: history.storedChangeCount + 1,
  };
}

function replaceLineRange(lines: string[], startLine: number, endLine: number, newLines: string[]): string[] {
  const next = [...lines];
  next.splice(startLine, endLine - startLine, ...newLines);
  return next;
}

function applyHistoryEntry(currentContent: string, entry: EditHistoryEntry, direction: 'undo' | 'redo'): EditSnapshot {
  if (entry.kind === 'full') {
    return direction === 'undo' ? entry.before : entry.after;
  }

  const currentLines = splitTextIntoLines(currentContent);
  if (direction === 'undo') {
    return {
      content: replaceLineRange(currentLines, entry.startLine, entry.afterEndLine, entry.beforeLines).join('\\n'),
      selectionStart: entry.beforeSelection.selectionStart,
      selectionEnd: entry.beforeSelection.selectionEnd,
    };
  }

  return {
    content: replaceLineRange(currentLines, entry.startLine, entry.beforeEndLine, entry.afterLines).join('\\n'),
    selectionStart: entry.afterSelection.selectionStart,
    selectionEnd: entry.afterSelection.selectionEnd,
  };
}`;
code = code.replace(t2, ``);

const t3 = `const editHistoryRef = useRef<NoteEditHistoryState>(cloneEmptyEditHistoryState());`;
code = code.replace(t3, `const undoStackRef = useRef<EditSnapshot[]>([]);\n  const redoStackRef = useRef<EditSnapshot[]>([]);`);

const t4 = `  const persistEditHistory = useCallback(async (noteId: number, history: NoteEditHistoryState) => {
    try {
      await window.electronAPI.saveNoteEditHistory(noteId, history);
    } catch (err) {
      console.warn('saveNoteEditHistory failed', err);
    }
  }, []);

  const replaceEditHistory = useCallback((nextHistory: NoteEditHistoryState) => {
    editHistoryRef.current = nextHistory;
    setEditHistoryCount(nextHistory.storedChangeCount);
    if (currentNoteIdRef.current != null) {
      void persistEditHistory(currentNoteIdRef.current, nextHistory);
    }
  }, [persistEditHistory]);`;
code = code.replace(t4, ``);

const t5 = `  const recordHistoryEntry = useCallback((reason: HistoryBoundaryReason, before: EditSnapshot, after: EditSnapshot) => {
    if (!note || before.content === after.content) {
      lastCommittedSnapshotRef.current = after;
      return;
    }

    const nextHistory = addRecentHistoryEntry(editHistoryRef.current, {
      storage: 'recent',
      kind: 'full',
      reason,
      before,
      after,
      timestamp: new Date().toISOString(),
    });
    replaceEditHistory(nextHistory);
    lastCommittedSnapshotRef.current = after;
  }, [note, replaceEditHistory]);`;
code = code.replace(t5, `  const pushHistorySnapshot = useCallback((type: 'undo' | 'redo', currentText: string, currentSelectionStart: number, currentSelectionEnd: number) => {
    const stack = type === 'undo' ? undoStackRef.current : redoStackRef.current;
    stack.push({ content: currentText, selectionStart: currentSelectionStart, selectionEnd: currentSelectionEnd });
    if (stack.length > 50) stack.shift();
    setEditHistoryCount((prev) => prev + 1);
  }, []);

  const commitSnapshotForUndo = useCallback((currentText: string, currentSelectionStart: number, currentSelectionEnd: number) => {
    redoStackRef.current = [];
    pushHistorySnapshot('undo', currentText, currentSelectionStart, currentSelectionEnd);
  }, [pushHistorySnapshot]);

  const recordHistoryEntry = useCallback((reason: HistoryBoundaryReason, before: EditSnapshot, after: EditSnapshot) => {
    if (!note || before.content === after.content) {
      lastCommittedSnapshotRef.current = after;
      return;
    }
    commitSnapshotForUndo(before.content, before.selectionStart, before.selectionEnd);
    lastCommittedSnapshotRef.current = after;
  }, [note, commitSnapshotForUndo]);`);

const t6 = `  useEffect(() => {
    if (!note) {
      editHistoryRef.current = cloneEmptyEditHistoryState();
      setEditHistoryCount(0);
      pendingHistoryBoundaryRef.current = null;
      lastCommittedSnapshotRef.current = { content: '', selectionStart: 0, selectionEnd: 0 };
      return;
    }

    const noteId = note.id;
    let isCancelled = false;
    void window.electronAPI.getNoteEditHistory(noteId).then((history) => {
      if (isCancelled) return;
      const normalizedHistory = history ?? cloneEmptyEditHistoryState();
      editHistoryRef.current = normalizedHistory;
      setEditHistoryCount(normalizedHistory.storedChangeCount ?? 0);
    }).catch((err) => {
      console.warn('getNoteEditHistory failed', err);
      if (isCancelled) return;
      editHistoryRef.current = cloneEmptyEditHistoryState();
      setEditHistoryCount(0);
    });

    return () => {
      isCancelled = true;
    };
  }, [note]);`;
code = code.replace(t6, '');

const t7 = `  useEffect(() => {
    editHistoryRef.current = cloneEmptyEditHistoryState();
    setEditHistoryCount(0);
    pendingHistoryBoundaryRef.current = null;
    lastCommittedSnapshotRef.current = buildSnapshot(content, selectionStart, selectionEnd);
  }, [buildSnapshot, historyResetSignal]);`;
code = code.replace(t7, `  useEffect(() => {
    undoStackRef.current = [];
    redoStackRef.current = [];
    setEditHistoryCount(0);
    pendingHistoryBoundaryRef.current = null;
    lastCommittedSnapshotRef.current = buildSnapshot(content, selectionStart, selectionEnd);
  }, [buildSnapshot, historyResetSignal]);`);

const undoStart = code.indexOf('  const handleUndo = useCallback(() => {');
const undoEnd = code.indexOf('  useEffect(() => {', undoStart);
const newUndoRedo = `  const handleUndo = useCallback(() => {
    if (undoStackRef.current.length === 0) return;
    pushHistorySnapshot('redo', content, selectionStart, selectionEnd);
    const prev = undoStackRef.current.pop()!;
    applySnapshotProgrammatically(prev);
    setEditHistoryCount(prevCount => prevCount + 1);
  }, [applySnapshotProgrammatically, content, selectionStart, selectionEnd, pushHistorySnapshot]);

  const handleRedo = useCallback(() => {
    if (redoStackRef.current.length === 0) return;
    pushHistorySnapshot('undo', content, selectionStart, selectionEnd);
    const next = redoStackRef.current.pop()!;
    applySnapshotProgrammatically(next);
    setEditHistoryCount(prevCount => prevCount + 1);
  }, [applySnapshotProgrammatically, content, selectionStart, selectionEnd, pushHistorySnapshot]);

`;
code = code.substring(0, undoStart) + newUndoRedo + code.substring(undoEnd);

fs.writeFileSync('src/components/MarkdownEditor.tsx', code);

let appStr = fs.readFileSync('src/components/App.tsx', 'utf-8');
const ah1 = appStr.indexOf('const handleClearCurrentHistory = async () => {');
const ae1 = appStr.indexOf('const handleClearAllHistory = async () => {', ah1);
appStr = appStr.substring(0, ah1) + 'const handleClearCurrentHistory = async () => {};\n\n  ' + appStr.substring(ae1);
const ah2 = appStr.indexOf('const handleClearAllHistory = async () => {');
const ae2 = appStr.indexOf('const handleDeleteNote = async (id: number) => {', ah2);
appStr = appStr.substring(0, ah2) + 'const handleClearAllHistory = async () => {};\n\n  ' + appStr.substring(ae2);
fs.writeFileSync('src/components/App.tsx', appStr);

let idx = fs.readFileSync('src/index.ts', 'utf-8');
idx = idx.replace(/saveNoteEditHistory,\s*getNoteEditHistory,\s*clearNoteEditHistory,\s*clearAllNoteEditHistories,/, '');
idx = idx.replace(/ipcMain\.handle\('save-note-edit-history'[\s\S]*?\\n/, '');
idx = idx.replace(/ipcMain\.handle\('get-note-edit-history'[\s\S]*?\\n/, '');
idx = idx.replace(/ipcMain\.handle\('clear-note-edit-history'[\s\S]*?\\n/, '');
idx = idx.replace(/ipcMain\.handle\('clear-all-note-edit-histories'[\s\S]*?\\n/, '');
fs.writeFileSync('src/index.ts', idx);

let db = fs.readFileSync('src/main/database.ts', 'utf-8');
db = db.replace(/,\s*NoteEditHistoryState/, '');
fs.writeFileSync('src/main/database.ts', db);

let pre = fs.readFileSync('src/preload.ts', 'utf-8');
pre = pre.replace(/,\s*NoteEditHistoryState/, '');
pre = pre.replace(/saveNoteEditHistory:[\s\S]*?\\),/, '');
pre = pre.replace(/getNoteEditHistory:[\s\S]*?\\),/, '');
pre = pre.replace(/clearNoteEditHistory:[\s\S]*?\\),/, '');
pre = pre.replace(/clearAllNoteEditHistories:[\s\S]*?\\),/, '');
fs.writeFileSync('src/preload.ts', pre);

console.log('Fixed everything.');
