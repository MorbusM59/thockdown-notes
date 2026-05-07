const fs = require('fs');
let code = fs.readFileSync('src/components/MarkdownEditor.tsx', 'utf-8');

// 1. Replacements for Imports
code = code.replace(/import \{\r?\n\s*ArchivedParagraphHistoryEntry,\r?\n\s*EditHistoryEntry,\r?\n\s*EditSnapshot,\r?\n\s*Note,\r?\n\s*NoteEditHistoryState,\r?\n\s*RecentEditHistoryEntry,\r?\n\} from '\.\.\/shared\/types';/, "import {\r\n  EditSnapshot,\r\n  Note,\r\n} from '../shared/types';");

// 2. Remove utility functions
code = code.replace(/function cloneEmptyEditHistoryState\(\): NoteEditHistoryState \{[\s\S]*?function applyHistoryEntry\([^)]+\): EditSnapshot \{[\s\S]*?return \{[\s\S]*?selectionEnd: entry\.afterSelection\.selectionEnd,\n  };\n}/, "");

code = code.replace(/const EMPTY_EDIT_HISTORY_STATE: NoteEditHistoryState = \{[\s\S]*?\};\n/, "");
code = code.replace(/type HistoryBoundaryReason = 'space' \| 'enter' \| 'delete-boundary' \| 'paste' \| 'delete-selection' \| 'tab';/, "");

// refs
const refOld = "  const editHistoryRef = useRef<NoteEditHistoryState>(cloneEmptyEditHistoryState());";
const refNew = "  const undoStackRef = useRef<UndoEntry[]>([]);\n  const redoStackRef = useRef<UndoEntry[]>([]);\n  const undoTotalDiffRef = useRef<number>(0);";
code = code.replace(refOld, refNew);

// persistence
code = code.replace(/const persistEditHistory = useCallback\(async \(noteId: number, history: NoteEditHistoryState\) => \{[\s\S]*?\}, \[\]\);\n/s, "");
code = code.replace(/const replaceEditHistory = useCallback\(\(nextHistory: NoteEditHistoryState\) => \{[\s\S]*?\}, \[persistEditHistory\]\);\n/s, "");

code = code.replace(/const recordHistoryEntry = useCallback\(\(reason: HistoryBoundaryReason, before: EditSnapshot, after: EditSnapshot\) => \{[\s\S]*?\}, \[note, replaceEditHistory\]\);\n/s, "");

code = code.replace(/void window\.electronAPI\.getNoteEditHistory\(noteId\)\.then\(\(history\) => \{[\s\S]*\}\)\.catch\(\(err\) => \{[\s\S]*\}\);\n/s, "");

fs.writeFileSync('src/components/MarkdownEditor.tsx', code);
