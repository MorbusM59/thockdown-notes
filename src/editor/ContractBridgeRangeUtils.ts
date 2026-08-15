import type { EditorSelectionState } from '../editor/EditorContract';

const SENTENCE_ENDING_PUNCTUATION = new Set(['.', '!', '?', ':']);

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

const isWhitespace = (char: string) => /\s/u.test(char);

const isSentenceBoundary = (char: string) => char === '\n' || SENTENCE_ENDING_PUNCTUATION.has(char);

const isWordBoundary = (char: string) => char === ',' || isSentenceBoundary(char);

const trimWhitespaceRange = (text: string, start: number, end: number) => {
  let nextStart = start;
  let nextEnd = end;

  while (nextStart < nextEnd && isWhitespace(text[nextStart])) {
    nextStart += 1;
  }
  while (nextEnd > nextStart && isWhitespace(text[nextEnd - 1])) {
    nextEnd -= 1;
  }

  return { start: nextStart, end: nextEnd };
};

const trimMatchingAsteriskPairs = (text: string, start: number, end: number) => {
  let nextStart = start;
  let nextEnd = end;

  while (
    nextEnd - nextStart >= 3 &&
    text[nextStart] === '*' &&
    text[nextEnd - 1] === '*'
  ) {
    nextStart += 1;
    nextEnd -= 1;
  }

  return { start: nextStart, end: nextEnd };
};

const isPairOpener = (char: string) => PAIR_OPENERS[char] !== undefined;
const isPairCloser = (char: string) => REVERSE_PAIR_OPENERS[char] !== undefined;

const isAdjacentPairBoundary = (text: string, index: number) => {
  return index > 0 && index < text.length
    && isPairCloser(text[index - 1])
    && isPairOpener(text[index]);
};

const PAIR_OPENERS: Record<string, string> = {
  '[': ']',
  '(': ')',
  '{': '}',
  '<': '>',
  '"': '"',
};

const findMatchingCloser = (
  text: string,
  openerIndex: number,
  closer: string,
): number | null => {
  let balance = 0;
  for (let index = openerIndex + 1; index < text.length; index += 1) {
    const current = text[index];
    if (current === text[openerIndex] && current !== closer) {
      balance += 1;
      continue;
    }
    if (current === closer) {
      if (balance === 0) {
        return index;
      }
      balance -= 1;
    }
  }
  return null;
};

const REVERSE_PAIR_OPENERS: Record<string, string> = Object.entries(PAIR_OPENERS).reduce(
  (accumulator, [pairOpener, pairCloser]) => {
    accumulator[pairCloser] = pairOpener;
    return accumulator;
  },
  {} as Record<string, string>,
);

const findMatchingOpener = (
  text: string,
  closerIndex: number,
  opener: string,
): number | null => {
  const closer = text[closerIndex];
  let balance = 0;
  for (let index = closerIndex - 1; index >= 0; index -= 1) {
    const current = text[index];
    if (current === closer && current !== opener) {
      balance += 1;
      continue;
    }
    if (current === opener) {
      if (balance === 0) {
        return index;
      }
      balance -= 1;
    }
  }
  return null;
};

