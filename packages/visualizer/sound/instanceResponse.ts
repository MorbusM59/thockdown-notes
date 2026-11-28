/**
 * How a tracker turns one instance's STRENGTH (a natural log of a rise) into
 * its response, 0..1, read alike by the music's drum score (`musicAnalysis.ts`)
 * and the soundscape's hits (`soundscapeSignals.ts`), so a tracker's contrast
 * means one thing whatever the instance came from.
 */

/** The share of a channel's instances that give a full response. */
const TOP_SHARE = 0.02
/**
 * The narrowest span a reader's stretch may use, in the score's strengths (natural logs of a flux): a channel whose
 * instances are all alike (a programmed kick) shows each in full rather than blowing their tiny differences up.
 */
const MIN_SPAN = Math.log(1.5)
/**
 * The fewest instances a response is ranked against. Fewer is no evidence of how strong the channel runs: right
 * after a restart (entering the visualizer, a seek, a new track) the music's score holds its first one or two onsets,
 * and the soundscape's history starts empty, so the first instance, however faint, ranked as its own top and showed
 * at full strength. Below this many the channel answers nothing.
 */
export const MIN_RANKED_INSTANCES = 8

/**
 * A reader's response to one instance of its channel: `strength` stretched
 * over `strengths` (that channel's in the score around the listener,
 * ascending), so `contrast` means one thing for every channel and every
 * track: the `contrast` share of the channel's instances shows nothing and
 * its top `TOP_SHARE` shows in full, whether the track is mastered loud or
 * quiet. Raising it is what keeps a channel to what is MOSTLY that channel:
 * a snare's slight thump is among the thumps' weakest.
 */
export function instanceResponse(strength: number, strengths: readonly number[], contrast: number): number {
  if (strengths.length < MIN_RANKED_INSTANCES) return 0
  const at = (share: number) => strengths[Math.min(strengths.length - 1, Math.floor(share * strengths.length))]
  const top = at(1 - TOP_SHARE)
  // At least MIN_SPAN below the top, measured DOWN from it: instances of one loudness are all full.
  const floor = Math.min(at(contrast), top - MIN_SPAN)
  return Math.max(0, Math.min(1, (strength - floor) / (top - floor)))
}
