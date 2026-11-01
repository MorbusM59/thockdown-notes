/**
 * Where the caret is in its beat, from the beat map's two beats around the
 * listener (`BeatMap.beatsAround`): the share of the way from one to the
 * next, and the span between them. The caret keeps to one octave of tempo,
 * from `MIN_BPM` up to but not including `MAX_BPM`, so the music read at 174
 * beats a minute pulses at 87 and at 60 pulses at 120: the map's beats are
 * then taken in pairs, or each split in two, by the beat's NUMBER, so the
 * pairing never changes from one beat to the next.
 */

/** The caret's tempo range, in beats a minute: from MIN_BPM up to but not including MAX_BPM. */
export const MIN_BPM = 70
export const MAX_BPM = 2 * MIN_BPM

export interface CaretBeat {
  /** How far into the caret's beat `time` is, 0..1; NaN where there is no beat. */
  phase: number
  /** The caret's beat period, in seconds; NaN where there is no beat. */
  period: number
}

const NONE: CaretBeat = { phase: NaN, period: NaN }

/** The caret's beat at media time `time`, between the map's beats `before` (number `index`) and `after`. */
export function caretBeat(before: number, after: number, index: number, time: number): CaretBeat {
  const span = after - before
  if (!(span > 0) || Number.isNaN(index)) return NONE
  const local = Math.max(0, Math.min(1, (time - before) / span))
  // The octaves between the map's tempo and the caret's range: positive is
  // too fast (2^k map beats make one caret beat), negative too slow (each map
  // beat is split into 2^-k).
  const k = Math.floor(Math.log2(60 / span / MIN_BPM))
  if (k > 0) {
    const group = 2 ** k
    const within = ((index % group) + group) % group
    return { phase: (within + local) / group, period: span * group }
  }
  if (k < 0) {
    const at = local * 2 ** -k
    return { phase: at - Math.floor(at), period: span / 2 ** -k }
  }
  return { phase: local, period: span }
}
