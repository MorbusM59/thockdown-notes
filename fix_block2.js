const fs = require('fs');
let code = fs.readFileSync('src/components/MarkdownEditor.tsx', 'utf8');

const sIdx = code.indexOf('function cloneEmptyEditHistoryState()');
const eIdx = code.indexOf('interface MarkdownEditorProps {');

code = code.substring(0, sIdx) + code.substring(eIdx);

fs.writeFileSync('src/components/MarkdownEditor.tsx', code);
