const fs = require('fs');
let code = fs.readFileSync('src/components/MarkdownEditor.tsx', 'utf-8');
const lines = code.split('\n');
console.log(lines[1405-5]);
console.log(lines[1405-4]);
console.log(lines[1405-3]);
console.log(lines[1405-2]);
console.log(lines[1405-1]);
console.log(lines[1405]);
