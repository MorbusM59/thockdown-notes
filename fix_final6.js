const fs = require('fs');

let code = fs.readFileSync('src/components/MarkdownEditor.tsx', 'utf-8').replace(/\r\n/g, '\n');

// 1. replace imports
const oldImport = `import {
  ArchivedParagraphHistoryEntry,
  EditHistoryEntry,
  EditSnapshot,
  Note,
  NoteEditHistoryState,
  RecentEditHistoryEntry,
} from '../shared/types';`;
const newImport = `import { EditSnapshot, Note } from '../shared/types';`;
code = code.replace(oldImport, newImport);

// 2. Remove purely history functions:
let fnNames = [
  "const EMPTY_EDIT_HISTORY_STATE: NoteEditHistoryState = {",
  "function cloneEmptyEditHistoryState(): NoteEditHistoryState {",
  "function countLineBreaks(text: string): number {",
  "function splitTextIntoLines(text: string): string[] {",
  "function createArchivedParagraphEntry(entry: RecentEditHistoryEntry): ArchivedParagraphHistoryEntry | null {",
  "function addRecentHistoryEntry(history: NoteEditHistoryState, entry: RecentEditHistoryEntry): NoteEditHistoryState {",
  "function replaceLineRange(lines: string[], startLine: number, endLine: number, newLines: string[]): string[] {",
  "function applyHistoryEntry(currentContent: string, entry: EditHistoryEntry, direction: 'undo' | 'redo'): EditSnapshot {"
];

for(let fn of fnNames) {
  let startIdx = code.indexOf(fn);
  if(startIdx > -1) {
    // Find the next top-level declaration or the end of the block.
    // For these, we can just use simple string matching of the next definition or rely on ending brace `\n}\n\n`.
    let endIdx;
    if(fn.startsWith("const EMPTY_EDIT_HISTORY")) {
       endIdx = code.indexOf("};", startIdx);
       if(endIdx > -1) {
         code = code.substring(0, startIdx) + code.substring(endIdx + 3);
       }
    } else {
       // Search for "\n}\n" starting from startIdx
       let braceEnd = code.indexOf("}\n", startIdx);
       // it could be nested braces... actually it's easier to just rely on regex for these since they don't have deeply complex nesting, except createArchivedParagraphEntry.
       // Actually all of these end with '\n}\n\n' or just '\n}\n' at the outer scope! 
    }
  }
}
fs.writeFileSync('src/components/MarkdownEditor.tsx', code);
