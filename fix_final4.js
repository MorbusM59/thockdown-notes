const fs = require('fs');

let code = fs.readFileSync('src/components/MarkdownEditor.tsx', 'utf-8');

// The hooks are here.
let refDeclarationsStr = `  const editHistoryRef = useRef<NoteEditHistoryState>(cloneEmptyEditHistoryState());`;
let refDeclarationsNew = `  const undoStackRef = useRef<EditSnapshot[]>([]);\n  const redoStackRef = useRef<EditSnapshot[]>([]);`;

code = code.replace(refDeclarationsStr, refDeclarationsNew);

let useEffect1Str = `  useEffect(() => {
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

code = code.replace(useEffect1Str, "");

let useEffect2Str = `  useEffect(() => {
    editHistoryRef.current = cloneEmptyEditHistoryState();
    setEditHistoryCount(0);
    pendingHistoryBoundaryRef.current = null;
    lastCommittedSnapshotRef.current = buildSnapshot(content, selectionStart, selectionEnd);
  }, [buildSnapshot, historyResetSignal]);`;

let useEffect2New = `  useEffect(() => {
    undoStackRef.current = [];
    redoStackRef.current = [];
    setEditHistoryCount(0);
    pendingHistoryBoundaryRef.current = null;
    lastCommittedSnapshotRef.current = buildSnapshot(content, selectionStart, selectionEnd);
  }, [buildSnapshot, historyResetSignal]);`;

code = code.replace(useEffect2Str, useEffect2New);

let persistReplaceStr = `  const persistEditHistory = useCallback(async (noteId: number, history: NoteEditHistoryState) => {
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

code = code.replace(persistReplaceStr, "");

let recordHistoryStr = `  const recordHistoryEntry = useCallback((reason: HistoryBoundaryReason, before: EditSnapshot, after: EditSnapshot) => {
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

let recordHistoryNew = `  const pushHistorySnapshot = useCallback((type: 'undo' | 'redo', currentText: string, currentSelectionStart: number, currentSelectionEnd: number) => {
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
  }, [note, commitSnapshotForUndo]);`;

code = code.replace(recordHistoryStr, recordHistoryNew);


let oldUndoRedoStart = code.indexOf("  const handleUndo = useCallback(() => {");
let oldUndoRedoEnd = code.indexOf("  }, [applySnapshotProgrammatically, content, replaceEditHistory]);\n", oldUndoRedoStart);
if (oldUndoRedoEnd > 0) {
  // skip past handleUndo
  oldUndoRedoEnd += 68;
  // find handleRedo end
  let secondEnd = code.indexOf("  }, [applySnapshotProgrammatically, content, replaceEditHistory]);\n", oldUndoRedoEnd);
  if (secondEnd > 0) {
    secondEnd += 68;
    code = code.substring(0, oldUndoRedoStart) + 
`  const handleUndo = useCallback(() => {
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
` + code.substring(secondEnd);
  }
}

// Normalize the file to LF if it wasn't.
code = code.replace(/\r\n/g, '\n');
fs.writeFileSync('src/components/MarkdownEditor.tsx', code);
console.log("Done rewriting.");

