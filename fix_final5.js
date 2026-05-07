const fs = require('fs');
let code = fs.readFileSync('src/components/MarkdownEditor.tsx', 'utf-8');

const startIdx = code.indexOf('const EMPTY_EDIT_HISTORY_STATE: NoteEditHistoryState = {');
const endIdx = code.indexOf('interface MarkdownEditorProps {');

if (startIdx !== -1 && endIdx !== -1) {
  code = code.substring(0, startIdx) + code.substring(endIdx);
  fs.writeFileSync('src/components/MarkdownEditor.tsx', code);
  console.log("Deleted global helpers");
} else {
  console.log("Could not find global helpers");
}

let code2 = fs.readFileSync('src/components/MarkdownEditor.tsx', 'utf-8');
const oldImport = `import {
  ArchivedParagraphHistoryEntry,
  EditHistoryEntry,
  EditSnapshot,
  Note,
  NoteEditHistoryState,
  RecentEditHistoryEntry,
} from '../shared/types';`;
const newImport = `import { EditSnapshot, Note } from '../shared/types';`;
code2 = code2.replace(oldImport, newImport);
fs.writeFileSync('src/components/MarkdownEditor.tsx', code2);

