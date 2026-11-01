/**
 * Non-negative matrix factor DECONVOLUTION (NMFD; Smaragdis 2004), the
 * standard model for drum transcription (Lindsay-Smith, McDonald and Sandler
 * 2012; Dittmar and Mueller 2016): a magnitude spectrogram V (F bands by N
 * frames) is explained as a SUM of K templates, each a short spectrogram of
 * its own (F by T frames: a sound's spectrum AND how it evolves), each played
 * by its own non-negative activation over time:
 *
 *   V[f][n] ~ L[f][n] = sum over k, t of W[k][t][f] * H[k][n - t]
 *
 * Overlapping sounds add, so a kick under a hat is the kick's activation plus
 * the hat's, with nothing to decide about who owns which band. Fitted by the
 * multiplicative updates for the generalised Kullback-Leibler divergence,
 * which keep everything non-negative without a clamp and decrease the
 * divergence monotonically (Lee and Seung 2001, extended to the convolutive
 * model by Smaragdis). Pure arithmetic on Float32Arrays, frame-major.
 */

/** Templates: K by T by F, flattened as [(k * T + t) * F + f]. */
export interface Templates {
  K: number
  T: number
  F: number
  w: Float32Array
}

const EPS = 1e-9

/** The model's reconstruction of `v`'s frames from `w` and activations `h` (K by N, [k * N + n]). */
export function reconstruct(tpl: Templates, h: Float32Array, n: number, out = new Float32Array(n * tpl.F)): Float32Array {
  const { K, T, F, w } = tpl
  out.fill(0)
  for (let k = 0; k < K; k++) {
    for (let i = 0; i < n; i++) {
      const a = h[k * n + i]
      if (a === 0) continue
      for (let t = 0; t < T && i + t < n; t++) {
        const row = (k * T + t) * F
        const o = (i + t) * F
        for (let f = 0; f < F; f++) out[o + f] += a * w[row + f]
      }
    }
  }
  return out
}

/**
 * Updates the activations `h` (K by N) for spectrogram `v` (N frames of F,
 * [n * F + f]) with the templates held, `iterations` times. Frames before
 * `from` keep their activations: they are already final, and the update of
 * a later frame still reads them through the convolution.
 */
export function fitActivations(tpl: Templates, v: Float32Array, n: number, h: Float32Array, iterations: number, from = 0): void {
  const { K, T, F, w } = tpl
  const lambda = new Float32Array(n * F)
  const ratio = new Float32Array(n * F)
  // The column sums of each template frame: the denominator of the KL update.
  const norm = new Float32Array(K)
  for (let k = 0; k < K; k++) {
    let s = 0
    for (let t = 0; t < T; t++) for (let f = 0; f < F; f++) s += w[(k * T + t) * F + f]
    norm[k] = s + EPS
  }
  for (let it = 0; it < iterations; it++) {
    reconstruct(tpl, h, n, lambda)
    for (let j = 0; j < n * F; j++) ratio[j] = v[j] / (lambda[j] + EPS)
    for (let k = 0; k < K; k++) {
      for (let i = from; i < n; i++) {
        let num = 0
        for (let t = 0; t < T && i + t < n; t++) {
          const row = (k * T + t) * F
          const o = (i + t) * F
          for (let f = 0; f < F; f++) num += w[row + f] * ratio[o + f]
        }
        h[k * n + i] *= num / norm[k]
      }
    }
  }
}

/** Updates the templates `w` for spectrogram `v` with the activations held, once. */
export function fitTemplates(tpl: Templates, v: Float32Array, n: number, h: Float32Array): void {
  const { K, T, F, w } = tpl
  const lambda = reconstruct(tpl, h, n)
  const ratio = new Float32Array(n * F)
  for (let j = 0; j < n * F; j++) ratio[j] = v[j] / (lambda[j] + EPS)
  for (let k = 0; k < K; k++) {
    for (let t = 0; t < T; t++) {
      let hs = 0
      for (let i = 0; i + t < n; i++) hs += h[k * n + i]
      const row = (k * T + t) * F
      for (let f = 0; f < F; f++) {
        let num = 0
        for (let i = 0; i + t < n; i++) {
          const a = h[k * n + i]
          if (a !== 0) num += a * ratio[(i + t) * F + f]
        }
        w[row + f] *= num / (hs + EPS)
      }
    }
  }
}

/**
 * Scales each template to unit total and moves the scale into its
 * activation, so a template is a SHAPE and its activation carries the level.
 */
export function normalize(tpl: Templates, h: Float32Array, n: number): void {
  const { K, T, F, w } = tpl
  for (let k = 0; k < K; k++) {
    let s = 0
    for (let j = 0; j < T * F; j++) s += w[k * T * F + j]
    if (!(s > 0)) continue
    for (let j = 0; j < T * F; j++) w[k * T * F + j] /= s
    for (let i = 0; i < n; i++) h[k * n + i] *= s
  }
}

/** Alternates template and activation updates `iterations` times, from the templates and activations given. */
export function factorize(tpl: Templates, v: Float32Array, n: number, h: Float32Array, iterations: number): void {
  for (let it = 0; it < iterations; it++) {
    fitActivations(tpl, v, n, h, 1)
    fitTemplates(tpl, v, n, h)
    normalize(tpl, h, n)
  }
}

/** The generalised KL divergence of the model from `v`: what the fit minimizes, for tests. */
export function divergence(tpl: Templates, v: Float32Array, n: number, h: Float32Array): number {
  const l = reconstruct(tpl, h, n)
  let d = 0
  for (let j = 0; j < n * tpl.F; j++) {
    const a = v[j]
    const b = l[j] + EPS
    d += (a > 0 ? a * Math.log(a / b) : 0) - a + b
  }
  return d
}
