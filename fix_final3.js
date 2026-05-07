const fs = require('fs');
let code = fs.readFileSync('src/components/MarkdownEditor.tsx', 'utf-8').replace(/\r\n/g, '\n');

// 1. the imports
const t0 = `import {
  ArchivedParagraphHistoryEntry,
  EditHistoryEntry,
  EditSnapshot,
  Note,
  NoteEditHistoryState,
  RecentEditHistoryEntry,
} from '../shared/types';`;
code = code.replace(t0, `import { EditSnapshot, Note } from '../shared/types';`);

// 2. The helper functions at the top of the file
const helperStart = code.indexOf('const EMPTY_EDIT_HISTORY_STATE: NoteEditHistoryState = {');
const helperEnd = code.indexOf('interface MarkdownEditorProps {');
if(helperStart > -1 && helperEnd > -1) {
  code = code.substring(0, helperStart) + code.substring(helperEnd);
}

// 3. editHistoryRef declaration
code = code.replace('  const editHistoryRef = useRef<NoteEditHistoryState>(cloneEmptyEditHistoryState());\n', '  const undoStackRef = useRef<EditSnapshot[]>([]);\n  const redoStackRef = useRef<EditSnapshot[]>([]);\n');

// 4. The getNoteEditHistory block...
const getNoteBlockStart = code.indexOf('  useEffect(() => {\n    if (!note) {');
const getNoteBlockEndPattern = '  }, [note]);\n';
const getNoteBlockEnd = code.indexOf(getNoteBlockEndPattern, getNoteBlockStart) + getNoteBlockEndPattern.length;
if(getNoteBlockStart > -1 && getNoteBlockEndPattern) {
  code = code.substring(0, getNoteBlockStart) + code.substring(getNoteBlockEnd);
}

// 5. The historyResetSignal block resetting editHistoryRef
code = code.replace(
`  useEffect(() => {
    editHistoryRef.current = cloneEmptyEditHistoryState();
    setEditHistoryCount(0);
    pendingHistoryBoundaryRef.current = null;
    lastCommittedSnapshotRef.current = buildSnapshot(content, selectionStart, selectionEnd);
  }, [buildSnapshot, historyResetSignal]);`,
`  useEffect(() => {
    undoStackRef.current = [];
    redoStackRef.current = [];
    setEditHistoryCount(0);
    pendingHistoryBoundaryRef.current = null;
    lastCommittedSnapshotRef.current = buildSnapshot(content, selectionStart, selectionEnd);
  }, [buildSnapshot, historyResetSignal]);`);

// 6. persistEditHistory and replaceEditHistory
const persistStart = code.indexOf('  const persistEditHistory = useCallback(');
const persistEndPattern = '  }, [persistEditHistory]);\n';
const persistEnd = code.indexOf(persistEndPattern, persistStart) + persistEndPattern.length;
if (persistStart > -1 && persistEndPattern) {
  code = code.substring(0, persistStart) + code.substring(persistEnd);
}

// 7. recordHistoryEntry => pushHistorySnapshot / commitSnapshotForUndo
const recordHistStart = code.indexOf('  const recordHistoryEntry = useCallback(');
const recordHistEndPattern = '  }, [note, replaceEditHistory]);\n';
const recordHistEnd = code.indexOf(recordHistEndPattern, recordHistStart) + recordHistEndPattern.length;
const newRecordHistory = `  const pushHistorySnapshot = useCallback((type: 'undo' | 'redo', currentText: string, currentSelectionStart: number, currentSelectionEnd: number) => {
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
  }, [note, commitSnapshotForUndo]);
`;
if (recordHistStart > -1 && recordHistEndPattern) {
  code = code.substring(0, recordHistStart) + newRecordHistory + code.substring(recordHistEnd);
}

// 8. handleUndo and handleRedo
const undoStart = code.indexOf('  const handleUndo = useCallback(() => {');
const undoEndPattern = '  }, [applySnapshotProgrammatically, content, replaceEditHistory]);\n';
// handleUndo ends, handleRedo starts immediately after it, then ends with the exact same line pattern.
const firstUndoEnd = code.indexOf(undoEndPattern, undoStart) + undoEndPattern.length;
const redoEnd = code.indexOf(undoEndPattern, firstUndoEnd) + undoEndPattern.length;

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

if (undoStart > -1 && redoEnd) {
  code = code.substring(0, undoStart) + newUndoRedo + code.substring(redoEnd);
}

fs.writeFileSync('src/components/MarkdownEditor.tsx', code);
console.log('Finished surgically replacing blocks.');