// Strips leading/trailing bounding characters that don't pair up within
// [start, end) — e.g. a word range that grabbed adjacent "(" and "\"" whose
// matching ")" / "\"" both live outside the current range. Matching is
// checked across the full text: a character with no partner anywhere is left
// alone (it's not a stray pair edge, just an unbalanced character), only one
// that closes/opens *outside* the range gets trimmed. This gives us the
// intersection of the regular expansion and the pair-aware expansion instead
// of blindly keeping the dangling character.
//
// Loops until a full pass makes no change rather than stopping after one
// trim per side: adjacent stray delimiters (e.g. "(\"one two\" three)" where
// clicking "one" overshoots past both "(" and "\"" on the left) need more
// than one peel to fully clean, and stopping early left a leftover
// delimiter character in the "word" range that then never got a chance to
// go away -- resolveScopeRange's own second trim pass papered over it for a
// single click, but reported that as a fresh isPairAwareAdjustment, which
// pinned the right-click cycle at 'word' scope forever (found live: right-
// clicking "one" in `test ("one two" three).` never escalated past
// selecting "one", while "two" -- only one stray delimiter away from its
// scan window -- escalated normally).
const trimStrayBoundingCharacters = (
  text: string,
  start: number,
  end: number,
) => {
  let nextStart = start;
  let nextEnd = end;

  for (;;) {
    let changed = false;

    if (nextEnd - nextStart > 0) {
      const firstChar = text[nextStart];
      const expectedCloser = PAIR_OPENERS[firstChar];
      if (expectedCloser) {
        const matchIndex = findMatchingCloser(text, nextStart, expectedCloser);
        if (matchIndex !== null && matchIndex >= nextEnd) {
          if (matchIndex !== nextEnd || text[nextEnd] !== expectedCloser) {
            nextStart += 1;
            changed = true;
          }
        }
      }
    }

    if (nextEnd - nextStart > 0) {
      const lastChar = text[nextEnd - 1];
      const expectedOpener = REVERSE_PAIR_OPENERS[lastChar];
      if (expectedOpener) {
        const matchIndex = findMatchingOpener(text, nextEnd - 1, expectedOpener);
        if (matchIndex !== null && matchIndex < nextStart) {
          if (matchIndex !== nextStart - 1 || text[nextStart - 1] !== expectedOpener) {
            nextEnd -= 1;
            changed = true;
          }
        }
      }
    }

    if (!changed) {
      break;
    }
  }

  return { start: nextStart, end: nextEnd };
};

export const resolvePairAwareRange = (
  text: string,
  regularRange: { start: number; end: number },
  currentSelection?: EditorSelectionState,
) => {
  const { start: rangeStart, end: rangeEnd } = regularRange;
  if (rangeStart + 1 >= rangeEnd) {
    return null;
  }

  const opener = text[rangeStart];
  const closer = text[rangeEnd - 1];
  const expectedCloser = PAIR_OPENERS[opener];
  if (expectedCloser && expectedCloser === closer) {
    const secondary = { start: rangeStart + 1, end: rangeEnd - 1 };

    if (
      currentSelection &&
      !currentSelection.isCollapsed &&
      currentSelection.start === secondary.start &&
      currentSelection.end === secondary.end
    ) {
      return regularRange;
    }

    return secondary;
  }

  // Neither end is a fully-balanced pair. Before falling back to the raw range,
  // check whether one end is a lone bounding character whose partner exists but
  // lies outside this range — if so, exclude it rather than dragging it along.
  const strayTrimmed = trimStrayBoundingCharacters(text, rangeStart, rangeEnd);
  if (strayTrimmed.start !== rangeStart || strayTrimmed.end !== rangeEnd) {
    return strayTrimmed;
  }

  if (!currentSelection || currentSelection.isCollapsed) {
    return null;
  }

  const searchStart = Math.min(currentSelection.start - 1, rangeEnd - 2);

  // If the regular range is bounded immediately by a matching pair, and the
  // current selection already covers the full inner content, allow the next
  // expansion to wrap out to the enclosing pair.
  if (rangeStart > 0 && rangeEnd < text.length) {
    const enclosingOpener = text[rangeStart - 1];
    const enclosingCloser = text[rangeEnd];
    const expectedCloser = PAIR_OPENERS[enclosingOpener];
    if (expectedCloser && expectedCloser === enclosingCloser) {
      const inner = { start: rangeStart, end: rangeEnd };
      if (
        currentSelection.start === inner.start &&
        currentSelection.end === inner.end
      ) {
        return { start: rangeStart - 1, end: rangeEnd + 1 };
      }
    }
  }
  for (let openerIndex = searchStart; openerIndex >= rangeStart; openerIndex -= 1) {
    const openerChar = text[openerIndex];
    const closerChar = PAIR_OPENERS[openerChar];
    if (!closerChar) {
      continue;
    }

    const closerIndex = findMatchingCloser(text, openerIndex, closerChar);
    if (closerIndex === null) {
      continue;
    }
    if (closerIndex < currentSelection.end || closerIndex > rangeEnd) {
      continue;
    }

    const inner = { start: openerIndex + 1, end: closerIndex };
    if (inner.start >= rangeStart && inner.end <= rangeEnd) {
      if (
        currentSelection.start === inner.start &&
        currentSelection.end === inner.end
      ) {
        const outer = { start: openerIndex, end: closerIndex + 1 };
        return outer;
      }
      return inner;
    }
  }

  return null;
};

