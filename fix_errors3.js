const fs = require('fs');

let mdStr = fs.readFileSync('src/components/MarkdownEditor.tsx', 'utf-8');

// 1. Remove EMPTY_EDIT_HISTORY_STATE
mdStr = mdStr.replace(/const EMPTY_EDIT_HISTORY_STATE: NoteEditHistoryState = \{[\s\S]*?\};\n\n/, '');

// 2. Remove all export/function helpers
const helpersRegex = /function cloneEmptyEditHistoryState\(\): NoteEditHistoryState \{[\s\S]*?function applyHistoryEntry\(currentContent: string, entry: EditHistoryEntry, direction: 'undo' \| 'redo'\): EditSnapshot \{[\s\S]*?\}\n\n/;
mdStr = mdStr.replace(helpersRegex, '');

fs.writeFileSync('src/components/MarkdownEditor.tsx', mdStr);
console.log('Removed empty states and helpers');
