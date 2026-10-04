/**
 * The music player's back-stack: what was played, in order, and where the
 * listener currently sits in it.
 *
 * ## Why a cursor and not just a log
 * "Go back" has to be repeatable -- press it three times, go three songs back.
 * A pure append-only log cannot do that: re-playing an older song would append
 * it again, so the next "back" would return to where you came from and the
 * button would oscillate between two tracks instead of walking backwards.
 * So the entries are the log and `cursor` marks which one is playing.
 *
 * ## Why going back then forward truncates
 * When a new song starts while the cursor sits in the past, everything after
 * the cursor is dropped before the new song is appended -- browser-history
 * semantics. The alternative (keep the tail, append after it) means that after
 * walking back four songs and letting the fifth play out, "back" returns to a
 * song from before the walk rather than the one just heard, which is exactly
 * the sequence a listener is most likely to want back. Truncating keeps the
 * invariant that back always returns to what you actually just listened to.
 *
 * Forward is deliberately NOT a movement through this list: right-clicking
 * forward always picks a fresh random song, as if the current one had ended.
 * That is why nothing here restores a truncated tail.
 */

/** How many songs back the listener can walk. */
export const MUSIC_PLAY_HISTORY_LIMIT = 100;

export interface MusicPlayHistory {
  /** Song ids, oldest first. Never longer than MUSIC_PLAY_HISTORY_LIMIT. */
  readonly entries: readonly number[];
  /** Index into `entries` of the song playing now; -1 when nothing has played. */
  readonly cursor: number;
}

export function emptyPlayHistory(): MusicPlayHistory {
  return { entries: [], cursor: -1 };
}

/** The song the cursor currently points at, or null before anything has played. */
export function currentHistorySongId(history: MusicPlayHistory): number | null {
  return history.cursor >= 0 && history.cursor < history.entries.length
    ? history.entries[history.cursor]
    : null;
}

/** Whether a step back is available -- i.e. whether the back button does anything. */
export function canStepBack(history: MusicPlayHistory): boolean {
  return history.cursor > 0;
}

/**
 * Record a song as now playing: drop anything after the cursor, append, and
 * park the cursor on it.
 *
 * Re-recording the song already at the cursor is a no-op, so a song that
 * repeats (favouriting sets priority 0, which can pick the same track again)
 * does not occupy two slots and make one "back" press do nothing visible.
 */
export function pushPlayed(history: MusicPlayHistory, songId: number): MusicPlayHistory {
  if (currentHistorySongId(history) === songId) return history;

  const kept = history.entries.slice(0, history.cursor + 1);
  kept.push(songId);
  // Oldest entries fall off the front once the tally is full.
  const entries = kept.slice(Math.max(0, kept.length - MUSIC_PLAY_HISTORY_LIMIT));
  return { entries, cursor: entries.length - 1 };
}

/**
 * Move the cursor one song into the past. Returns null at the oldest entry
 * (and when nothing has played), leaving the caller to do nothing rather than
 * guess at a song.
 */
export function stepBack(history: MusicPlayHistory): { history: MusicPlayHistory; songId: number } | null {
  if (!canStepBack(history)) return null;
  const cursor = history.cursor - 1;
  return { history: { entries: history.entries, cursor }, songId: history.entries[cursor] };
}

/**
 * Drop a song that no longer exists (its file went missing and it was purged)
 * from the tally, keeping the cursor on the same song where possible so a
 * purge mid-playback does not silently re-point "back" at something else.
 */
export function forgetSong(history: MusicPlayHistory, songId: number): MusicPlayHistory {
  if (!history.entries.includes(songId)) return history;
  const current = currentHistorySongId(history);
  const entries = history.entries.filter((id) => id !== songId);
  const cursor = current === songId || current === null
    // The song at the cursor is the one that went away: fall back to the entry
    // before it, so the next "back" continues from the right place.
    ? Math.min(history.cursor, entries.length) - 1
    : entries.indexOf(current);
  return { entries, cursor: Math.max(-1, Math.min(cursor, entries.length - 1)) };
}
