/**
 * How long each of the edit view's chunks stays on screen, and how long the
 * rest of the note will take at that pace.
 *
 * ## The words per minute is a promise about words
 * A chunk stays for a fixed FIXATION (the time to see and recognise a
 * fixation's worth of text, which does not shrink with a shorter chunk), a
 * time per letter, and a pause where the text pauses: one more fixation after
 * a sentence's end, half of one after a clause's. A line break's empty chunk
 * is one fixation. Those are the rapid serial visual presentation timings the
 * reader tunes.
 *
 * The fixations and pauses are not added ON TOP of the pace, they are spent
 * OUT of it: the per-letter time is solved so that the chunks read next take,
 * together, exactly `words × 60 / wpm` seconds. Solving it against one ideal
 * full row instead (the first version) left every pause, every short chunk
 * and every line break as time beyond the pace, and the note read at about
 * 80% of the figure shown at 600 and 67% at 1000.
 *
 * The solve is over a WINDOW of the chunks from the one on show onward
 * (`PACE_LOOKAHEAD_CHUNKS`), kept as running sums that move by one chunk per
 * step, so a dense passage and a passage of short lines each read at the pace
 * rather than one paying for the other. Where the fixations and pauses would
 * take more than `MAX_FIXED_SHARE` of the window's time, the fixation shrinks
 * with the pace instead of holding the reading below the figure: a high pace
 * is the reader asking for less time per chunk, fixation included.
 *
 * ## Time left
 * The window's chunks are timed exactly; past it, the remaining words are
 * counted once (`countWordsFrom`) and timed at the window's seconds per
 * word, so the estimate is the same model the reading runs on and costs a
 * subtraction per step rather than a walk of the note.
 */
import { countWordsFrom, nextChunk, type SpeedReadingChunk } from './speedReadingChunks'

/** Chunks from the one on show onward that the per-letter time is solved over. */
export const PACE_LOOKAHEAD_CHUNKS = 64

