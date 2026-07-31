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

  let prefixLen = 0;
  while (prefixLen < maxCommon && currentText[prefixLen] === nextText[prefixLen]) {
    prefixLen += 1;
  }

  let suffixLen = 0;
  const maxSuffix = maxCommon - prefixLen;
  while (
    suffixLen < maxSuffix
    && currentText[currentText.length - 1 - suffixLen] === nextText[nextText.length - 1 - suffixLen]
  ) {
    suffixLen += 1;
  }

  return {
    from: prefixLen,
    to: currentText.length - suffixLen,
    insert: nextText.slice(prefixLen, nextText.length - suffixLen),
  };
}
