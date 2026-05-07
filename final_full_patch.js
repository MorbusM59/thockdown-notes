const fs = require('fs');
let code = fs.readFileSync('src/components/MarkdownEditor.tsx', 'utf8');

// 1. imports
code = code.replace(/import \{\r?\n\s*ArchivedParagraphHistoryEntry,\r?\n\s*EditHistoryEntry,\r?\n\s*EditSnapshot,\r?\n\s*Note,\r?\n\s*NoteEditHistoryState,\r?\n\s*RecentEditHistoryEntry,\r?\n\} from '\.\.\/shared\/types';/, "import {\r\n  EditSnapshot,\r\n  Note,\r\n} from '../shared/types';");

// 2. UndoEntry def
code = code.replace(/type HistoryBoundaryReason = 'space' \| 'enter' \| 'delete-boundary' \| 'paste' \| 'delete-selection' \| 'tab';/, "type HistoryBoundaryReason = 'space' | 'enter' | 'delete-boundary' | 'paste' | 'delete-selection' | 'tab';\r\n\r\ntype UndoEntry = { type: 'char' | 'paste' | 'bundled'; snapshot: EditSnapshot; diff: number; };\r\nconst MAX_UNDO_CHARS = 1000;");

// 3. remove utility functions
const cloneFunc = "function cloneEmptyEditHistoryState(): NoteEditHistoryState {";
const cloneStartIdx = code.indexOf(cloneFunc);
if (cloneStartIdx > -1) {
   const applyFunc = "function applyHistoryEntry(currentContent: string, entry: EditHistoryEntry, direction: 'undo' | 'redo'): EditSnapshot {";
   const applyStartIdx = code.indexOf(applyFunc, cloneStartIdx);
   if (applyStartIdx > -1) {
     const applyEndStr = "  };\r\n}\r\n";
     const endIdx = code.indexOf(applyEndStr, applyStartIdx);
     if (endIdx > -1) {
        code = code.substring(0, cloneStartIdx) + code.substring(endIdx + applyEndStr.length);
     }
   }
}

// 4. remove EMPTY_EDIT_HISTORY_STATE
const emptyStateStr = "const EMPTY_EDIT_HISTORY_STATE: NoteEditHistoryState = {";
const emptyStartIdx = code.indexOf(emptyStateStr);
if (emptyStartIdx > -1) {
  const emptyEndStr = "  storedChangeCount: 0,\r\n};\r\n\r\n";
  const endIdx = code.indexOf(emptyEndStr, emptyStartIdx);
  if (endIdx > -1) {
    code = code.substring(0, emptyStartIdx) + code.substring(endIdx + emptyEndStr.length);
  }
}

fs.writeFileSync('src/components/MarkdownEditor.tsx', code);
