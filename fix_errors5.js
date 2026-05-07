const fs = require('fs');

let mdStr = fs.readFileSync('src/components/MarkdownEditor.tsx', 'utf-8');

// The ENTIRE block of old helpers
let start = mdStr.indexOf('const EMPTY_EDIT_HISTORY_STATE');
let end = mdStr.indexOf('export const MarkdownEditor');
if (start > -1 && end > -1) {
  mdStr = mdStr.substring(0, start) + mdStr.substring(end);
}

// editHistoryRef => undoStackRef and redoStackRef
mdStr = mdStr.replace(
  'const editHistoryRef = useRef<NoteEditHistoryState>(cloneEmptyEditHistoryState());',
  'const undoStackRef = useRef<EditSnapshot[]>([]);\n  const redoStackRef = useRef<EditSnapshot[]>([]);'
);

start = mdStr.indexOf('const persistEditHistory = useCallback');
end = mdStr.indexOf('const recordHistoryEntry = useCallback');
if (start > -1 && end > -1) {
  mdStr = mdStr.substring(0, start) + mdStr.substring(end);
}

start = mdStr.indexOf('  useEffect(() => {\n    if (!note) {');
end = mdStr.indexOf('  useEffect(() => {\n    editHistoryRef.current = cloneEmptyEditHistoryState();');
if (start > -1 && end > -1) {
  mdStr = mdStr.substring(0, start) + mdStr.substring(end);
}

start = mdStr.indexOf('  useEffect(() => {\n    editHistoryRef.current = cloneEmptyEditHistoryState();');
end = mdStr.indexOf('  const handleUndo = useCallback(() => {');
if (start > -1 && end > -1) {
  let inner = mdStr.substring(start, end);
  inner = inner.replace('    editHistoryRef.current = cloneEmptyEditHistoryState();\n    setEditHistoryCount(0);\n', '');
  inner = inner.replace('    editHistoryRef.current = cloneEmptyEditHistoryState();\n', '');
  mdStr = mdStr.substring(0, start) + inner + mdStr.substring(end);
}

// And finally we need to fix recordHistoryEntry, handleUndo, handleRedo like we originally did
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

`;
start = mdStr.indexOf('  const recordHistoryEntry = useCallback');
end = mdStr.indexOf('  const loadHistoryForNote', start);
if (start > -1 && end > -1) {
  mdStr = mdStr.substring(0, start) + newRecordHistory + mdStr.substring(end);
}

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
start = mdStr.indexOf('  const handleUndo = useCallback(() => {');
end = mdStr.indexOf('  useEffect(() => {', start);
if (start > -1 && end > -1) {
  mdStr = mdStr.substring(0, start) + newUndoRedo + mdStr.substring(end);
}

// Any lingering usages of recordHistoryEntry:
mdStr = mdStr.replace(/recordHistoryEntry\(/g, '// recordHistoryEntry(');

fs.writeFileSync('src/components/MarkdownEditor.tsx', mdStr);
console.log('Fixed overlapping offsets');
