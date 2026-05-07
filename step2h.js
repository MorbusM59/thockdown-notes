const fs = require('fs');
let code = fs.readFileSync('src/components/MarkdownEditor.tsx', 'utf-8');

const keydownTarget = `  const handleTextareaKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (showPreview) return;

    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      if (e.shiftKey) {
        handleRedo();
      } else {
        handleUndo();
      }
      return;
    }

    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
      e.preventDefault();
      handleRedo();
      return;
    }

    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      if (e.key === ' ') {
        bundlePreviousChars();
      }
      requestHistoryBoundary(e.key === ' ' ? 'bundled' : 'char');
    }

    if (e.key === 'Backspace' || e.key === 'Delete') {
      const el = textareaRef.current;
      if (el) {
        const start = selectionStart;
        const end = selectionEnd;
        if (start !== end) {
          requestHistoryBoundary('delete-selection');
        } else if (e.key === 'Backspace' && start > 0) {
          const deletedChar = content[start - 1];
          if (deletedChar === ' ' || deletedChar === '\\n') {
            requestHistoryBoundary('delete-boundary');
          } else {
            requestHistoryBoundary('char');
          }
        } else if (e.key === 'Delete' && start < content.length) {
          const deletedChar = content[start];
          if (deletedChar === ' ' || deletedChar === '\\n') {
            requestHistoryBoundary('delete-boundary');
          } else {
            requestHistoryBoundary('char');
          }
        }
      }
    }

    if (e.key === 'Enter') {
      bundlePreviousChars();
      e.preventDefault();
      const el = textareaRef.current;`;

code = code.replace(/  const handleTextareaKeyDown = \(e: React\.KeyboardEvent<HTMLDivElement>\) => \{\s*if \(showPreview\) return;\s*if \(e\.key === 'Enter' \|\| e\.key === ' '\) \{\s*bundlePreviousChars\(\);\s*\}\s*if \(e\.key === 'Enter'\) \{/, keydownTarget);

fs.writeFileSync('src/components/MarkdownEditor.tsx', code);
console.log('Intercepts injected');
