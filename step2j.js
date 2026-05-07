const fs = require('fs');
let code = fs.readFileSync('src/components/MarkdownEditor.tsx', 'utf-8');

// Remove types
code = code.replace(/  ArchivedParagraphHistoryEntry,\n  EditHistoryEntry,\n/g, '');
code = code.replace(/  NoteEditHistoryState,\n  RecentEditHistoryEntry,\n/g, '');

// Removing IPC calls
code = code.replace(/      await window\.electronAPI\.saveNoteEditHistory\(noteId, history\);\n/g, '');
code = code.replace(/    void window\.electronAPI\.getNoteEditHistory\(noteId\)\.then\(\(history\) => \{[\s\S]*?    \}\)\.catch\(\(err\) => \{\n      console\.warn\('getNoteEditHistory failed', err\);\n      if \(isCancelled\) return;\n    \}\);\n/g, '');

// error TS2345: Argument of type '"bundled"' is not assignable to parameter of type 'HistoryBoundaryReason'. Wait, 'bundled' was not in HistoryBoundaryReason type!
// Let me look at HistoryBoundaryReason type in MarkdownEditor.tsx
const historyBoundaryStr = "type HistoryBoundaryReason = 'paste' | 'change' | 'space' | 'delete-boundary' | 'delete-selection' | 'delete-forward';";
code = code.replace(historyBoundaryStr, "type HistoryBoundaryReason = 'paste' | 'change' | 'space' | 'delete-boundary' | 'delete-selection' | 'delete-forward' | 'bundled' | 'char';");

fs.writeFileSync('src/components/MarkdownEditor.tsx', code);
console.log('Types fixed');
