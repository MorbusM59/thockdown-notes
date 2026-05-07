const fs = require('fs');
let code = fs.readFileSync('src/components/MarkdownEditor.tsx', 'utf-8');

code = code.replace(/  ArchivedParagraphHistoryEntry,\r?\n  EditHistoryEntry,\r?\n/g, '');
code = code.replace(/  NoteEditHistoryState,\r?\n  RecentEditHistoryEntry,\r?\n/g, '');

code = code.replace(/      await window\.electronAPI\.saveNoteEditHistory\(noteId, history\);\r?\n/g, '');

let s1 = code.indexOf('void window.electronAPI.getNoteEditHistory(noteId)');
let e1 = code.indexOf('});', s1);
if (s1 > -1 && e1 > -1) {
  code = code.substring(0, s1) + code.substring(e1 + 5);
}

const historyBoundaryStr = "type HistoryBoundaryReason = 'paste' | 'change' | 'space' | 'delete-boundary' | 'delete-selection' | 'delete-forward';";
code = code.replace(historyBoundaryStr, "type HistoryBoundaryReason = 'paste' | 'change' | 'space' | 'delete-boundary' | 'delete-selection' | 'delete-forward' | 'bundled' | 'char';");

fs.writeFileSync('src/components/MarkdownEditor.tsx', code);
console.log('Types fixed 2');
