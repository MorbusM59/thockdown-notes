/**
 * Where the desktop's visualizer listens to the live soundscape
 * (`soundscapeLivePlayback.ts`): one node per output context that every
 * playback feeds its mix into, after brilliance and BEFORE its volume, and
 * the volume it is heard at. A playback created or closed while the
 * visualizer listens changes nothing on the listening side.
 *
 * The node goes nowhere but to whoever taps it, so nothing is computed for
 * it while nobody does.
 */

let tapNode: GainNode | null = null

/** The soundscape's audio at full scale, in `context`. */
export function soundscapeTapNode(context: BaseAudioContext): GainNode {
  if (!tapNode || tapNode.context !== context) tapNode = context.createGain()
  return tapNode
}

const SILENT = () => 0
let heardGain: () => number = SILENT

/** Set by the playback in force: the gain its volume is at now. */
export function setSoundscapeHeardGain(read: () => number): void {
  heardGain = read
}

/** A playback closing: it is heard no more, unless a newer one has taken over already. */
export function clearSoundscapeHeardGain(read: () => number): void {
  if (heardGain === read) heardGain = SILENT
}

/** The linear gain the soundscape is heard at now: 0 while nothing plays. */
export function soundscapeHeardGain(): number {
  return heardGain()
}
