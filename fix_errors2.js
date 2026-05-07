const fs = require('fs');

// App.tsx
let appStr = fs.readFileSync('src/components/App.tsx', 'utf-8');
appStr = appStr.replace(/const handleClearCurrentHistory = async \(\) => \{\n\s*if \(\!selectedNote\) return;\n\s*await window\.electronAPI\.clearNoteEditHistory\(selectedNote\.id\);\n\s*setSelectedNoteHistoryCount\(0\);\n\s*setHistoryResetSignal\(\(value\) => value \+ 1\);\n\s*\};\n/, '');
appStr = appStr.replace(/const handleClearAllHistory = async \(\) => \{\n\s*await window\.electronAPI\.clearAllNoteEditHistories\(\);\n\s*setSelectedNoteHistoryCount\(0\);\n\s*setHistoryResetSignal\(\(value\) => value \+ 1\);\n\s*\};\n/, '');
fs.writeFileSync('src/components/App.tsx', appStr);

// MarkdownEditor.tsx
let mdStr = fs.readFileSync('src/components/MarkdownEditor.tsx', 'utf-8');
const oldImport = `import {
  ArchivedParagraphHistoryEntry,
  EditHistoryEntry,
  EditSnapshot,
  Note,
  NoteEditHistoryState,
  RecentEditHistoryEntry,
} from '../shared/types';`;
mdStr = mdStr.replace(oldImport, `import { EditSnapshot, Note } from '../shared/types';`);

const persistReg = /const persistEditHistory = useCallback[\s\S]*?\}, \[.*\]\);\n\n/;
mdStr = mdStr.replace(persistReg, '');

const getNoteReg = /void window\.electronAPI\.getNoteEditHistory[\s\S]*?catch\(\(err\) => \{\n.*?console.warn.*\n.*?if \(isCancelled\) return;\n.*?editHistoryRef\.current = cloneEmptyEditHistoryState\(\);\n.*?setEditHistoryCount\(0\);\n.*\}\);\n/;
mdStr = mdStr.replace(getNoteReg, '');

fs.writeFileSync('src/components/MarkdownEditor.tsx', mdStr);
console.log('Fixed more errors.');