const normalizeAnchor = (
  text: string,
  offset: number,
  predicate: (char: string) => boolean,
) => {
  const safeLength = text.length;
  if (safeLength === 0) {
    return 0;
  }

  const initial = clamp(offset, 0, safeLength - 1);
  if (!predicate(text[initial])) {
    return initial;
  }

  let right = initial;
  while (right < safeLength && predicate(text[right])) {
    right += 1;
  }
  if (right < safeLength) {
    return right;
  }

  let left = initial - 1;
  while (left >= 0 && predicate(text[left])) {
    left -= 1;
  }
  if (left >= 0) {
    return left;
  }

  return clamp(offset, 0, safeLength);
};


export const resolveWordRange = (
  text: string,
  offset: number,
  currentSelection?: EditorSelectionState,
) => {
  const safeLength = text.length;
  if (safeLength === 0) {
    return { start: 0, end: 0 };
  }

  const boundary = (char: string) => isWhitespace(char) || isWordBoundary(char);
  const anchor = normalizeAnchor(text, offset, boundary);
  if (anchor >= safeLength) {
    return { start: safeLength, end: safeLength };
  }

  let start = anchor;
  while (start > 0 && !boundary(text[start - 1]) && !isAdjacentPairBoundary(text, start)) {
    start -= 1;
  }

  let end = anchor + 1;
  while (end < safeLength && !boundary(text[end])) {
    if (end + 1 < safeLength && isAdjacentPairBoundary(text, end + 1)) {
      end += 1;
      break;
    }
    end += 1;
  }

  const whitespaceTrimmed = trimWhitespaceRange(text, start, end);
  const regularRange = trimMatchingAsteriskPairs(
    text,
    whitespaceTrimmed.start,
    whitespaceTrimmed.end,
  );

  const pairAware = resolvePairAwareRange(text, regularRange, currentSelection);
  if (pairAware !== null) {
    return pairAware;
  }

  return regularRange;
};

export type SelectionScope = 'word' | 'clause' | 'sentence' | 'line' | 'block';

const resolveSentenceRange = (
  text: string,
  offset: number,
  currentSelection?: EditorSelectionState,
) => {
  const safeLength = text.length;
  if (safeLength === 0) {
    return { start: 0, end: 0 };
  }

  const anchor = normalizeAnchor(text, offset, isWhitespace);
  const safeAnchor = clamp(anchor, 0, Math.max(0, safeLength - 1));

  let guardOpener = -1;
  let guardCloser = safeLength;
  for (let index = safeAnchor - 1; index >= 0; index -= 1) {
    const char = text[index];
    if (!isPairOpener(char)) {
      continue;
    }

    const closerIndex = findMatchingCloser(text, index, PAIR_OPENERS[char]);
    if (closerIndex !== null && closerIndex > safeAnchor) {
      guardOpener = index;
      guardCloser = closerIndex;
      break;
    }
  }

  if (
    guardOpener >= 0 &&
    currentSelection &&
    !currentSelection.isCollapsed &&
    currentSelection.start === guardOpener + 1 &&
    currentSelection.end === guardCloser
  ) {
    return { start: guardOpener, end: guardCloser + 1 };
  }

  let startBoundary = -1;
  let rightGuard = safeLength;
  for (let index = safeAnchor - 1; index >= 0; index -= 1) {
    const char = text[index];
    if (isSentenceBoundary(char)) {
      startBoundary = index;
      break;
    }

    if (index === guardOpener) {
      startBoundary = index;
      rightGuard = guardCloser;
      break;
    }
  }

  let endBoundary = -1;
  let endBoundaryIsGuard = false;
  for (let index = safeAnchor; index < safeLength; index += 1) {
    if (index >= rightGuard) {
      endBoundary = rightGuard;
      endBoundaryIsGuard = true;
      break;
    }

    const char = text[index];
    if (isSentenceBoundary(char)) {
      endBoundary = index;
      endBoundaryIsGuard = false;
      break;
    }

    if (isPairCloser(char)) {
      const openerIndex = findMatchingOpener(text, index, REVERSE_PAIR_OPENERS[char]);
      if (openerIndex !== null && openerIndex < safeAnchor) {
        endBoundary = index;
        endBoundaryIsGuard = false;
        if (openerIndex > startBoundary) {
          startBoundary = openerIndex;
        }
        break;
      }
    }
  }

  const start = startBoundary + 1;
  const end = endBoundary >= 0
    ? (endBoundaryIsGuard ? endBoundary : endBoundary + 1)
    : rightGuard;
  return trimWhitespaceRange(text, start, end);
};

