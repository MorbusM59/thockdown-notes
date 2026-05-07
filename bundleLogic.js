const fs = require('fs');
let code = fs.readFileSync('src/components/MarkdownEditor.tsx', 'utf-8');
const bundleScript = `  const pushHistorySnapshot = useCallback((
    targetStack: 'undo' | 'redo',
    type: 'char' | 'paste' | 'bundled',
    snapshot: EditSnapshot,
    diff: number
  ) => {
    const stack = targetStack === 'undo' ? undoStackRef.current : redoStackRef.current;
    
    // Bundling logic: if type is 'char', we can just push it. 
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

code = code.replace(/  const pushHistorySnapshot = useCallback\(\([\s\S]*?  \}, \[\]\);/, bundleScript);
fs.writeFileSync('src/components/MarkdownEditor.tsx', code);
