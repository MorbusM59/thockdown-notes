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
    expect(snapshot.viewport.scrollTopLines).toBe(2 + RESTORE_OFFSET_LINES)
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
