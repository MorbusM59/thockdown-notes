const fs = require('fs');

let mdStr = fs.readFileSync('src/components/MarkdownEditor.tsx', 'utf-8');

// The ENTIRE block of old helpers
const startHelpers = mdStr.indexOf('const EMPTY_EDIT_HISTORY_STATE: NoteEditHistoryState =');
const endHelpers = mdStr.indexOf('export const MarkdownEditor = React.forwardRef<');

if (startHelpers > -1 && endHelpers > -1) {
  mdStr = mdStr.substring(0, startHelpers) + mdStr.substring(endHelpers);
}

// editHistoryRef => undoStackRef and redoStackRef
mdStr = mdStr.replace(
  'const editHistoryRef = useRef<NoteEditHistoryState>(cloneEmptyEditHistoryState());',
  'const undoStackRef = useRef<EditSnapshot[]>([]);\n  const redoStackRef = useRef<EditSnapshot[]>([]);'
);

// persistEditHistory, replaceEditHistory
const persistStart = mdStr.indexOf('const persistEditHistory = useCallback');
const persistEnd = mdStr.indexOf('const recordHistoryEntry = useCallback');
if (persistStart > -1 && persistEnd > -1) {
  mdStr = mdStr.substring(0, persistStart) + mdStr.substring(persistEnd);
}

// loadHistoryForNote useEffect that initializes getNoteEditHistory
const loadStart = mdStr.indexOf('  useEffect(() => {\n    if (!note) {');
const loadEnd = mdStr.indexOf('  useEffect(() => {\n    editHistoryRef.current = cloneEmptyEditHistoryState();');
if (loadStart > -1 && loadEnd > -1) {
  mdStr = mdStr.substring(0, loadStart) + mdStr.substring(loadEnd);
}

// The next useEffect also resets editHistoryRef
const reset2Start = mdStr.indexOf('  useEffect(() => {\n    editHistoryRef.current = cloneEmptyEditHistoryState();');
const reset2End = mdStr.indexOf('  const handleUndo = useCallback(() => {');
if (reset2Start > -1 && reset2End > -1) {
  // we actually need this useEffect, but without editHistoryRef
  let inner = mdStr.substring(reset2Start, reset2End);
  inner = inner.replace('    editHistoryRef.current = cloneEmptyEditHistoryState();\n    setEditHistoryCount(0);\n', '');
  mdStr = mdStr.substring(0, reset2Start) + inner + mdStr.substring(reset2End);
}

fs.writeFileSync('src/components/MarkdownEditor.tsx', mdStr);
console.log('Stripped with indexOf!');
