import { describe, it, expect } from 'vitest'
import { buildEditRestoreSnapshotFromUiState, RESTORE_OFFSET_LINES } from './EditRestoreMath'
import { splitMarkdownIntoPreviewBlocks } from './PreviewBlockSplit'

const text = [
  '# Title',            // line 0
  '',
  '## First section',   // line 2
  '',
  'Body of the first.', // line 4
  '',
  '## Second section',  // line 6
  '',
  'Body of the second.',// line 8
  '',
].join('\n')

const blocks = splitMarkdownIntoPreviewBlocks(text)
// Whichever block owns "## Second section" -- and the line the restore path
// resolves it back to, which is the block's own start line (blank lines
// between blocks belong to the block that follows them).
const storedAnchorBlockIndex = blocks.findIndex((block) => block.startLine >= 6)
const storedAnchorLine = blocks[storedAnchorBlockIndex].startLine

describe('buildEditRestoreSnapshotFromUiState — overrideSourceAnchorLine', () => {
  it('resumes the note where it was left when no override is given', () => {
    const snapshot = buildEditRestoreSnapshotFromUiState({
      noteId: 'n1',
      text,
      uiState: { cursorPos: 40, anchorBlockIndex: storedAnchorBlockIndex },
      fallbackViewport: null,
    })
    expect(snapshot.sourceAnchorLine).toBe(storedAnchorLine)
    expect(snapshot.collapsedSelection.start).toBe(40)
  })

  it('opens at the override line instead of the stored position', () => {
    const snapshot = buildEditRestoreSnapshotFromUiState({
      noteId: 'n1',
      text,
      uiState: { cursorPos: 40, anchorBlockIndex: storedAnchorBlockIndex },
      fallbackViewport: null,
      overrideCursorPos: text.indexOf('## First section'),
      overrideSourceAnchorLine: 2,
    })
    // The note lands on the linked-to heading, not on where it was last read.
    expect(snapshot.sourceAnchorLine).toBe(2)
    // MINUS the offset. Landing solves the reading equation
    // (anchor = scrollTop + topBoundary + offset) for scrollTop, so the offset
    // changes sides. This asserted the plus, which put the heading a full two
    // lines ABOVE the top of the viewport -- scrolled past rather than opened
    // at -- and, on the ordinary restore path, walked a note's position down
    // by two lines on every switch away and back.
    expect(snapshot.viewport.scrollTopLines).toBe(2 - RESTORE_OFFSET_LINES)
    expect(snapshot.collapsedSelection.start).toBe(text.indexOf('## First section'))
  })

  it('overrides even when the note has no stored position at all', () => {
    const snapshot = buildEditRestoreSnapshotFromUiState({
      noteId: 'n1',
      text,
      uiState: null,
      fallbackViewport: null,
      overrideCursorPos: text.indexOf('## Second section'),
      overrideSourceAnchorLine: 6,
    })
    expect(snapshot.sourceAnchorLine).toBe(6)
    expect(snapshot.collapsedSelection.start).toBe(text.indexOf('## Second section'))
  })

  it('ignores a non-finite override rather than landing at 0', () => {
    const snapshot = buildEditRestoreSnapshotFromUiState({
      noteId: 'n1',
      text,
      uiState: { cursorPos: 40, anchorBlockIndex: storedAnchorBlockIndex },
      fallbackViewport: null,
      overrideSourceAnchorLine: Number.NaN,
    })
    expect(snapshot.sourceAnchorLine).toBe(storedAnchorLine)
  })
})

describe('reading a position and landing on it are inverses', () => {
  // The property the whole shared-offset design rests on, asserted directly
  // rather than left to the two call sites to keep in step. They did not: the
  // landing formula added RESTORE_OFFSET_LINES where solving for scrollTop
  // subtracts it, so switching away from a note and back walked its viewport
  // down two lines at a time -- visibly, from the very top of a document,
  // settling on a heading once the walk stayed inside one block.
  const land = (anchorLine: number, topBoundaryLines = 0) => buildEditRestoreSnapshotFromUiState({
    noteId: 'n1',
    text,
    uiState: { cursorPos: 0 },
    fallbackViewport: { topBoundaryLines, bottomBoundaryLines: 0, scrollTopLines: 0 },
    overrideSourceAnchorLine: anchorLine,
  }).viewport.scrollTopLines

  // The read, as resolveSourceAnchorFromEditState performs it.
  const read = (scrollTopLines: number, topBoundaryLines = 0) =>
    scrollTopLines + topBoundaryLines + RESTORE_OFFSET_LINES

  it('leaves a document resting at the very top exactly where it is', () => {
    expect(land(read(0))).toBe(0)
  })

  it('leaves a document resting mid-text exactly where it is', () => {
    for (const scrollTopLines of [1, 2, 5, 40, 500]) {
      expect(land(read(scrollTopLines))).toBe(scrollTopLines)
    }
  })

  it('does not walk over repeated round trips', () => {
    let scrollTopLines = 0
    for (let trip = 0; trip < 10; trip += 1) {
      scrollTopLines = land(read(scrollTopLines))
    }
    expect(scrollTopLines).toBe(0)
  })

  it('holds with a reserved top boundary too', () => {
    for (const topBoundaryLines of [0, 1, 4]) {
      expect(land(read(7, topBoundaryLines), topBoundaryLines)).toBe(7)
    }
  })
})
