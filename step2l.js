const fs = require('fs');
let code = fs.readFileSync('src/components/MarkdownEditor.tsx', 'utf-8');

// Regex match to remove them
let s2 = code.indexOf('const EMPTY_EDIT_HISTORY_STATE');
let e2 = code.indexOf('const MarkdownEditor: React.FC<MarkdownEditorProps>');

if (s2 > -1 && e2 > -1) {
  code = code.substring(0, s2) + code.substring(e2);
}

// Remove editHistoryRef
code = code.replace(/  const editHistoryRef = useRef<NoteEditHistoryState>\([\s\S]*?\);\r?\n/, '');

// Remove persistEditHistory
code = code.replace(/  const persistEditHistory = useCallback\(async \(noteId: number, history: NoteEditHistoryState\) => \{\s*if \(\!window\.electronAPI\) return;\s*try \{[\s\S]*?  \}\), \[\]\);\r?\n/, '');

// Remove replaceEditHistory
code = code.replace(/  const replaceEditHistory = useCallback\(\(nextHistory: NoteEditHistoryState\) => \{\s*editHistoryRef\.current = nextHistory;\s*setEditHistoryCount\(nextHistory\.recent\.length \+ nextHistory\.redo\.length\);\s*persistEditHistory\(note\.id, nextHistory\);\s*\}\, \[note, persistEditHistory\]\);\r?\n/, '');


const historyBoundaryStr = "type HistoryBoundaryReason = 'paste' | 'change' | 'space' | 'delete-boundary' | 'delete-selection' | 'delete-forward';";
code = code.replace(historyBoundaryStr, "type HistoryBoundaryReason = 'paste' | 'change' | 'space' | 'delete-boundary' | 'delete-selection' | 'delete-forward' | 'bundled' | 'char';");

fs.writeFileSync('src/components/MarkdownEditor.tsx', code);
console.log('Cleaned up obsolete functions');
