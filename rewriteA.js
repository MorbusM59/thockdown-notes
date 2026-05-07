const fs = require('fs');

let code = fs.readFileSync('src/components/MarkdownEditor.tsx', 'utf-8');

// 1. Strip out the dead type imports
code = code.replace(/  ArchivedParagraphHistoryEntry,\r?\n  EditHistoryEntry,\r?\n/, '');
code = code.replace(/  NoteEditHistoryState,\r?\n  RecentEditHistoryEntry,\r?\n/, '');

// 2. Erase the block of old utility functions using strict begin/end targets
const utilStartStr = "const EMPTY_EDIT_HISTORY_STATE: NoteEditHistoryState = {";
const utilStartIdx = code.indexOf(utilStartStr);
const utilEndStr = "function applyHistoryEntry(currentContent: string, entry: EditHistoryEntry, direction: 'undo' | 'redo'): EditSnapshot {";
// find the end of applyHistoryEntry
let utilEndIdx = code.indexOf(utilEndStr);
utilEndIdx = code.indexOf('}\r\n', utilEndIdx) + 3;

if (utilStartIdx > -1 && utilEndIdx > -1) {
  code = code.substring(0, utilStartIdx) + "\r\n" + code.substring(utilEndIdx);
}

// 3. New types for UndoEntry
const newTypes = `type UndoEntry = { type: 'char' | 'paste' | 'bundled'; snapshot: EditSnapshot; diff: number; };
const MAX_UNDO_CHARS = 1000;
type HistoryBoundaryReason = 'paste' | 'change' | 'space' | 'delete-boundary' | 'delete-selection' | 'delete-forward' | 'bundled' | 'char';`;

code = code.replace("type HistoryBoundaryReason = 'paste' | 'change' | 'space' | 'delete-boundary' | 'delete-selection' | 'delete-forward';", newTypes);

fs.writeFileSync('src/components/MarkdownEditor.tsx', code);
console.log('Phase A Done');
