import { describe, expect, it } from 'vitest'
import { divergence, factorize, fitActivations, reconstruct, type Templates } from './nmfd'

function rng(seed: number): () => number {
  let s = seed
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32 }
}

/** Two sounds: a low one dying away, a bright one short; played at their own times, often together. */
function scene(n: number): { truth: Templates; h: Float32Array; v: Float32Array } {
  const K = 2, T = 6, F = 12
  const w = new Float32Array(K * T * F)
  for (let t = 0; t < T; t++) for (let f = 0; f < F; f++) {
    w[(0 * T + t) * F + f] = f < 4 ? Math.exp(-t / 3) * (4 - f) : 0
    w[(1 * T + t) * F + f] = f >= 6 ? Math.exp(-t / 1) * (f - 5) : 0
  }
  const h = new Float32Array(K * n)
  for (let i = 0; i < n; i += 16) h[i] = 1
  for (let i = 8; i < n; i += 16) h[n + i] = 0.7
  for (let i = 32; i < n; i += 64) h[n + i] = 0.5
  const truth = { K, T, F, w }
  return { truth, h, v: reconstruct(truth, h, n) }
}

describe('NMFD', () => {
  it('lowers the divergence with every alternating update', () => {
    const n = 256
    const { truth, v } = scene(n)
    const r = rng(1)
    const tpl: Templates = { ...truth, w: truth.w.map(() => 0.1 + r()) }
    const h = new Float32Array(truth.K * n).map(() => 0.1 + r())
    let last = divergence(tpl, v, n, h)
    for (let i = 0; i < 20; i++) {
      factorize(tpl, v, n, h, 1)
      const d = divergence(tpl, v, n, h)
      expect(d).toBeLessThanOrEqual(last * (1 + 1e-6))
      last = d
    }
  })

  it('with the true templates, finds each sound where it plays, also where both play at once', () => {
    const n = 256
    const { truth, h, v } = scene(n)
    const fit = new Float32Array(truth.K * n).fill(0.1)
    fitActivations(truth, v, n, fit, 200)
    for (const k of [0, 1]) for (let i = 0; i < n - 8; i++) {
      if (h[k * n + i] > 0) expect(fit[k * n + i]).toBeGreaterThan(0.8 * h[k * n + i])
    }
  })
})
