/**
 * What to do when an external note's FILE is read and found to hold
 * something, given what the app last knew the file held and what the note
 * holds now.
 *
 * Three texts, all normalized the way the note's own text is:
 * - `baseline`: the newest record of what the file held (the note's latest
 *   from-disk snapshot), or null when none was ever taken.
 * - `disk`: what the file holds now.
 * - `live`: the note's text now, typing not yet saved included.
 *
 * - `unchanged`: the file is what the app last saw. Nothing to do.
 * - `inSync`: the file changed, but to exactly the note's text (this app's
 *   own save, or another program writing the same). Record it as the new
 *   baseline; the note is clean.
 * - `adopt`: the file changed and the note has no edits of its own since the
 *   baseline, so the file's text becomes the note's. What the note held goes
 *   nowhere it can be lost: it IS the old baseline, already on the Timeline.
 * - `conflict`: the file changed and so did the note. The note keeps its
 *   text, the file's goes on the Timeline as the new baseline, and the note
 *   is unsaved against it -- a save writes the note over the file, and the
 *   file's version stays restorable.
 *
 * With no baseline at all nothing says whether the note was edited, so a
 * differing file is a conflict: keeping the reader's text is the choice that
 * can be undone.
 */
export type ExternalFileReconcile = 'unchanged' | 'inSync' | 'adopt' | 'conflict'

export function reconcileExternalFile(baseline: string | null, disk: string, live: string): ExternalFileReconcile {
  if (disk === baseline) return 'unchanged'
  if (disk === live) return 'inSync'
  if (live === baseline) return 'adopt'
  return 'conflict'
}
