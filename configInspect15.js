const fs = require('fs');
let code = fs.readFileSync('src/components/MarkdownEditor.tsx', 'utf-8');
const lines = code.split('\n');
let sIdx = lines.findIndex(l => l.includes('<div className={`editor-content'));
for(let i=0; i<30; i++) { console.log(lines[sIdx + i]); }
