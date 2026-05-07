const fs = require('fs');

let code = fs.readFileSync('src/components/MarkdownEditor.tsx', 'utf-8');

const s1 = "import {\r\n  ArchivedParagraphHistoryEntry,\r\n  EditHistoryEntry,\r\n  EditSnapshot,\r\n  Note,\r\n  NoteEditHistoryState,\r\n  RecentEditHistoryEntry,\r\n} from '../shared/types';";
const t1 = "import {\r\n  EditSnapshot,\r\n  Note,\r\n} from '../shared/types';";
code = code.replace(s1, t1);
code = code.replace(s1.replace(/\r/g, ''), t1.replace(/\r/g, '')); // Just in case

const utilBegin = "const EMPTY_EDIT_HISTORY_STATE: NoteEditHistoryState = {";
const utilEndStr = "  };\r\n}\r\n";
const utilStartIdx = code.indexOf(utilBegin);
let utilEndIdx = code.indexOf(utilEndStr, utilStartIdx);
if (utilStartIdx > -1 && utilEndIdx > -1) {
  // need to find the `function applyHistoryEntry` and its end
  const applyStart = code.lastIndexOf('function applyHistoryEntry', utilEndIdx);
  const applyEndStr = "  };\n}\n";
  const actualEndIdx = code.indexOf("}\n", code.indexOf("selectionStart: entry.afterSelection.selectionStart,", applyStart)) + 2;
  code = code.substring(0, utilStartIdx) + code.substring(actualEndIdx);
} else {
  console.log("Could not find util functions");
}

const typeOld = "type HistoryBoundaryReason = 'paste' | 'change' | 'space' | 'delete-boundary' | 'delete-selection' | 'delete-forward';";
const typeNew = `type HistoryBoundaryReason = 'paste' | 'change' | 'space' | 'delete-boundary' | 'delete-selection' | 'delete-forward' | 'char' | 'bundled';
type UndoEntry = { type: 'char' | 'paste' | 'bundled'; snapshot: EditSnapshot; diff: number; };
const MAX_UNDO_CHARS = 1000;`;
code = code.replace(typeOld, typeNew);

const refOld = "  const editHistoryRef = useRef<NoteEditHistoryState>(cloneEmptyEditHistoryState());";
const refNew = `  const undoStackRef = useRef<UndoEntry[]>([]);
  const redoStackRef = useRef<UndoEntry[]>([]);
  const undoTotalDiffRef = useRef<number>(0);`;
code = code.replace(refOld, refNew);

// Remove persistEditHistory and replaceEditHistory
const persistStr = "  const persistEditHistory = useCallback(async (noteId: number, history: NoteEditHistoryState) => {";
const persistStartIdx = code.indexOf(persistStr);
if (persistStartIdx > -1) {
  const replaceEnd = code.indexOf("  }, [note, persistEditHistory]);", persistStartIdx) + 33;
  code = code.substring(0, persistStartIdx) + code.substring(replaceEnd);
}

// Remove useEffect getNoteEditHistory
const effStr = "void window.electronAPI.getNoteEditHistory(noteId).then((history) => {";
const effStartIdx = code.indexOf(effStr);
if (effStartIdx > -1) {
  const effEndIdx = code.indexOf("});", effStartIdx) + 3;
  code = code.substring(0, effStartIdx) + code.substring(effEndIdx);
  // remove the extra void ...
}

code = code.replace(/await window\.electronAPI\.saveNoteEditHistory\(noteId, history\);/, '');

fs.writeFileSync('src/components/MarkdownEditor.tsx', code);
console.log('Final replacement executed');
