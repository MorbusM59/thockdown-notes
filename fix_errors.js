const fs = require('fs');
let code = fs.readFileSync('src/components/MarkdownEditor.tsx', 'utf8');

// 1. Remove NoteEditHistoryState related functions
code = code.replace(/function cloneEmptyEditHistoryState\(\)[\s\S]*?function replaceLineRange\([^)]+\): string\[\] \{\n?[ \t]*return \[\n?[ \t]*\.\.\.lines\.slice\(0, startLine\),\n?[ \t]*\.\.\.replacement,\n?[ \t]*\.\.\.lines\.slice\(endLineExclusive\),\n?[ \t]*\];\n?\}/, '');

code = code.replace(/function applyHistoryEntry\([^)]+\): EditSnapshot \{[\s\S]*?selectionEnd: entry\.afterSelection\.selectionEnd,\n?[ \t]*\};\n?\}/, '');

// 2. In MarkdownEditor component
// editHistoryRef, pendingHistoryBoundaryRef
code = code.replace(/const editHistoryRef = useRef<NoteEditHistoryState>\([^)]+\);/, 'const undoStackRef = useRef<UndoEntry[]>([]);\n  const redoStackRef = useRef<UndoEntry[]>([]);\n  const undoTotalDiffRef = useRef<number>(0); // Net diff sum of all char entries currently on stack');

code = code.replace(/const pendingHistoryBoundaryRef = useRef<\{ reason: HistoryBoundaryReason; before: EditSnapshot \} \| null>\(null\);/, '');

// persistEditHistory, replaceEditHistory, recordHistoryEntry
code = code.replace(/const persistEditHistory = useCallback\(async \([^)]+\) => \{[\s\S]*?\}, \[\]\);/, '');

code = code.replace(/const replaceEditHistory = useCallback\(\(nextHistory: NoteEditHistoryState\) => \{[\s\S]*?\}, \[persistEditHistory\]\);/, '');

code = code.replace(/const recordHistoryEntry = useCallback\(\(reason: HistoryBoundaryReason, before: EditSnapshot, after: EditSnapshot\) => \{[\s\S]*?\}, \[note, replaceEditHistory\]\);/, '');

// 3. remove getNoteEditHistory block in useEffect
code = code.replace(/void window\.electronAPI\.getNoteEditHistory\(noteId\)\.then\(\(history\) => \{[\s\S]*?\}\)\.catch\(\(err\) => \{[\s\S]*?\}\);/, '');

// 4. remove references to HistoryBoundaryReason in insertAtCursor
code = code.replace(/const insertAtCursor = \(text: string, historyReason\?: HistoryBoundaryReason\) => \{/, 'const insertAtCursor = (text: string) => {');
code = code.replace(/historyReason,/g, '');

// 5. In handleUndo
code = code.replace(/let entry: EditHistoryEntry;\n?[ \t]*let nextHistory: NoteEditHistoryState;\n?/, '');

code = code.replace(/let restoredHistory: NoteEditHistoryState;\n?/, '');

// 6. remove requestHistoryBoundary
code = code.replace(/const requestHistoryBoundary = useCallback\(\(reason: HistoryBoundaryReason\) => \{[\s\S]*?\}, \[buildSnapshot, recordHistoryEntry\]\);/, '');

fs.writeFileSync('src/components/MarkdownEditor.tsx', code);
console.log("Fixed!");
