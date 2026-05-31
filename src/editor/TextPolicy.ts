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

function stripBom(input: string): string {
  if (!input) {
    return input;
  }

  return input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
}
