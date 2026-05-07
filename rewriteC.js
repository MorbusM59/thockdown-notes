const fs = require('fs');
let code = fs.readFileSync('src/components/MarkdownEditor.tsx', 'utf-8');

code = code.replace(/function applyHistoryEntry[\s\S]*?\}\r?\n/, '');

const lines = code.split('\n');
code = lines.filter((l, i) => i < 25 || i >= 37).join('\n');
fs.writeFileSync('src/components/MarkdownEditor.tsx', code);
console.log('Phase C Done');
