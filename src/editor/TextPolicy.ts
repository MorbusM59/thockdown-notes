export function normalizeInternalText(input: string): string {
  return stripBom(input)
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/[\u2028\u2029]/g, '\n')
    .replace(/\t/g, '   ');
}

export function canonicalizeParagraphSegments(segments: string[]): string {
  if (segments.length === 0) {
    return '';
  }

  return segments
    .map((segment) => normalizeInternalText(segment))
    .join('\n');
}

export interface CanonicalizeParagraphSegmentsCache {
  segments: string[];
  normalized: string[];
  text: string;
}

/**
 * Incremental counterpart to canonicalizeParagraphSegments: reuses the
 * previous call's normalized text for every segment whose raw text didn't
 * change, instead of re-running normalizeInternalText's regex passes over
 * every paragraph on every call regardless of which one was actually
 * edited. Unlike PreviewBlockSplit's or MarkdownContext's incremental
 * schemes, there's no cross-segment coupling to reason about here --
 * normalizeInternalText is a pure per-segment transform with no dependency
 * on neighboring segments, so a segment's normalized text depends only on
 * its own raw text, never on what changed elsewhere. That makes plain
 * prefix/suffix common-segment reuse (same technique as
 * PreviewBlockSplit's line diffing) sufficient and exact -- no stabilization
 * probe needed, no forward-unbounded hazard class to guard against.
 *
 * `segments.join('\n')`-equivalent final assembly (via `normalized.join`)
 * still touches the whole array every call -- that part is irreducible (the
 * canonical text model requires a single joined string), per this
 * codebase's own established read on `canonicalizeParagraphSegments`'s
 * "close to irreducible" cost. What this function actually removes is the
 * redundant re-normalization work upstream of that join.
 */
export function canonicalizeParagraphSegmentsIncremental(
  segments: string[],
  previous: CanonicalizeParagraphSegmentsCache | null,
): CanonicalizeParagraphSegmentsCache {
  if (segments.length === 0) {
    return { segments, normalized: [], text: '' };
  }

  if (previous === null) {
    const normalized = segments.map((segment) => normalizeInternalText(segment));
    return { segments, normalized, text: normalized.join('\n') };
  }

  const oldSegments = previous.segments;
  const maxCommon = Math.min(oldSegments.length, segments.length);

  let prefixLen = 0;
  while (prefixLen < maxCommon && oldSegments[prefixLen] === segments[prefixLen]) {
    prefixLen += 1;
  }

  let suffixLen = 0;
  const maxSuffix = maxCommon - prefixLen;
  while (
    suffixLen < maxSuffix &&
    oldSegments[oldSegments.length - 1 - suffixLen] === segments[segments.length - 1 - suffixLen]
  ) {
    suffixLen += 1;
  }

  const normalized: string[] = new Array(segments.length);
  for (let i = 0; i < prefixLen; i += 1) {
    normalized[i] = previous.normalized[i];
  }

  const suffixStart = segments.length - suffixLen;
  for (let i = prefixLen; i < suffixStart; i += 1) {
    normalized[i] = normalizeInternalText(segments[i]);
  }

  const oldSuffixStart = oldSegments.length - suffixLen;
  for (let i = 0; i < suffixLen; i += 1) {
    normalized[suffixStart + i] = previous.normalized[oldSuffixStart + i];
  }

  return { segments, normalized, text: normalized.join('\n') };
}

function stripBom(input: string): string {
  if (!input) {
    return input;
  }

  return input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
}
