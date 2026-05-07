const fs = require('fs');
let code = fs.readFileSync('src/components/MarkdownEditor.tsx', 'utf-8');
const lines = code.split('\n');
let sIdx = lines.findIndex(l => l.includes('const handleTextareaKeyDown'));
for (let i = 0; i < 150; i++) {
  if(lines[sIdx + i].includes('Undo') || lines[sIdx + i].includes('Ctrl') || lines[sIdx + i].includes('z'))
    console.log(lines[sIdx + i]);
}
