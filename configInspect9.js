const fs = require('fs');
let code = fs.readFileSync('src/components/MarkdownEditor.tsx', 'utf-8');
const lines = code.split('\n');
let sIdx = lines.findIndex(l => l.includes('const handleTextareaKeyDown'));
for (let i = 0; i < 50; i++) {
  console.log(lines[sIdx + i]);
}
