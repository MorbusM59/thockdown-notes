/**
 * Computes the smallest single-range replacement that turns `currentText`
 * into `nextText`, via common-prefix/common-suffix trim. Used by
 * CM6Editor.tsx's same-note hydration path (see its own doc comment) so a
 * transient mismatch between React's view of the text and CM6's live
 * document can be reconciled without a full 0..length replace -- a targeted
 * change lets CM6's own selection-through-changes mapping preserve an
 * existing caret position for any selection outside the changed span,
 * whereas a full replace has no positional correspondence to map through.
 */
export function computeMinimalTextReplacement(
  currentText: string,
  nextText: string,
): { from: number; to: number; insert: string } {
  const maxCommon = Math.min(currentText.length, nextText.length);

  // charCodeAt, not `text[i]`. Both scans walk everything the edit did NOT
  // touch, which for a keystroke in the middle of a large note is the entire
  // document -- and `text[i]` yields a one-character STRING per position,
  // where charCodeAt yields a number and allocates nothing. Measured on a
  // 1.5M-character note, from a CDP profile of ordinary typing: this function
  // cost 5.1ms per keystroke, second only to the preview's own parse, and it
  // is on the keystroke path through WordCount.ts's incremental tracker
  // (which needs the edit's position before it can widen a word window
  // around it).
  //
  // Comparing code units rather than characters is exact for this purpose:
  // two strings are equal iff their code-unit sequences are, so the prefix
  // and suffix lengths found here are identical to the previous
  // implementation's. A surrogate pair can only be split by the boundary if
  // its halves genuinely differ, which means the texts differ there anyway.
  let prefixLen = 0;
  while (prefixLen < maxCommon && currentText.charCodeAt(prefixLen) === nextText.charCodeAt(prefixLen)) {
    prefixLen += 1;
  }

  let suffixLen = 0;
  const maxSuffix = maxCommon - prefixLen;
  const currentEnd = currentText.length - 1;
  const nextEnd = nextText.length - 1;
  while (
    suffixLen < maxSuffix
    && currentText.charCodeAt(currentEnd - suffixLen) === nextText.charCodeAt(nextEnd - suffixLen)
  ) {
    suffixLen += 1;
  }

  return {
    from: prefixLen,
    to: currentText.length - suffixLen,
    insert: nextText.slice(prefixLen, nextText.length - suffixLen),
  };
}
