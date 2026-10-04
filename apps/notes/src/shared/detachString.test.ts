import { describe, expect, it } from 'vitest'
import { detachString } from './detachString'

// What detachString is FOR (not retaining the parent) is a property of V8's
// heap and is measured by scripts/perf/measureTypingRetention.mjs; this only
// holds that the copy is the same text, astral characters included.
describe('detachString', () => {
  it('returns the same text', () => {
    const parent = `# ${'A long heading with 🎉 astral characters '.repeat(3)}\n${'body '.repeat(1000)}`
    for (const value of ['', 'x', parent.slice(2, 60), parent.slice(0, parent.indexOf('\n')), '🎉🎉 surrogate pairs 🎉']) {
      expect(detachString(value)).toBe(value)
    }
  })
})
