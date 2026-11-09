/*
 * Which letters of a misspelled word to mark, given the word it was most
 * likely meant to be.
 *
 * The two are aligned by the fewest edits (a letter wrong, extra or missing,
 * or two neighbours swapped): the letters that match form runs, and only
 * what lies between those runs is marked.
 *   - A wrong or an extra letter is marked itself; two swapped letters are
 *     marked as the pair.
 *   - A letter of the intended word that is missing has no cell of its own,
 *     so the letters on either side of the gap are marked (one, at either end
 *     of the word), unless a wrong letter sits beside the gap: that is one
 *     letter replaced by another, and the wrong letter alone is marked.
 * Marked letters next to each other become one range.
 *
 * `isNearMiss` is the rule for trusting a suggestion at all: Hunspell ranks
 * its suggestions but its first is often a different word altogether
 * ("helo" gives "hole" first), and marking letters against a wrong word
 * would point at the wrong place. A suggestion one edit away (a letter
 * wrong, extra or missing, or two neighbours swapped) locates the typo
 * whichever word was meant.
 */

export type MarkRange = { from: number; to: number };

/** Ranges of `word` (offsets in it) that differ from `target`. Empty when they are equal. */
export function typoMarks(word: string, target: string): MarkRange[] {
  const n = word.length;
  const m = target.length;
  // cost[i][j]: fewest edits turning word[i..] into target[j..], where an
  // edit is a letter wrong, extra or missing, or two neighbours swapped.
  const cost: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n; i >= 0; i -= 1) {
    for (let j = m; j >= 0; j -= 1) {
      if (i === n || j === m) { cost[i][j] = (n - i) + (m - j); continue; }
      let best = Math.min(cost[i + 1][j] + 1, cost[i][j + 1] + 1, cost[i + 1][j + 1] + (word[i] === target[j] ? 0 : 1));
      if (isSwapAt(word, target, i, j)) best = Math.min(best, cost[i + 2][j + 2] + 1);
      cost[i][j] = best;
    }
  }
  const marked = new Array<boolean>(n).fill(false);
  const gaps: number[] = [];
  let i = 0;
  let j = 0;
  // Walk one cheapest alignment, preferring a match, then a swap, then a
  // wrong letter, an extra one and a missing one.
  while (i < n || j < m) {
    const here = cost[i][j];
    if (i < n && j < m && word[i] === target[j] && cost[i + 1][j + 1] === here) {
      i += 1; j += 1;
    } else if (isSwapAt(word, target, i, j) && cost[i + 2][j + 2] + 1 === here) {
      marked[i] = true; marked[i + 1] = true; i += 2; j += 2;
    } else if (i < n && j < m && cost[i + 1][j + 1] + 1 === here) {
      marked[i] = true; i += 1; j += 1;
    } else if (i < n && cost[i + 1][j] + 1 === here) {
      marked[i] = true; i += 1;
    } else {
      gaps.push(i); j += 1;
    }
  }
  // A missing letter before word[i] has no cell of its own: mark its
  // neighbours, unless one of them is already marked, which then says where
  // the edit is.
  const wrong = [...marked];
  for (const gap of gaps) {
    if ((gap > 0 && wrong[gap - 1]) || (gap < n && wrong[gap])) continue;
    if (gap > 0) marked[gap - 1] = true;
    if (gap < n) marked[gap] = true;
  }
  const ranges: MarkRange[] = [];
  for (let index = 0; index < n; index += 1) {
    if (!marked[index]) continue;
    const last = ranges[ranges.length - 1];
    if (last && last.to === index) last.to = index + 1;
    else ranges.push({ from: index, to: index + 1 });
  }
  return ranges;
}

function isSwapAt(word: string, target: string, i: number, j: number): boolean {
  return i + 1 < word.length && j + 1 < target.length && word[i] !== word[i + 1]
    && word[i] === target[j + 1] && word[i + 1] === target[j];
}

/** True when `target` is one edit from `word`: one letter wrong, extra or missing, or two neighbours swapped. */
export function isNearMiss(word: string, target: string): boolean {
  if (word === target) return false;
  const lengthDifference = word.length - target.length;
  if (Math.abs(lengthDifference) > 1) return false;
  let start = 0;
  while (start < word.length && start < target.length && word[start] === target[start]) start += 1;
  let wordEnd = word.length;
  let targetEnd = target.length;
  while (wordEnd > start && targetEnd > start && word[wordEnd - 1] === target[targetEnd - 1]) {
    wordEnd -= 1;
    targetEnd -= 1;
  }
  const wordMiddle = word.slice(start, wordEnd);
  const targetMiddle = target.slice(start, targetEnd);
  if (wordMiddle.length <= 1 && targetMiddle.length <= 1) return true;
  return wordMiddle.length === 2 && targetMiddle.length === 2 && wordMiddle[0] === targetMiddle[1] && wordMiddle[1] === targetMiddle[0];
}
