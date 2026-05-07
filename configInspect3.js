const fs = require('fs');
let code = fs.readFileSync('src/components/MarkdownEditor.tsx', 'utf-8');
const lines = code.split('\n');
for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes('finalizePendingNativeBoundary')) {
    for(let j=0; j<25; j++){
      console.log(i + 1 + j + ': ' + lines[i+j]);
    }
    break;
  }
}
