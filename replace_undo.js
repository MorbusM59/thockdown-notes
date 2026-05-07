const fs = require('fs');

let code = fs.readFileSync('src/components/MarkdownEditor.tsx', 'utf-8');

const startUndo = code.indexOf('  const handleUndo = useCallback(() => {');
const endUndo = code.indexOf('  const handleRedo = useCallback(() => {');
const endRedo = code.indexOf('  useEffect(() => {', endUndo);

if (startUndo !== -1 && endUndo !== -1 && endRedo !== -1) {
  const newUndoRedo = 
`  const handleUndo = useCallback(() => {
    if (undoStackRef.current.length === 0) return;

    // The current state needs to go into redo stack before we undo
    pushHistorySnapshot('redo', content, selectionStart, selectionEnd);

    // Pop the undo stack
    const prev = undoStackRef.current.pop()!;
    
    applySnapshotProgrammatically(prev);
    setEditHistoryCount(prevCount => prevCount + 1);
  }, [applySnapshotProgrammatically, content, selectionStart, selectionEnd, pushHistorySnapshot]);

  const handleRedo = useCallback(() => {
    if (redoStackRef.current.length === 0) return;

    // The current state needs to go into undo stack
    pushHistorySnapshot('undo', content, selectionStart, selectionEnd);

    // Pop the redo stack
    const next = redoStackRef.current.pop()!;
    
    applySnapshotProgrammatically(next);
    setEditHistoryCount(prevCount => prevCount + 1);
  }, [applySnapshotProgrammatically, content, selectionStart, selectionEnd, pushHistorySnapshot]);

`;

  code = code.substring(0, startUndo) + newUndoRedo + code.substring(endRedo);
  fs.writeFileSync('src/components/MarkdownEditor.tsx', code);
  console.log('Replaced Undo/Redo logic.');
} else {
  console.log('Undo hooks not found!');
  console.log(startUndo, endUndo, endRedo);
}
