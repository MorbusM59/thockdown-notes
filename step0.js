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

// 2. Remove purely history functions carefully:
const fnsToRemove = [
  "const EMPTY_EDIT_HISTORY_STATE: NoteEditHistoryState = {",
  "function cloneEmptyEditHistoryState(): NoteEditHistoryState {",
  "function countLineBreaks(text: string): number {",
  "function splitTextIntoLines(text: string): string[] {",
  "function createArchivedParagraphEntry(entry: RecentEditHistoryEntry): ArchivedParagraphHistoryEntry | null {",
  "function addRecentHistoryEntry(history: NoteEditHistoryState, entry: RecentEditHistoryEntry): NoteEditHistoryState {",
  "function replaceLineRange(lines: string[], startLine: number, endLineExclusive: number, replacement: string[]): string[] {",
  "function applyHistoryEntry(currentContent: string, entry: EditHistoryEntry, direction: 'undo' | 'redo'): EditSnapshot {"
];

for(const fn of fnsToRemove) {
  let startIndex = code.indexOf(fn);
  if(startIndex > -1) {
    let braceLevel = 0;
    let inString = false;
    let endIndex = startIndex;
    for(let i = startIndex; i < code.length; i++) {
        if(code[i] === '"' || code[i] === "'") inString = !inString;
        if(!inString) {
            if(code[i] === '{') braceLevel++;
            if(code[i] === '}') {
                braceLevel--;
                if(braceLevel === 0) {
                    endIndex = i + 1;
                    // remove trailing newline if present, actually just remove it.
                    if(code[endIndex] === '\n') endIndex++;
                    if(code[endIndex] === '\n') endIndex++;
                    break;
                }
            }
        }
    }
    code = code.substring(0, startIndex) + code.substring(endIndex);
  }
}
fs.writeFileSync('src/components/MarkdownEditor.tsx', code);
console.log('Done cleaning fns');
