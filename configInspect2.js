const fs = require('fs');
let code = fs.readFileSync('src/components/MarkdownEditor.tsx', 'utf-8');
const lines = code.split('\n');
let printed = 0;
for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes('onTextChange')) {
    for(let j=-5; j<15; j++){
      console.log(i + 1 + j + ': ' + lines[i+j]);
    }
    printed++;
    if (printed > 2) break;
  }
}
