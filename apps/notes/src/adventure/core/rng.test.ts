import { describe, expect, it } from 'vitest'
import { nextChance, nextFloat, nextInt, nextPick, nextSample, nextWeighted, toRngState } from './rng'

describe('rng', () => {
  it('is a pure function of its state: the same state always yields the same draw', () => {
    const first = nextFloat(12345)
    const second = nextFloat(12345)
    expect(second).toEqual(first)
    expect(first.rng).not.toBe(12345)
  })

  it('produces the same sequence from the same seed, which is what replay rests on', () => {
    const sequence = (seed: number) => {
      let rng = seed
      const values: number[] = []
      for (let index = 0; index < 50; index += 1) {
        const draw = nextInt(rng, 1, 6)
        rng = draw.rng
        values.push(draw.value)
      }
      return values
    }
    expect(sequence(99)).toEqual(sequence(99))
    expect(sequence(99)).not.toEqual(sequence(100))
  })

  it('keeps integer draws inside their range, both ends included', () => {
    let rng = toRngState(7)
    const seen = new Set<number>()
    for (let index = 0; index < 500; index += 1) {
      const draw = nextInt(rng, 1, 6)
      rng = draw.rng
      expect(draw.value).toBeGreaterThanOrEqual(1)
      expect(draw.value).toBeLessThanOrEqual(6)
      seen.add(draw.value)
    }
    // A die that never rolls a 1 or a 6 is the classic off-by-one, and it
    // survives a range assertion happily.
    expect([...seen].sort()).toEqual([1, 2, 3, 4, 5, 6])
  })

  it('treats impossible and certain chances honestly', () => {
    expect(nextChance(1, 0).value).toBe(false)
    expect(nextChance(1, 1).value).toBe(true)
  })

  it('samples without repeats and stops at the size of the pool', () => {
    const pool = ['a', 'b', 'c']
    const sample = nextSample(5, pool, 10)
    expect([...sample.value].sort()).toEqual(['a', 'b', 'c'])
  })

  it('returns null rather than undefined behaviour for an empty pool', () => {
    expect(nextPick(1, []).value).toBeNull()
    expect(nextWeighted(1, [], () => 1).value).toBeNull()
  })

  it('never picks a weight of zero, so content can switch an entry off', () => {
    const pool = [
      { id: 'off', weight: 0 },
      { id: 'on', weight: 1 },
    ]
    let rng = 3
    for (let index = 0; index < 100; index += 1) {
      const draw = nextWeighted(rng, pool, (entry) => entry.weight)
      rng = draw.rng
      expect(draw.value?.id).toBe('on')
    }
  })
})
