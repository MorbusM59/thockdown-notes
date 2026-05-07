const fs = require('fs');

let code = fs.readFileSync('src/components/MarkdownEditor.tsx', 'utf-8');

// 1. replace `editHistoryRef` and related state with `undoStackRef`, `redoStackRef`, `undoTotalDiffRef`
const stateStartStr = "  const editHistoryRef = useRef<NoteEditHistoryState>(cloneEmptyEditHistoryState());";
const newStates = `  const undoStackRef = useRef<UndoEntry[]>([]);
  const redoStackRef = useRef<UndoEntry[]>([]);
  const undoTotalDiffRef = useRef<number>(0);`;
code = code.replace(stateStartStr, newStates);

// 2. Remove persistEditHistory and replaceEditHistory
const persistStr = `  const persistEditHistory = useCallback(async (noteId: number, history: NoteEditHistoryState) => {`;
const persistStartIdx = code.indexOf(persistStr);
let persistEndIdx = code.indexOf('  }, [note, persistEditHistory]);', persistStartIdx);
if (persistEndIdx > -1) {
  persistEndIdx = code.indexOf('\n', persistEndIdx) + 1;
  code = code.substring(0, persistStartIdx) + code.substring(persistEndIdx); // Wipe the two functions out
}

// 3. Remove useEffect getNoteEditHistory
const effStr = "    void window.electronAPI.getNoteEditHistory(noteId).then((history) => {";
let effIdx = code.indexOf(effStr);
if (effIdx > -1) {
  let eEnd = code.indexOf('});', effIdx);
  eEnd = code.indexOf('\n', eEnd) + 1;
  code = code.substring(0, effIdx) + code.substring(eEnd);
}

fs.writeFileSync('src/components/MarkdownEditor.tsx', code);
console.log('Phase B Done');
