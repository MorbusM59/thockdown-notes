const fs = require('fs');
let code = fs.readFileSync('src/components/MarkdownEditor.tsx', 'utf-8').replace(/\r\n/g, '\n');

// 1. Fix the type syntax error:
code = code.replace(`type EditState = {\ntype UndoEntry = {`, `type EditState = {
  selectionStart: number;
  scrollTop: number;
  viewportStartRow?: number;
};

type UndoEntry = {`);

// 2. Fix handleUndo and handleRedo
const undoOldStart = `  const handleUndo = useCallback(() => {`;
const redoOldEndStr = `  }, [applySnapshotProgrammatically, content, selectionStart, selectionEnd, pushHistorySnapshot]);\n`;
// Find handleRedo end string which is the second occurrence of this ending footprint after undoOldStart.
const firstEnd = code.indexOf(redoOldEndStr, code.indexOf(undoOldStart));
const secondEnd = code.indexOf(redoOldEndStr, firstEnd + redoOldEndStr.length) + redoOldEndStr.length;

if (code.indexOf(undoOldStart) > -1 && secondEnd > -1) {
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

  code = code.substring(0, code.indexOf(undoOldStart)) + newUndoRedo + code.substring(secondEnd);
}

fs.writeFileSync('src/components/MarkdownEditor.tsx', code);
console.log('Finished step2');
