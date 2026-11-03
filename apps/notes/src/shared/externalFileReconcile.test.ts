import { describe, expect, it } from 'vitest'
import { reconcileExternalFile } from './externalFileReconcile'

describe('reconcileExternalFile', () => {
  it('names each case', () => {
    expect(reconcileExternalFile('a', 'a', 'a')).toBe('unchanged')
    expect(reconcileExternalFile('a', 'a', 'mine')).toBe('unchanged')
    expect(reconcileExternalFile('a', 'b', 'b')).toBe('inSync')
    expect(reconcileExternalFile('a', 'b', 'a')).toBe('adopt')
    expect(reconcileExternalFile('a', 'b', 'mine')).toBe('conflict')
    expect(reconcileExternalFile(null, 'b', 'a')).toBe('conflict')
    expect(reconcileExternalFile(null, 'b', 'b')).toBe('inSync')
  })

  // The rule is applied again on every read of the file, so applying its own
  // outcome must reach a state it then leaves alone, and must never drop a
  // text the reader typed: every live text either survives or was already
  // the baseline (and therefore on the Timeline).
  it('reaches a fixed point and never loses the reader\'s text', () => {
    const texts = [null, 'a', 'b', 'c']
    for (const baseline of texts) {
      for (const disk of texts.filter((text): text is string => text !== null)) {
        for (const live of texts.filter((text): text is string => text !== null)) {
          const outcome = reconcileExternalFile(baseline, disk, live)
          // What each outcome writes: the file becomes the baseline (unless
          // unchanged), and only `adopt` replaces the live text.
          const nextBaseline = outcome === 'unchanged' ? baseline : disk
          const nextLive = outcome === 'adopt' ? disk : live
          expect(reconcileExternalFile(nextBaseline, disk, nextLive)).toBe('unchanged')
          if (nextLive !== live) expect(live).toBe(baseline)
        }
      }
    }
  })
})
