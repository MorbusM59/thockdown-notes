const fs = require('fs');
let code = fs.readFileSync('src/components/MarkdownEditor.tsx', 'utf-8');
const lines = code.split('\n');
console.log("Lines 300-330:");
for(let i=290; i<330; i++) {
  if(lines[i]) console.log(`${i+1}: ${lines[i]}`);
}
