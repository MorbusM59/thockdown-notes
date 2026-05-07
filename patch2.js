const fs = require('fs');
let code = fs.readFileSync('src/components/MarkdownEditor.tsx', 'utf-8');

// 3. Remove utility functions about old history
let util1 = code.indexOf('const EMPTY_EDIT_HISTORY_STATE');
let util2 = code.indexOf('export const MarkdownEditor:');
if (util1 > -1 && util2 > -1) {
    // Keep everything up to EMPTY_EDIT_HISTORY_STATE, then look for end of `applyHistoryEntry` function
    let stopIdx = code.indexOf('function applyHistoryEntry');
    let e = code.indexOf('}\n', stopIdx) + 2;
    // Wait, let's just use regex to replace hooks down below instead of wiping top level. We can leave them for now, they just don't compile if type is missing. Wait, if type is missing they error!
    // So let's restore the types in types.ts! Yes! Let's restore types.ts instead of wiping utilities!
}
