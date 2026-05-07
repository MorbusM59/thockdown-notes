const fs = require('fs');
let code = fs.readFileSync('src/components/MarkdownEditor.tsx', 'utf-8');

// 1. imports
code = code.replace(/  ArchivedParagraphHistoryEntry,\r?\n  EditHistoryEntry,\r?\n/g, '');
code = code.replace(/  NoteEditHistoryState,\r?\n  RecentEditHistoryEntry,\r?\n/g, '');

// 2. EMPTY_EDIT_HISTORY_STATE
code = code.replace(/const EMPTY_EDIT_HISTORY_STATE[\s\S]*?\}\;\r?\n/, '');

// 3. cloneEmptyEditHistoryState
code = code.replace(/function cloneEmptyEditHistoryState\(\)[\s\S]*?\}\r?\n/, '');

// 4. createArchivedParagraphEntry
code = code.replace(/function createArchivedParagraphEntry\(\w+: RecentEditHistoryEntry\)[\s\S]*?\}\r?\n/, '');

// 5. addRecentHistoryEntry
code = code.replace(/function addRecentHistoryEntry[\s\S]*?\}\r?\n/, '');

// 6. applyHistoryEntry (keep buildSnapshot, we use it)
code = code.replace(/function applyHistoryEntry[\s\S]*?\}\r?\n/, '');

// 7. IPC calls in persistEditHistory
code = code.replace(/  const persistEditHistory = useCallback\(async \(noteId: number, history: NoteEditHistoryState\) => \{\s*if \(\!window\.electronAPI\) return;\s*try \{[\s\S]*?\}\), \[\]\);\r?\n/, '');
code = code.replace(/  const replaceEditHistory = useCallback\(\(nextHistory: NoteEditHistoryState\) => \{\s*editHistoryRef\.current = nextHistory;\s*setEditHistoryCount\(nextHistory\.recent\.length \+ nextHistory\.redo\.length\);\s*persistEditHistory\(note\.id, nextHistory\);\s*\}, \[note, persistEditHistory\]\);\r?\n/, '');
code = code.replace(/  const editHistoryRef = useRef<NoteEditHistoryState>\([\s\S]*?\);\r?\n/, '');

// 8. IPC getNoteEditHistory inside useEffect
// This one is trickier. Let's just find and kill the block.
let getH = code.indexOf('void window.electronAPI.getNoteEditHistory(noteId)');
let endH = code.indexOf('});', getH);
if (getH > -1 && endH > -1) {
    code = code.substring(0, getH) + code.substring(endH + 3);
}

// 9. replace IPC saveNoteEditHistory
code = code.replace(/      await window\.electronAPI\.saveNoteEditHistory\(noteId, history\);\r?\n/g, '');

fs.writeFileSync('src/components/MarkdownEditor.tsx', code);
console.log('Cleanup applied');
