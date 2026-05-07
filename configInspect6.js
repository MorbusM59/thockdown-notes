const fs = require('fs');
let code = fs.readFileSync('src/components/MarkdownEditor.tsx', 'utf-8');
const lines = code.split('\n');
for (let i = 1150; i < 1170; i++) {
  console.log(i + 1 + ': ' + lines[i]);
}
