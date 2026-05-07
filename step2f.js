const fs = require('fs');
let code = fs.readFileSync('src/components/MarkdownEditor.tsx', 'utf-8');

const rx = /  const parseAndApplyInsert = useCallback[^\{\}]*\{/;
let parseInsertIdx = code.search(rx);
code = code.substring(0, parseInsertIdx) + `
  const bundlePreviousChars = useCallback(() => {
    const stack = undoStackRef.current;
    if (stack.length < 2) return;
    
    let i = stack.length - 1;
    while (i >= 0 && stack[i].type === 'char') {
      i--;
    }
    
    const charCount = stack.length - 1 - i;
    if (charCount > 1) {
      const firstCharIdx = i + 1;
      const firstCharSnapshot = stack[firstCharIdx].snapshot;
      let totalDiff = 0;
      for (let j = firstCharIdx; j < stack.length; j++) {
        totalDiff += Math.abs(stack[j].diff); // ensure positive
      }
      
      const newBundledEntry: UndoEntry = {
        type: 'bundled',
        snapshot: firstCharSnapshot,
        diff: totalDiff
      };
      
      stack.splice(firstCharIdx, charCount, newBundledEntry);
      setEditHistoryCount(undoStackRef.current.length + redoStackRef.current.length);
    }
  }, []);
` + code.substring(parseInsertIdx);

const pushFix = `  const pushHistorySnapshot = useCallback((
    targetStack: 'undo' | 'redo',
    type: 'char' | 'paste' | 'bundled',
    snapshot: EditSnapshot,
    diff: number
  ) => {
    const stack = targetStack === 'undo' ? undoStackRef.current : redoStackRef.current;
    
    // Auto-detect space or newline in the diff if adding a single char
    // Actually, simpler to trigger bundle externally.
    
    stack.push({ type, snapshot, diff });
    
    if (targetStack === 'undo') {
      undoTotalDiffRef.current += diff;
      while (undoTotalDiffRef.current > MAX_UNDO_CHARS && stack.length > 1) {
        const removed = stack.shift()!;
        undoTotalDiffRef.current -= removed.diff;
      }
    } else {
      if (stack.length > 50) stack.shift();
    }
    setEditHistoryCount(undoStackRef.current.length + redoStackRef.current.length);
  }, []);`;
  
code = code.replace(/  const pushHistorySnapshot = useCallback\(\([\s\S]*?  \}, \[\]\);/, pushFix);
fs.writeFileSync('src/components/MarkdownEditor.tsx', code);
console.log("Bundle code injected.");
