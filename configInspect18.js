const fs = require('fs');
let code = fs.readFileSync('src/components/MarkdownEditor.tsx', 'utf-8');
const lines = code.split('\n');
let sIdx = lines.findIndex(l => l.includes('handleTextareaKeyDown'));
for(let i=0; i<lines.length; i++) { 
  if (lines[i].includes('handleTextareaKeyDown')) console.log(i+1 + ': ' + lines[i]);
}
