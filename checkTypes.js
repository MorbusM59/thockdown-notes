const fs = require('fs');
let code = fs.readFileSync('src/shared/types.ts', 'utf-8');
console.log(code.includes('EditHistoryEntry'));
