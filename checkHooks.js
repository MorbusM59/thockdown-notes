const fs = require('fs');
let code = fs.readFileSync('src/components/MarkdownEditor.tsx', 'utf-8');
const lines = code.split('\n');
lines.forEach((l, i) => {
  if (l.includes('commitSnapshotForUndo') || l.includes('recordHistoryEntry') || l.includes('requestHistoryBoundary')) {
    console.log(`${i+1}: ${l.trim()}`);
  }
});
