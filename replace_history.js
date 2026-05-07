const fs = require('fs');

let code = fs.readFileSync('src/components/MarkdownEditor.tsx', 'utf-8');

const startRecord = code.indexOf('  const recordHistoryEntry = useCallback');
const endRecord = code.indexOf('  const loadHistoryForNote', startRecord);

if (startRecord !== -1) {
  const newRecordHistory = 
`  const pushHistorySnapshot = useCallback((type: 'undo' | 'redo', currentText: string, currentSelectionStart: number, currentSelectionEnd: number) => {
    const stack = type === 'undo' ? undoStackRef.current : redoStackRef.current;
    stack.push({ content: currentText, selectionStart: currentSelectionStart, selectionEnd: currentSelectionEnd });
    if (stack.length > 50) stack.shift();
    setEditHistoryCount((prev) => prev + 1);
  }, []);

  const commitSnapshotForUndo = useCallback((currentText: string, currentSelectionStart: number, currentSelectionEnd: number) => {
    redoStackRef.current = [];
    pushHistorySnapshot('undo', currentText, currentSelectionStart, currentSelectionEnd);
  }, [pushHistorySnapshot]);

`;

  code = code.substring(0, startRecord) + newRecordHistory + code.substring(endRecord);
  fs.writeFileSync('src/components/MarkdownEditor.tsx', code);
  console.log('Replaced history logic.');
} else {
  console.log('Hooks not found!');
}
