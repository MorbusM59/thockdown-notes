import { describe, expect, it } from 'vitest'
import { buildPersistedBlockMap, restorePersistedBlockMap } from './persistedBlockMap'
import { splitMarkdownIntoPreviewBlocksIncremental } from './PreviewBlockSplit'

const TEXT = '# Title\n\nSome prose.\n\n- one\n- two\n'

function splitOf(text: string) {
  return splitMarkdownIntoPreviewBlocksIncremental(text, null)
}

describe('the persisted block map', () => {
  it('round trips: what is built for a text is accepted for that text', () => {
    return (async () => {
      const built = await buildPersistedBlockMap(splitOf(TEXT), TEXT)
      expect(built).toBeDefined()
      const restored = await restorePersistedBlockMap(built, TEXT)
      expect(restored.reason).toBe('restored')
      expect(restored.cache?.ranges).toEqual(splitOf(TEXT).ranges)
    })()
  })

  it('refuses a record from a different version', async () => {
    // The whole reason the version field exists. It went unenforced for one
    // of four writers, which hardcoded `v: 1` while its siblings used the
    // constant -- so the first bump would have had that writer stamping the
    // old version onto new-format data and this check waving it through.
    const built = await buildPersistedBlockMap(splitOf(TEXT), TEXT)
    const fromTheFuture = { ...built!, v: built!.v + 1 }
    expect((await restorePersistedBlockMap(fromTheFuture, TEXT)).reason).toBe('wrong-version')
    expect((await restorePersistedBlockMap(fromTheFuture, TEXT)).cache).toBeNull()
  })

  it('refuses a record whose text has changed underneath it', async () => {
    // A note edited outside the app, restored from a backup, or synced from
    // elsewhere. A wrong map is not a slow note -- it is a caret landing in
    // the wrong place -- so this must fail closed.
    const built = await buildPersistedBlockMap(splitOf(TEXT), TEXT)
    const edited = TEXT.replace('Some prose.', 'Some prose.\n\nAnd more.')
    const restored = await restorePersistedBlockMap(built, edited)
    expect(restored.reason).toBe('text-changed')
    expect(restored.cache).toBeNull()
  })

  it('has nothing to say when the in-memory map is for other text', async () => {
    // UNDEFINED, not null: callers must omit the field, because an omitted
    // field keeps what is on disk and a null destroys it. A stale record
    // costs one hash on the next open; a destroyed good one costs a parse.
    expect(await buildPersistedBlockMap(splitOf('# Other\n'), TEXT)).toBeUndefined()
    expect(await buildPersistedBlockMap(null, TEXT)).toBeUndefined()
  })

  it('treats an absent record as absent rather than as an error', async () => {
    expect((await restorePersistedBlockMap(null, TEXT)).reason).toBe('absent')
    expect((await restorePersistedBlockMap(undefined, TEXT)).reason).toBe('absent')
  })

  it('carries no layout in the record at all', async () => {
    // The property that lets one record serve edit view, render view, every
    // window size and both size modes: a range is a block type and a line
    // span, and nothing else.
    const built = await buildPersistedBlockMap(splitOf(TEXT), TEXT)
    for (const range of built!.ranges) {
      expect(Object.keys(range).sort()).toEqual(['rangeEndLine1', 'rangeStartLine1', 'type'])
    }
  })

  it('tiles the document exactly, with no gaps or overlaps', async () => {
    const built = await buildPersistedBlockMap(splitOf(TEXT), TEXT)
    const ranges = built!.ranges
    expect(ranges[0].rangeStartLine1).toBe(1)
    for (let i = 1; i < ranges.length; i += 1) {
      expect(ranges[i].rangeStartLine1).toBe(ranges[i - 1].rangeEndLine1 + 1)
    }
    expect(ranges[ranges.length - 1].rangeEndLine1).toBe(TEXT.split('\n').length)
  })
})
