const fs = require('fs');
let code = fs.readFileSync('src/components/MarkdownEditor.tsx', 'utf-8');

const recordStr = `  const recordHistoryEntry = useCallback((reason: HistoryBoundaryReason, before: EditSnapshot, after: EditSnapshot) => {
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

const pushNew = `  const pushHistorySnapshot = useCallback((
    targetStack: 'undo' | 'redo',
    type: 'char' | 'paste' | 'bundled',
    snapshot: EditSnapshot,
    diff: number
  ) => {
    const stack = targetStack === 'undo' ? undoStackRef.current : redoStackRef.current;
    stack.push({ type, snapshot, diff });
    
    if (targetStack === 'undo') {
      undoTotalDiffRef.current += diff;
      while (undoTotalDiffRef.current > MAX_UNDO_CHARS && stack.length > 1) {
        const removed = stack.shift()!;
        undoTotalDiffRef.current -= removed.diff;
      }
    } else {
      if (stack.length > 50) stack.shift();
    }
    setEditHistoryCount(undoStackRef.current.length + redoStackRef.current.length);
  }, []);

  const commitSnapshotForUndo = useCallback((currentText: string, currentSelectionStart: number, currentSelectionEnd: number, type: 'char' | 'paste' | 'bundled' = 'bundled', diff?: number) => {
    redoStackRef.current = [];
    const calculatedDiff = diff !== undefined ? diff : Math.abs(currentText.length - lastCommittedSnapshotRef.current.content.length);
    pushHistorySnapshot('undo', type, buildSnapshot(currentText, currentSelectionStart, currentSelectionEnd), calculatedDiff);
  }, [pushHistorySnapshot, buildSnapshot]);

  const recordHistoryEntry = useCallback((reason: HistoryBoundaryReason, before: EditSnapshot, after: EditSnapshot) => {
    if (!note || before.content === after.content) {
      lastCommittedSnapshotRef.current = after;
      return;
    }
    const type = reason === 'paste' ? 'paste' : 'bundled';
    const diff = Math.abs(after.content.length - before.content.length);
    commitSnapshotForUndo(before.content, before.selectionStart, before.selectionEnd, type, diff);
    lastCommittedSnapshotRef.current = after;
  }, [note, commitSnapshotForUndo]);`;

code = code.replace(recordStr, pushNew);

const oldUndo = `  const handleUndo = useCallback(() => {
    if (!note) return;
    const history = editHistoryRef.current;
    if (history.recent.length === 0) return;

    const entryToUndo = history.recent[history.recent.length - 1];
    const prevHistory = {
      ...history,
      recent: history.recent.slice(0, -1),
      redo: [entryToUndo, ...history.redo],
    };

    const revertedSnapshot = applyHistoryEntry(content, entryToUndo, 'undo');
    applySnapshotProgrammatically(revertedSnapshot);
    replaceEditHistory(prevHistory);
  }, [applySnapshotProgrammatically, content, note, replaceEditHistory]);`;

const oldRedo = `  const handleRedo = useCallback(() => {
    if (!note) return;
    const history = editHistoryRef.current;
    if (history.redo.length === 0) return;

    const entryToRedo = history.redo[0];
    const nextHistory = {
      ...history,
      recent: [...history.recent, entryToRedo],
      redo: history.redo.slice(1),
    };

    const advancedSnapshot = applyHistoryEntry(content, entryToRedo, 'redo');
    applySnapshotProgrammatically(advancedSnapshot);
    replaceEditHistory(nextHistory);
  }, [applySnapshotProgrammatically, content, note, replaceEditHistory]);`;


const newUndoRedo = `  const handleUndo = useCallback(() => {
    if (undoStackRef.current.length === 0) return;
    const prev = undoStackRef.current.pop()!;
    undoTotalDiffRef.current -= prev.diff;
    pushHistorySnapshot('redo', prev.type, buildSnapshot(content, selectionStart, selectionEnd), prev.diff);
    applySnapshotProgrammatically(prev.snapshot);
    setEditHistoryCount(undoStackRef.current.length + redoStackRef.current.length);
  }, [applySnapshotProgrammatically, content, selectionStart, selectionEnd, pushHistorySnapshot, buildSnapshot]);

  const handleRedo = useCallback(() => {
    if (redoStackRef.current.length === 0) return;
    const next = redoStackRef.current.pop()!;
    pushHistorySnapshot('undo', next.type, buildSnapshot(content, selectionStart, selectionEnd), next.diff);
    applySnapshotProgrammatically(next.snapshot);
    setEditHistoryCount(undoStackRef.current.length + redoStackRef.current.length);
  }, [applySnapshotProgrammatically, content, selectionStart, selectionEnd, pushHistorySnapshot, buildSnapshot]);`;

code = code.replace(oldUndo, newUndoRedo);
code = code.replace(oldRedo, "");

fs.writeFileSync('src/components/MarkdownEditor.tsx', code);
console.log('step2d done');
