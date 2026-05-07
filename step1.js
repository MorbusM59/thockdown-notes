const fs = require('fs');
let code = fs.readFileSync('src/components/MarkdownEditor.tsx', 'utf-8').replace(/\r\n/g, '\n');

// Update refs
const refOld = `const programmaticInsertRef = useRef(false);
  const undoStackRef = useRef<EditSnapshot[]>([]);
  const redoStackRef = useRef<EditSnapshot[]>([]);
  const lastCommittedSnapshotRef = useRef<EditSnapshot>({ content: '', selectionStart: 0, selectionEnd: 0 });`;
const refNew = `const programmaticInsertRef = useRef(false);
  const undoStackRef = useRef<UndoEntry[]>([]);
  const redoStackRef = useRef<UndoEntry[]>([]);
  const undoTotalDiffRef = useRef(0);
  const lastCommittedSnapshotRef = useRef<EditSnapshot>({ content: '', selectionStart: 0, selectionEnd: 0 });`;

code = code.replace(refOld, refNew);

// Replace pushHistorySnapshot
const pushOldStart = `const pushHistorySnapshot = useCallback((type: 'undo' | 'redo', currentText: string, currentSelectionStart: number, currentSelectionEnd: number) => {`;
const pushOldEndStr = `setEditHistoryCount((prev) => prev + 1);\n  }, []);`;
const pushOldEnd = code.indexOf(pushOldEndStr, code.indexOf(pushOldStart)) + pushOldEndStr.length;

if (code.indexOf(pushOldStart) > -1) {
  const pushNew = `const pushHistorySnapshot = useCallback((
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

  // Actually commitSnapshotForUndo and recordHistoryEntry follow pushHistorySnapshot in old code, let's just replace the whole block!
  const fullOldEndStr = `  }, [note, commitSnapshotForUndo]);`;
  const fullOldEnd = code.indexOf(fullOldEndStr, code.indexOf(pushOldStart)) + fullOldEndStr.length;
  code = code.substring(0, code.indexOf(pushOldStart)) + pushNew + code.substring(fullOldEnd);
}

// Resetting stacks in useEffect
const resetOld = `  useEffect(() => {
    undoStackRef.current = [];
    redoStackRef.current = [];
    setEditHistoryCount(0);`;
const resetNew = `  useEffect(() => {
    undoStackRef.current = [];
    redoStackRef.current = [];
    undoTotalDiffRef.current = 0;
    setEditHistoryCount(0);`;
code = code.replace(resetOld, resetNew);

fs.writeFileSync('src/components/MarkdownEditor.tsx', code);
console.log('Phase 1 done');