const containsSentenceEndingCharacter = (
  text: string,
  start: number,
  end: number,
) => {
  for (let index = start; index < end; index += 1) {
    if (isSentenceBoundary(text[index])) {
      return true;
    }
  }
  return false;
};

// The natural sentence boundary around an anchor, ignoring bracket pairs
// entirely. Used as a ceiling for "line" scope: until a selection actually
// contains a sentence-ending character, we're not done growing within a
// sentence yet, so "line" scope shouldn't be allowed to reach past it.
const resolvePureSentenceRange = (text: string, offset: number) => {
  const safeLength = text.length;
  if (safeLength === 0) {
    return { start: 0, end: 0 };
  }

  const anchor = clamp(normalizeAnchor(text, offset, isWhitespace), 0, Math.max(0, safeLength - 1));

  let startBoundary = -1;
  for (let index = anchor - 1; index >= 0; index -= 1) {
    if (isSentenceBoundary(text[index])) {
      startBoundary = index;
      break;
    }
  }

  let endBoundary = -1;
  for (let index = anchor; index < safeLength; index += 1) {
    if (isSentenceBoundary(text[index])) {
      endBoundary = index;
      break;
    }
  }

  const start = startBoundary + 1;
  const end = endBoundary >= 0 ? endBoundary + 1 : safeLength;
  return trimWhitespaceRange(text, start, end);
};

const findEnclosingPairInterior = (text: string, anchor: number) => {
  for (let index = anchor - 1; index >= 0; index -= 1) {
    const char = text[index];
    if (!isPairOpener(char)) {
      continue;
    }

    const closerIndex = findMatchingCloser(text, index, PAIR_OPENERS[char]);
    if (closerIndex !== null && closerIndex > anchor) {
      return { start: index + 1, end: closerIndex };
    }
  }
  return null;
};

// 'clause' scope: the comma-delimited segment around the click, without
// crossing an enclosing bracket pair or the current sentence's own
// boundaries. Deliberately entered only immediately after 'word' scope (see
// resolveNextRightClickScope in CM6Editor.tsx) and computed fresh from the
// click offset every time rather than incrementally from currentSelection --
// a single stateless hop, not a scope that re-derives itself relative to a
// growing selection the way 'sentence'/'line' do. Layering comma-awareness
// onto resolveSentenceRange's own multi-click bracket-walk machinery
// (guardOpener/rightGuard/pairSearchWindow, all tuned against many specific
// regressions -- see trimStrayBoundingCharacters above) was evaluated and
// rejected as too risky to attempt blindly; this narrower version is the
// safely-achievable subset.
const resolveClauseRange = (text: string, offset: number) => {
  const safeLength = text.length;
  if (safeLength === 0) {
    return { start: 0, end: 0 };
  }

  const anchor = clamp(normalizeAnchor(text, offset, isWhitespace), 0, Math.max(0, safeLength - 1));
  const window = findEnclosingPairInterior(text, anchor) ?? resolvePureSentenceRange(text, offset);

  const leftComma = text.lastIndexOf(',', anchor - 1);
  const start = leftComma >= window.start ? leftComma + 1 : window.start;

  const rightComma = text.indexOf(',', anchor);
  const end = rightComma !== -1 && rightComma < window.end ? rightComma : window.end;

  return trimWhitespaceRange(text, start, end);
};

