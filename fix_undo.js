const fs = require('fs');
let code = fs.readFileSync('src/components/MarkdownEditor.tsx', 'utf-8');

const undoStart = code.indexOf('  const handleUndo = useCallback(() => {');
const undoEnd = code.indexOf('  useEffect(() => {', undoStart);
const newUndoRedo = `  const handleUndo = useCallback(() => {
    if (undoStackRef.current.length === 0) return;
    pushHistorySnapshot('redo', content, selectionStart, selectionEnd);
    const prev = undoStackRef.current.pop()!;
    applySnapshotProgrammatically(prev);
    setEditHistoryCount(prevCount => prevCount + 1);
  }, [applySnapshotProgrammatically, content, selectionStart, selectionEnd, pushHistorySnapshot]);

  const handleRedo = useCallback(() => {
    if (redoStackRef.current.length === 0) return;
    pushHistorySnapshot('undo', content, selectionStart, selectionEnd);
    const next = redoStackRef.current.pop()!;
    applySnapshotProgrammatically(next);
    setEditHistoryCount(prevCount => prevCount + 1);
  }, [applySnapshotProgrammatically, content, selectionStart, selectionEnd, pushHistorySnapshot]);

`;
if(undoStart > -1 && undoEnd > -1) {
  code = code.substring(0, undoStart) + newUndoRedo + code.substring(undoEnd);
}

fs.writeFileSync('src/components/MarkdownEditor.tsx', code);
