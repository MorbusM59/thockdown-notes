const fs = require('fs');
let code = fs.readFileSync('src/components/MarkdownEditor.tsx', 'utf-8');

const bundleScript = `  const bundleRecentChars = useCallback(() => {
    const stack = undoStackRef.current;
    if (stack.length < 2) return;
    
    // Find consecutive 'char' entries
    let i = stack.length - 1;
    while (i >= 0 && stack[i].type === 'char') {
      i--;
    }
    
    // i is the last non-char entry, or -1 if all are chars
    const charCount = stack.length - 1 - i;
    if (charCount > 1) { // Need at least 2 chars to bundle
      const firstCharIdx = i + 1;
      const firstCharSnapshot = stack[firstCharIdx].snapshot;
      let totalDiff = 0;
      for (let j = firstCharIdx; j < stack.length; j++) {
        totalDiff += stack[j].diff;
      }
      
      const newBundledEntry: UndoEntry = {
        type: 'bundled',
        snapshot: firstCharSnapshot,
        diff: totalDiff
      };
      
      stack.splice(firstCharIdx, charCount, newBundledEntry);
    }
  }, []);`;

console.log('Script written');