const resolveLineRange = (text: string, offset: number) => {
  const safeLength = text.length;
  if (safeLength === 0) {
    return { start: 0, end: 0 };
  }

  const safeOffset = clamp(offset, 0, safeLength);
  const start = text.lastIndexOf('\n', Math.max(0, safeOffset - 1)) + 1;
  const endBoundary = text.indexOf('\n', safeOffset);
  const end = endBoundary >= 0 ? endBoundary : safeLength;
  return { start, end };
};

const resolveLineIndexForOffset = (lineStarts: number[], offset: number, textLength: number) => {
  const safeOffset = clamp(offset, 0, textLength);
  let lineIndex = 0;
  for (let index = 0; index < lineStarts.length; index += 1) {
    if (lineStarts[index] <= safeOffset) {
      lineIndex = index;
    } else {
      break;
    }
  }
  return lineIndex;
};

const resolveBlockRange = (text: string, offset: number) => {
  const lines = text.split('\n');
  if (lines.length === 0) {
    return { start: 0, end: 0 };
  }

  const lineStarts: number[] = [];
  let cursor = 0;
  for (let index = 0; index < lines.length; index += 1) {
    lineStarts.push(cursor);
    cursor += lines[index].length;
    if (index < lines.length - 1) {
      cursor += 1;
    }
  }

  const currentLineIndex = resolveLineIndexForOffset(lineStarts, offset, text.length);

  let startLine = currentLineIndex;
  while (startLine > 0 && lines[startLine - 1].trim().length > 0) {
    startLine -= 1;
  }

  let endLine = currentLineIndex;
  while (endLine < lines.length - 1 && lines[endLine + 1].trim().length > 0) {
    endLine += 1;
  }

  const start = lineStarts[startLine];
  const end = lineStarts[endLine] + lines[endLine].length;
  return { start, end };
};

export const isSameRange = (
  left: { start: number; end: number },
  right: { start: number; end: number },
) => left.start === right.start && left.end === right.end;

const isPairAwareRewrap = (
  text: string,
  regularRange: { start: number; end: number },
  currentSelection: EditorSelectionState | null,
) => {
  if (!currentSelection || currentSelection.isCollapsed) {
    return false;
  }

  const opener = text[regularRange.start];
  const closer = text[regularRange.end - 1];
  const expectedCloser = PAIR_OPENERS[opener];
  if (!expectedCloser || expectedCloser !== closer) {
    return false;
  }

  const secondary = { start: regularRange.start + 1, end: regularRange.end - 1 };
  return currentSelection.start === secondary.start && currentSelection.end === secondary.end;
};

// True when `range` sits immediately inside an enclosing pair (the
// characters right outside its edges are a matching opener/closer).
const isBoundedByEnclosingPair = (
  text: string,
  range: { start: number; end: number },
) => {
  if (range.start <= 0 || range.end >= text.length) {
    return false;
  }
  const opener = text[range.start - 1];
  const closer = text[range.end];
  const expectedCloser = PAIR_OPENERS[opener];
  return Boolean(expectedCloser) && expectedCloser === closer;
};

