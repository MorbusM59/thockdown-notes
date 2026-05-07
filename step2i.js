const fs = require('fs');
let code = fs.readFileSync('src/components/MarkdownEditor.tsx', 'utf-8');

const targetEnter = `      programmaticInsertRef.current = true;
      setContent(newText);
      handleContentChange(newText);
      
      const enterSnapshot = buildSnapshot(newText, newCursorPos, newCursorPos);
      recordHistoryEntry('bundled', lastCommittedSnapshotRef.current, enterSnapshot);
`;

code = code.replace(/      programmaticInsertRef\.current = true;\s*setContent\(newText\);\s*handleContentChange\(newText\);/, targetEnter);

fs.writeFileSync('src/components/MarkdownEditor.tsx', code);
console.log('Enter hook injected');
