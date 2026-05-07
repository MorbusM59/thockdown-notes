const fs = require('fs');

let mdStr = fs.readFileSync('src/components/MarkdownEditor.tsx', 'utf-8');

const s1 = mdStr.indexOf('const EMPTY_EDIT_HISTORY_STATE: NoteEditHistoryState = {');
const e1 = mdStr.indexOf('const DEFAULT_HIGHLIGHT_COLORS: HighlightColors = {');
if(s1 > -1 && e1 > -1) {
    mdStr = mdStr.substring(0, s1) + mdStr.substring(e1);
}

const s2 = mdStr.indexOf('function cloneEmptyEditHistoryState()');
const e2 = mdStr.indexOf('interface MarkdownEditorProps {');
if(s2 > -1 && e2 > -1) {
    mdStr = mdStr.substring(0, s2) + mdStr.substring(e2);
}

mdStr = mdStr.replace(
  'const editHistoryRef = useRef<NoteEditHistoryState>(cloneEmptyEditHistoryState());',
  'const undoStackRef = useRef<EditSnapshot[]>([]);\n  const redoStackRef = useRef<EditSnapshot[]>([]);'
);

const persistStart = mdStr.indexOf('const persistEditHistory = useCallback');
const persistEnd = mdStr.indexOf('const recordHistoryEntry = useCallback');
if (persistStart > -1 && persistEnd > -1) {
  mdStr = mdStr.substring(0, persistStart) + mdStr.substring(persistEnd);
}

const loadStart = mdStr.indexOf('  useEffect(() => {\n    if (!note) {');
const loadEnd = mdStr.indexOf('  useEffect(() => {\n    editHistoryRef.current = cloneEmptyEditHistoryState();');
if (loadStart > -1 && loadEnd > -1) {
  mdStr = mdStr.substring(0, loadStart) + mdStr.substring(loadEnd);
}

const resetStart = mdStr.indexOf('  useEffect(() => {\n    editHistoryRef.current = cloneEmptyEditHistoryState();');
const resetEnd = mdStr.indexOf('  const handleUndo = useCallback(() => {');
if (resetStart > -1 && resetEnd > -1) {
  let inner = mdStr.substring(resetStart, resetEnd);
  inner = inner.replace('    editHistoryRef.current = cloneEmptyEditHistoryState();\n    setEditHistoryCount(0);\n', '');
  inner = inner.replace('    editHistoryRef.current = cloneEmptyEditHistoryState();\n', '');
  mdStr = mdStr.substring(0, resetStart) + inner + mdStr.substring(resetEnd);
}

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
const rStart = mdStr.indexOf('  const recordHistoryEntry = useCallback');
const rEnd = mdStr.indexOf('  const loadHistoryForNote', rStart);
if (rStart > -1 && rEnd > -1) {
  mdStr = mdStr.substring(0, rStart) + newRecordHistory + mdStr.substring(rEnd);
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
const uStart = mdStr.indexOf('  const handleUndo = useCallback(() => {');
const uEnd = mdStr.indexOf('  useEffect(() => {', uStart);
if (uStart > -1 && uEnd > -1) {
  mdStr = mdStr.substring(0, uStart) + newUndoRedo + mdStr.substring(uEnd);
}

mdStr = mdStr.replace(/recordHistoryEntry\([^)]*\);?/g, '// record history removed');

// App.tsx
let appStr = fs.readFileSync('src/components/App.tsx', 'utf-8');
const ah1 = appStr.indexOf('const handleClearCurrentHistory = async () => {');
const ae1 = appStr.indexOf('const handleClearAllHistory = async () => {', ah1);
if (ah1 > -1 && ae1 > -1) {
    appStr = appStr.substring(0, ah1) + 'const handleClearCurrentHistory = async () => {};\n\n  ' + appStr.substring(ae1);
}
const ah2 = appStr.indexOf('const handleClearAllHistory = async () => {');
const ae2 = appStr.indexOf('const handleDeleteNote = async (id: number) => {', ah2);
if (ah2 > -1 && ae2 > -1) {
    appStr = appStr.substring(0, ah2) + 'const handleClearAllHistory = async () => {};\n\n  ' + appStr.substring(ae2);
}
fs.writeFileSync('src/components/App.tsx', appStr);

// Imports in mdStr
const oldImport = `import {
  ArchivedParagraphHistoryEntry,
  EditHistoryEntry,
  EditSnapshot,
  Note,
  NoteEditHistoryState,
  RecentEditHistoryEntry,
} from '../shared/types';`;
mdStr = mdStr.replace(oldImport, `import { EditSnapshot, Note } from '../shared/types';`);
fs.writeFileSync('src/components/MarkdownEditor.tsx', mdStr);

// Other files:
// index.ts
let idx = fs.readFileSync('src/index.ts', 'utf-8');
idx = idx.replace(/saveNoteEditHistory,\s*getNoteEditHistory,\s*clearNoteEditHistory,\s*clearAllNoteEditHistories,/, '');
idx = idx.replace(/ipcMain\.handle\('save-note-edit-history'[\s\S]*?\n/, '');
idx = idx.replace(/ipcMain\.handle\('get-note-edit-history'[\s\S]*?\n/, '');
idx = idx.replace(/ipcMain\.handle\('clear-note-edit-history'[\s\S]*?\n/, '');
idx = idx.replace(/ipcMain\.handle\('clear-all-note-edit-histories'[\s\S]*?\n/, '');
fs.writeFileSync('src/index.ts', idx);

// database.ts
let db = fs.readFileSync('src/main/database.ts', 'utf-8');
db = db.replace(/,\s*NoteEditHistoryState/, '');
fs.writeFileSync('src/main/database.ts', db);

// preload.ts
let pre = fs.readFileSync('src/preload.ts', 'utf-8');
pre = pre.replace(/,\s*NoteEditHistoryState/, '');
pre = pre.replace(/saveNoteEditHistory:[\s\S]*?\),/, '');
pre = pre.replace(/getNoteEditHistory:[\s\S]*?\),/, '');
pre = pre.replace(/clearNoteEditHistory:[\s\S]*?\),/, '');
pre = pre.replace(/clearAllNoteEditHistories:[\s\S]*?\),/, '');
fs.writeFileSync('src/preload.ts', pre);

console.log('Fixed everything.');
