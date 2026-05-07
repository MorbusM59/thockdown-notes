const fs = require('fs');
let code = fs.readFileSync('src/components/MarkdownEditor.tsx', 'utf-8');

let s = code.indexOf('  const handleUndo = useCallback(() => {\n    const history = editHistoryRef.current;');
let e = code.indexOf('  const requestHistoryBoundary', s);
if (s > -1 && e > -1) {
  code = code.substring(0, s) + code.substring(e);
}

fs.writeFileSync('src/components/MarkdownEditor.tsx', code);
console.log('Removed duplicate old handleUndo/handleRedo');
