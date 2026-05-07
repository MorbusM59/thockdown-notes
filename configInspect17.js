const fs = require('fs');
let code = fs.readFileSync('src/components/MarkdownEditor.tsx', 'utf-8');
const lines = code.split('\n');
let sIdx = lines.findIndex(l => l.includes('<FixedFocusEditor'));
for(let i=0; i<30; i++) { 
  if (lines[sIdx + i].includes('onKeyDown')) console.log(lines[sIdx + i]);
}
