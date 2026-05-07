const fs = require('fs');
let code = fs.readFileSync('src/components/MarkdownEditor.tsx', 'utf-8');

// Insert UndoEntry
const editStateStr = `type EditState = {
  selectionStart: number;
  scrollTop: number;
  viewportStartRow?: number;
};`;

const insertTypes = `\ntype UndoEntry = {
  type: 'char' | 'paste' | 'bundled';
  snapshot: EditSnapshot;
  diff: number;
};

const MAX_UNDO_CHARS = 1000;`;

code = code.replace(editStateStr, editStateStr + insertTypes);

// Replace refs
const refOld = `  const editHistoryRef = useRef<NoteEditHistoryState>(cloneEmptyEditHistoryState());`;
const refNew = `  const undoStackRef = useRef<UndoEntry[]>([]);
  const redoStackRef = useRef<UndoEntry[]>([]);
  const undoTotalDiffRef = useRef(0);`;

code = code.replace(refOld, refNew);

// Replace block of persistence correctly
const effect1 = `  useEffect(() => {
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

code = code.replace(effect1, "");

const effect2 = `  useEffect(() => {
    editHistoryRef.current = cloneEmptyEditHistoryState();
    setEditHistoryCount(0);
    pendingHistoryBoundaryRef.current = null;
    lastCommittedSnapshotRef.current = buildSnapshot(content, selectionStart, selectionEnd);
  }, [buildSnapshot, historyResetSignal]);`;

const effect2New = `  useEffect(() => {
    undoStackRef.current = [];
    redoStackRef.current = [];
    undoTotalDiffRef.current = 0;
    setEditHistoryCount(0);
    pendingHistoryBoundaryRef.current = null;
    lastCommittedSnapshotRef.current = buildSnapshot(content, selectionStart, selectionEnd);
  }, [buildSnapshot, historyResetSignal]);`;

code = code.replace(effect2, effect2New);

const persistStr = `  const persistEditHistory = useCallback(async (noteId: number, history: NoteEditHistoryState) => {
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

code = code.replace(persistStr, "");

fs.writeFileSync('src/components/MarkdownEditor.tsx', code);
console.log('step2b done');
