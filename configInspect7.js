const fs = require('fs');
let code = fs.readFileSync('src/components/MarkdownEditor.tsx', 'utf-8');
const lines = code.split('\n');
let sIdx = code.indexOf('  const handleTextareaKeyDown');
let linesArr = code.substring(sIdx).split('\n');
for (let i = 0; i < 50; i++) {
  console.log(linesArr[i]);
}
