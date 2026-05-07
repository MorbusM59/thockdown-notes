const fs = require('fs');
let code = fs.readFileSync('src/components/MarkdownEditor.tsx', 'utf-8').replace(/\r\n/g, '\n');

const helperStart = 'const EMPTY_EDIT_HISTORY_STATE: NoteEditHistoryState = {';
const helperEnd = 'interface MarkdownEditorProps {';

const idxStart = code.indexOf(helperStart);
const idxEnd = code.indexOf(helperEnd);

if (idxStart !== -1 && idxEnd !== -1) {
  code = code.substring(0, idxStart) + code.substring(idxEnd);
  fs.writeFileSync('src/components/MarkdownEditor.tsx', code);
  console.log('Helpers deleted.');
} else {
  console.log('Could not find helpers index.');
}
