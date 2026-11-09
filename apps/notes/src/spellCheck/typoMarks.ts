/*
 * Which letters of a misspelled word to mark, given the word it was most
 * likely meant to be.
 *
 * The two are aligned on their longest common subsequence: the letters of
 * the misspelling that are part of it are the matching runs, and only what
 * lies between those runs is marked.
 *   - A letter of the misspelling that is not in the alignment (a wrong or an
 *     extra letter) is marked itself.
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
  // lcs[i][j]: longest common subsequence of word[i..] and target[j..].
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      lcs[i][j] = word[i] === target[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  const marked = new Array<boolean>(n).fill(false);
  const gaps: number[] = [];
  const markGap = (i: number) => { gaps.push(i); };
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && word[i] === target[j]) {
      i += 1;
      j += 1;
    } else if (i < n && (j === m || lcs[i + 1][j] >= lcs[i][j + 1])) {
      marked[i] = true;
      i += 1;
    } else {
      markGap(i);
      j += 1;
    }
  }
  // A missing letter before word[i]: mark its neighbours, unless one of them
  // is already a wrong letter, in which case the gap and that letter are one
  // substitution and the wrong letter alone says where it is.
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
