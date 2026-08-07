import { describe, expect, it } from 'vitest'
import { findAnchorDefinitionLine, parseInternalPreviewHref } from './PreviewMarkdown'

describe('parseInternalPreviewHref', () => {
  it('parses an anchor definition', () => {
    expect(parseInternalPreviewHref('#todo')).toEqual({ kind: 'anchor-definition', anchorId: 'todo' })
  })

  it('rejects a bare "$" with nothing else -- not a link to anything', () => {
    expect(parseInternalPreviewHref('$')).toBeNull()
  })

  it('rejects anything not starting with "$" or "#"', () => {
    expect(parseInternalPreviewHref('MEETING-2')).toBeNull()
  })

  it('parses "this note" anchor-only ($#anchor-id)', () => {
    expect(parseInternalPreviewHref('$#todo')).toEqual({
      kind: 'internal-link', noteIdRaw: null, chapterIdRaw: null, anchorId: 'todo',
    })
  })

  it('parses a plain note-id link', () => {
    expect(parseInternalPreviewHref('$MEETING-2')).toEqual({
      kind: 'internal-link', noteIdRaw: 'MEETING-2', chapterIdRaw: null, anchorId: null,
    })
  })

  it('parses a note-id link with an anchor', () => {
    expect(parseInternalPreviewHref('$MEETING-2#todo')).toEqual({
      kind: 'internal-link', noteIdRaw: 'MEETING-2', chapterIdRaw: null, anchorId: 'todo',
    })
  })

  it('parses a note-id + chapter-id link', () => {
    expect(parseInternalPreviewHref('$MEETING-2§INTRO')).toEqual({
      kind: 'internal-link', noteIdRaw: 'MEETING-2', chapterIdRaw: 'INTRO', anchorId: null,
    })
  })

  it('parses a note-id + chapter-id + anchor link', () => {
    expect(parseInternalPreviewHref('$MEETING-2§INTRO#todo')).toEqual({
      kind: 'internal-link', noteIdRaw: 'MEETING-2', chapterIdRaw: 'INTRO', anchorId: 'todo',
    })
  })

  it('parses a chapter-of-"this note" link (bare $, chapter segment present)', () => {
    expect(parseInternalPreviewHref('$§INTRO')).toEqual({
      kind: 'internal-link', noteIdRaw: null, chapterIdRaw: 'INTRO', anchorId: null,
    })
  })

  it('parses a chapter-of-"this note" link with an anchor', () => {
    expect(parseInternalPreviewHref('$§INTRO#todo')).toEqual({
      kind: 'internal-link', noteIdRaw: null, chapterIdRaw: 'INTRO', anchorId: 'todo',
    })
  })

  it('decodes a percent-encoded chapter separator -- mdast-util-to-hast percent-encodes non-ASCII destination characters (CommonMark spec), so a real rendered href never contains a literal "§"', () => {
    expect(parseInternalPreviewHref('$MEETING-2%C2%A7INTRO')).toEqual({
      kind: 'internal-link', noteIdRaw: 'MEETING-2', chapterIdRaw: 'INTRO', anchorId: null,
    })
    expect(parseInternalPreviewHref('$MEETING-2%c2%a7INTRO#todo')).toEqual({
      kind: 'internal-link', noteIdRaw: 'MEETING-2', chapterIdRaw: 'INTRO', anchorId: 'todo',
    })
  })

  it('falls back to the raw href on a malformed percent-encoding instead of throwing', () => {
    expect(parseInternalPreviewHref('$MEETING-2%')).toEqual({
      kind: 'internal-link', noteIdRaw: 'MEETING-2%', chapterIdRaw: null, anchorId: null,
    })
  })

  it('treats an empty chapter segment ("§" with nothing after it) as no chapter segment at all', () => {
    expect(parseInternalPreviewHref('$MEETING-2§')).toEqual({
      kind: 'internal-link', noteIdRaw: 'MEETING-2', chapterIdRaw: null, anchorId: null,
    })
    expect(parseInternalPreviewHref('$MEETING-2§#todo')).toEqual({
      kind: 'internal-link', noteIdRaw: 'MEETING-2', chapterIdRaw: null, anchorId: 'todo',
    })
  })
})

describe('findAnchorDefinitionLine', () => {
  it('returns null when the anchor definition is absent', () => {
    expect(findAnchorDefinitionLine('no anchors here', 'todo')).toBeNull()
  })

  it('resolves a definition on the first line to line 0', () => {
    const text = '[Todo](#todo)\nsome other content'
    expect(findAnchorDefinitionLine(text, 'todo')).toBe(0)
  })

  it('counts newlines before the match to resolve a later line', () => {
    const text = 'line zero\nline one\n[Todo](#todo)\nline three'
    expect(findAnchorDefinitionLine(text, 'todo')).toBe(2)
  })

  it('requires an exact anchor id match, not a prefix', () => {
    const text = '[Todo List](#todo-list)\n[Todo](#todo)'
    expect(findAnchorDefinitionLine(text, 'todo')).toBe(1)
  })
})
