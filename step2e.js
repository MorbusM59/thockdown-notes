const fs = require('fs');
let code = fs.readFileSync('src/components/MarkdownEditor.tsx', 'utf-8');

const sIdx = code.indexOf('  const handleUndo = useCallback(() => {');
const eIdx = code.indexOf('  const requestHistoryBoundary = useCallback((reason: HistoryBoundaryReason) => {');

if (sIdx > -1 && eIdx > -1) {
  const newUndoRedo = `  const handleUndo = useCallback(() => {
    if (undoStackRef.current.length === 0) return;
    const prev = undoStackRef.current.pop()!;
    undoTotalDiffRef.current -= prev.diff;
    pushHistorySnapshot('redo', prev.type, buildSnapshot(content, selectionStart, selectionEnd), prev.diff);
    applySnapshotProgrammatically(prev.snapshot);
    setEditHistoryCount(undoStackRef.current.length + redoStackRef.current.length);
  }, [applySnapshotProgrammatically, content, selectionStart, selectionEnd, pushHistorySnapshot, buildSnapshot]);

  const handleRedo = useCallback(() => {
    if (redoStackRef.current.length === 0) return;
    const next = redoStackRef.current.pop()!;
    pushHistorySnapshot('undo', next.type, buildSnapshot(content, selectionStart, selectionEnd), next.diff);
    applySnapshotProgrammatically(next.snapshot);
    setEditHistoryCount(undoStackRef.current.length + redoStackRef.current.length);
  }, [applySnapshotProgrammatically, content, selectionStart, selectionEnd, pushHistorySnapshot, buildSnapshot]);

`;
  code = code.substring(0, sIdx) + newUndoRedo + code.substring(eIdx);
  fs.writeFileSync('src/components/MarkdownEditor.tsx', code);
  console.log('step2e done');
}
