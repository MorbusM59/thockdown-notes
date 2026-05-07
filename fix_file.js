const fs = require('fs');
let code = fs.readFileSync('src/components/MarkdownEditor.tsx', 'utf8');

function removeBetween(startStr, endStr) {
  const startIdx = code.indexOf(startStr);
  if (startIdx === -1) return false;
  const endIdx = code.indexOf(endStr, startIdx);
  if (endIdx === -1) return false;
  code = code.substring(0, startIdx) + code.substring(endIdx + endStr.length);
  return true;
}

// 1. cloneEmptyEditHistoryState to interface MarkdownEditorProps {
removeBetween('function cloneEmptyEditHistoryState', 'interface MarkdownEditorProps {');
code = code.substring(0, code.indexOf('function cloneEmptyEditHistoryState')) + 'interface MarkdownEditorProps {' + code.substring(code.indexOf('interface MarkdownEditorProps {') + 'interface MarkdownEditorProps {'.length);

code = code.replace(/function cloneEmptyEditHistoryState.*?(?=interface MarkdownEditorProps)/s, '');

// 2. editHistoryRef
code = code.replace(/const editHistoryRef =.*?;\n/, 'const undoStackRef = useRef<UndoEntry[]>([]);\n  const redoStackRef = useRef<UndoEntry[]>([]);\n  const undoTotalDiffRef = useRef<number>(0);\n');

// 3. pendingHistoryBoundaryRef
code = code.replace(/const pendingHistoryBoundaryRef =.*?;\n/, '');

// 4. persistEditHistory
code = code.replace(/const persistEditHistory = useCallback\(async \(noteId: number, history: NoteEditHistoryState\).*?\}, \[\]\);\n/s, '');

// 5. replaceEditHistory
code = code.replace(/const replaceEditHistory =.*?\n.*?\n.*?\n.*?\n.*?\n/s, '');

// 6. recordHistoryEntry 
code = code.replace(/const recordHistoryEntry =.*?\n.*?\n.*?\n.*?\n.*?\n.*?\n.*?\n.*?\n.*?\n.*?\n.*?\n.*?\n.*?\n.*?\n.*?\n/s, '');

// pendingHistoryBoundaryRef.current
code = code.replace(/pendingHistoryBoundaryRef\.current = null;/g, '');

// historyReason in insertAtCursor
code = code.replace(/historyReason\?: HistoryBoundaryReason/g, '');
code = code.replace(/if \(historyReason\) \{.*?\}/s, '');

// replace getNoteEditHistory block in useEffect
code = code.replace(/void window\.electronAPI\.getNoteEditHistory\(noteId\).*?\}\)\.catch\(\(err\) => \{\n.*?\}\);\n/s, '');

fs.writeFileSync('src/components/MarkdownEditor.tsx', code);