export const resolveScopeRange = (
  scope: SelectionScope,
  text: string,
  offset: number,
  currentSelection: EditorSelectionState | null,
) => {
  let regularRange;
  // The window resolvePairAwareRange gets to search in for a nested bracket
  // pair -- normally the same as regularRange, except for 'sentence' (see
  // below), where it needs to be wider than regularRange itself.
  let pairSearchWindow;
  if (scope === 'word') {
    regularRange = resolveWordRange(text, offset, currentSelection ?? undefined);
    pairSearchWindow = regularRange;
  } else if (scope === 'clause') {
    regularRange = resolveClauseRange(text, offset);
    pairSearchWindow = regularRange;
  } else if (scope === 'sentence') {
    regularRange = resolveSentenceRange(text, offset, currentSelection ?? undefined);

    // resolveSentenceRange's own guard only ever tracks the single nearest
    // enclosing bracket pair relative to `offset` -- it has no notion of "the
    // next pair out," so once currentSelection already spans the guard's own
    // outer wrap (walked out via a previous click), regularRange collapses
    // right back to the same inner range with nothing new to offer. Widening
    // the *pair-awareness search window* to the natural, bracket-ignorant
    // sentence boundary -- the same ceiling 'line' scope computes below --
    // gives resolvePairAwareRange's own nested-bracket search loop (already
    // depth-agnostic; it's what powers 'word' and 'line' scope's walk-out)
    // room to find the next pair out, so repeated clicks keep progressing
    // through arbitrarily nested brackets instead of getting stuck after the
    // first layer. regularRange itself stays exactly as before -- this only
    // widens what pairAware is allowed to search, not the baseline answer
    // used when there's no useful selection to react to (e.g. a bare click).
    pairSearchWindow = resolvePureSentenceRange(text, offset);
  } else if (scope === 'line') {
    regularRange = resolveLineRange(text, offset);

    // "Line" is only a meaningful step up from "sentence" once we've actually
    // captured a full sentence (i.e. the selection contains a sentence-ending
    // character). Until then — e.g. while still walking out through nested
    // bracket pairs — cap the line-scope search sandbox at the natural
    // sentence boundary so it can't blow past it into an unrelated sentence.
    const hasSentenceEnding = currentSelection !== null
      && containsSentenceEndingCharacter(text, currentSelection.start, currentSelection.end);

    if (!hasSentenceEnding) {
      const sentenceCeiling = resolvePureSentenceRange(text, offset);
      regularRange = {
        start: Math.max(regularRange.start, sentenceCeiling.start),
        end: Math.min(regularRange.end, sentenceCeiling.end),
      };
    }
    pairSearchWindow = regularRange;
  } else {
    regularRange = resolveBlockRange(text, offset);
    pairSearchWindow = regularRange;
  }

  // 'clause' deliberately opts out of the generic pair-aware pass below --
  // resolveClauseRange already stops at an enclosing pair's own interior, and
  // this scope is meant to be a narrow, deterministic single hop (see its
  // definition above), not subject to the same nested-bracket walk-out
  // machinery that 'word'/'sentence' rely on across multiple clicks.
  const pairAware = scope === 'clause'
    ? null
    : resolvePairAwareRange(text, pairSearchWindow, currentSelection ?? undefined);
  let range = pairAware ?? regularRange;

  // resolveSentenceRange's own guard only ever "sees" the single nearest
  // bracket relative to `offset`, so once currentSelection has already
  // walked further out than that (a wider pair discovered earlier via
  // pairSearchWindow's own multi-level search), regularRange regresses back
  // to that single narrow guard's answer instead of reflecting where the
  // selection actually is. If pairSearchWindow's search also comes up empty
  // (no *further* pair to walk out to), falling back to regularRange would
  // visibly shrink the selection -- keep currentSelection unchanged instead,
  // matching "nothing left for this scope to add" (isPairAwareAdjustment
  // false below lets the caller advance to the next scope, e.g. 'line').
  if (
    scope === 'sentence' &&
    pairAware === null &&
    currentSelection !== null &&
    !currentSelection.isCollapsed &&
    (currentSelection.start < regularRange.start || currentSelection.end > regularRange.end)
  ) {
    range = { start: currentSelection.start, end: currentSelection.end };
  }

  // For 'sentence' scope specifically, resolvePairAwareRange's own diff
  // against regularRange can coincidentally agree with it (both independently
  // landed on the same bracket-clamped answer via their own, different
  // guard/search logic), which would hide a genuine bracket-driven adjustment.
  // Detect that case directly: currentSelection sitting strictly inside a
  // regularRange that's itself immediately bounded by an enclosing pair means
  // this is a *fresh* landing on that clamp (not a currentSelection that
  // already walked out past it, which is what "not a subset" catches --
  // guarding against retrying the same single-level guard forever once it's
  // already been fully walked once).
  const isFreshSentenceGuardClamp = scope === 'sentence'
    && currentSelection !== null
    && !currentSelection.isCollapsed
    && currentSelection.start >= regularRange.start
    && currentSelection.end <= regularRange.end
    && !isSameRange(currentSelection, regularRange)
    && isBoundedByEnclosingPair(text, regularRange);

  const isPairAwareAdjustment = (pairAware !== null && (
    !isSameRange(pairAware, regularRange) || isPairAwareRewrap(text, regularRange, currentSelection)
  )) || isFreshSentenceGuardClamp;
  return { range, isPairAwareAdjustment };
};
