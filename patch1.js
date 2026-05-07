const fs = require('fs');
let code = fs.readFileSync('src/components/MarkdownEditor.tsx', 'utf-8');

// 1. Remove old types and IPC from top
code = code.replace(/  ArchivedParagraphHistoryEntry,\r?\n  EditHistoryEntry,\r?\n/, '');
code = code.replace(/  NoteEditHistoryState,\r?\n  RecentEditHistoryEntry,\r?\n/, '');

// 2. Add history boundary types
code = code.replace("type HistoryBoundaryReason = 'paste' | 'change' | 'space' | 'delete-boundary' | 'delete-selection' | 'delete-forward';",
"type HistoryBoundaryReason = 'paste' | 'change' | 'space' | 'delete-boundary' | 'delete-selection' | 'delete-forward' | 'bundled' | 'char';\r\n\r\ntype UndoEntry = { type: 'char' | 'paste' | 'bundled'; snapshot: EditSnapshot; diff: number; };\r\nconst MAX_UNDO_CHARS = 1000;");

fs.writeFileSync('src/components/MarkdownEditor.tsx', code);
console.log('step 1 finish');