/** Marks that end a sentence, in any script this app's reader is likely to type. */
const SENTENCE_END = '.!?…‽⁇⁈⁉。！？'
/** Marks that end a clause. */
const CLAUSE_END = ',;:、，；：،'
/** What may follow the last mark without hiding it: closing quotes and brackets, emphasis. */
const TRAILING = /[\s"'«»‹›“”„‘’‚「」『』)\]}*_-]+$/u

/** What a chunk costs: its words and letters, and its fixations including the pause after it. */
export interface ChunkCost {
  words: number
  letters: number
  fixations: number
}

export function chunkCost(chunk: Pick<SpeedReadingChunk, 'text' | 'words'>): ChunkCost {
  const letters = chunk.text.replace(/\s/g, '').length
  const last = chunk.text.replace(TRAILING, '').slice(-1)
  const pause = last === '' ? 0 : SENTENCE_END.includes(last) ? 1 : CLAUSE_END.includes(last) ? 0.5 : 0
  return { words: chunk.words, letters, fixations: 1 + pause }
}

/**
 * The largest share of a window's time its fixations and pauses may take.
 * Past it the fixation shrinks with the pace rather than holding the reading
 * below the figure shown, so the letters always keep the other half.
 */
export const MAX_FIXED_SHARE = 0.5

export interface Pace {
  /** Seconds a fixation lasts at this pace: the reader's own, or less where that would not fit. */
  fixationSec: number
  perLetterSec: number
}

/** The fixation and per-letter seconds that make `sums` take exactly its words at `wpm`. */
export function paceFor(sums: ChunkCost, wpm: number, fixationSec: number): Pace {
  const budget = (sums.words * 60) / Math.max(1, wpm)
  const fixation = sums.fixations > 0 ? Math.min(fixationSec, (budget * MAX_FIXED_SHARE) / sums.fixations) : fixationSec
  if (sums.letters <= 0) return { fixationSec: fixation, perLetterSec: 0 }
  return { fixationSec: fixation, perLetterSec: Math.max(0, budget - sums.fixations * fixation) / sums.letters }
}

export function costDurationSec(cost: ChunkCost, pace: Pace): number {
  return cost.fixations * pace.fixationSec + cost.letters * pace.perLetterSec
}

function add(into: ChunkCost, cost: ChunkCost, sign: 1 | -1): void {
  into.words += sign * cost.words
  into.letters += sign * cost.letters
  into.fixations += sign * cost.fixations
}

/**
 * The edit view's reading position and its pace: the chunk on show, the
 * window ahead of it, and the words past the window.
 */
export class EditPacer {
  private readonly window: Array<{ chunk: SpeedReadingChunk; cost: ChunkCost }> = []
  private readonly sums: ChunkCost = { words: 0, letters: 0, fixations: 0 }
  private wordsBeyond: number

  constructor(private readonly text: string, first: SpeedReadingChunk, private readonly width: number) {
    this.push(first)
    while (this.window.length < PACE_LOOKAHEAD_CHUNKS && this.extend()) { /* fill the window */ }
    this.wordsBeyond = countWordsFrom(text, this.window[this.window.length - 1].chunk.end)
  }

  get current(): SpeedReadingChunk {
    return this.window[0].chunk
  }

  /** Moves to the next chunk; false at the note's end. */
  advance(): boolean {
    if (this.window.length < 2) return false
    const left = this.window.shift()!
    add(this.sums, left.cost, -1)
    const before = this.window[this.window.length - 1].chunk.end
    if (this.extend()) {
      // The words past the window are counted once and handed over as it grows.
      const added = this.window[this.window.length - 1].cost.words
      this.wordsBeyond = Math.max(0, this.wordsBeyond - added)
    } else if (before >= this.text.length) {
      this.wordsBeyond = 0
    }
    return true
  }

  /** Steps back to the chunk that began at `start`. */
  back(start: number): void {
    const chunk = nextChunk(this.text, start, this.width)
    if (!chunk) return
    const entry = { chunk, cost: chunkCost(chunk) }
    this.window.unshift(entry)
    add(this.sums, entry.cost, 1)
    if (this.window.length > PACE_LOOKAHEAD_CHUNKS) {
      const dropped = this.window.pop()!
      add(this.sums, dropped.cost, -1)
      this.wordsBeyond += dropped.cost.words
    }
  }

  /** Seconds the chunk on show stays at full pace. */
  durationSec(wpm: number, fixationMs: number): number {
    return costDurationSec(this.window[0].cost, paceFor(this.sums, wpm, Math.max(0, fixationMs) / 1000))
  }

  /** Seconds from the next chunk to the note's end, reading on at full pace. */
  timeLeftSec(wpm: number, fixationMs: number): number {
    const pace = paceFor(this.sums, wpm, Math.max(0, fixationMs) / 1000)
    let windowSec = 0
    for (const { cost } of this.window) windowSec += costDurationSec(cost, pace)
    const aheadSec = windowSec - costDurationSec(this.window[0].cost, pace)
    const secPerWord = this.sums.words > 0 ? windowSec / this.sums.words : 60 / Math.max(1, wpm)
    return aheadSec + this.wordsBeyond * secPerWord
  }

  private push(chunk: SpeedReadingChunk): void {
    const entry = { chunk, cost: chunkCost(chunk) }
    this.window.push(entry)
    add(this.sums, entry.cost, 1)
  }

  private extend(): boolean {
    const next = nextChunk(this.text, this.window[this.window.length - 1].chunk.end, this.width)
    if (!next) return false
    this.push(next)
    return true
  }
}

/** Seconds as `hh:mm:ss`. */
export function formatClock(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds))
  const two = (n: number) => String(n).padStart(2, '0')
  return `${two(Math.floor(s / 3600))}:${two(Math.floor((s % 3600) / 60))}:${two(s % 60)}`
}
