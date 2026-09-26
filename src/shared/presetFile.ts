/**
 * The text format presets are exported in: a layout (.tdl) or a soundscape
 * (.tds) file is a list of lines, each one preset written as its
 * differences from a named neutral base,
 *
 *   <id>: { ...<BASE>, <key>: <value>, <key>: <value> },
 *
 * where a value is a number, true/false, a single-quoted string, or a nested
 * object as inline JSON (itself only the parts that differ from the base's).
 * Lines starting with // are comments. The format is shared so that both
 * kinds of preset are read and written by one parser: a fix to one is a fix
 * to both.
 */

/** A scalar as it appears in a line: a string single-quoted, anything else as it prints. */
export function formatPresetScalar(value: unknown): string {
  if (typeof value === 'string') return `'${value}'`;
  return String(value);
}

/** JSON with object keys sorted, so equal values always serialise the same. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, nested]) => `${JSON.stringify(key)}:${stableStringify(nested)}`);
  return `{${entries.join(',')}}`;
}

/**
 * The parts of `value` that differ from `baseValue`, recursively for
 * objects (keys sorted); undefined when nothing differs. Arrays and scalars
 * are compared whole.
 */
export function buildObjectDiff(value: unknown, baseValue: unknown): unknown | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return stableStringify(value) !== stableStringify(baseValue) ? value : undefined;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right));
  const result: Record<string, unknown> = {};
  const baseObject = typeof baseValue === 'object' && baseValue !== null && !Array.isArray(baseValue)
    ? (baseValue as Record<string, unknown>)
    : {};
  for (const [key, nestedValue] of entries) {
    const diff = buildObjectDiff(nestedValue, baseObject[key]);
    if (diff !== undefined) result[key] = diff;
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

/** One line of a preset file, from its id, its base's name and its override fragments. */
export function formatPresetLine(id: number, baseToken: string, parts: readonly string[]): string {
  const diff = parts.length > 0 ? `, ${parts.join(', ')}` : '';
  return `  ${id}: { ...${baseToken}${diff} },`;
}

/** Parse the unquoted-key override fragment of one line. */
export function parsePresetOverrides(overrideStr: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  let pos = 0;
  const str = overrideStr.trim();

  while (pos < str.length) {
    // skip commas and whitespace between fields
    while (pos < str.length && /[,\s]/.test(str[pos])) pos++;
    if (pos >= str.length) break;

    // unquoted identifier key
    const keyMatch = /^([a-zA-Z_]\w*)/.exec(str.slice(pos));
    if (!keyMatch) break;
    const key = keyMatch[1];
    pos += key.length;

    // skip colon and surrounding whitespace
    while (pos < str.length && (str[pos] === ':' || str[pos] === ' ')) pos++;
    if (pos >= str.length) break;

    const rest = str.slice(pos);

    if (rest[0] === '{') {
      // inline JSON object: balance braces
      let depth = 0;
      let endIdx = -1;
      for (let i = 0; i < rest.length; i++) {
        if (rest[i] === '{') depth++;
        else if (rest[i] === '}') {
          depth--;
          if (depth === 0) { endIdx = i; break; }
        }
      }
      if (endIdx < 0) break;
      try {
        result[key] = JSON.parse(rest.slice(0, endIdx + 1));
      } catch {
        // malformed: skip this field
      }
      pos += endIdx + 1;
    } else if (rest[0] === "'") {
      let end = 1;
      while (end < rest.length && rest[end] !== "'") end++;
      result[key] = rest.slice(1, end);
      pos += end + 1;
    } else if (rest[0] === '"') {
      let end = 1;
      while (end < rest.length && rest[end] !== '"') end++;
      result[key] = rest.slice(1, end);
      pos += end + 1;
    } else if (rest.startsWith('true')) {
      result[key] = true; pos += 4;
    } else if (rest.startsWith('false')) {
      result[key] = false; pos += 5;
    } else {
      const numMatch = /^-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?/.exec(rest);
      if (numMatch) {
        result[key] = parseFloat(numMatch[0]);
        pos += numMatch[0].length;
      } else {
        break; // can't parse: bail
      }
    }
  }

  return result;
}

/** Every `<id>: { ...<baseToken>, ... },` line of a file, as (id, overrides) pairs. Id 0 is not a preset. */
export function parsePresetLines(content: string, baseToken: string): Array<{ id: number; overrides: Record<string, unknown> }> {
  const result: Array<{ id: number; overrides: Record<string, unknown> }> = [];
  const pattern = new RegExp(`^(-?\\d+):\\s*\\{\\s*\\.\\.\\.\\s*${baseToken}\\s*(?:,\\s*([\\s\\S]*?))?\\s*\\},?\\s*$`);
  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('//')) continue;
    const match = pattern.exec(line);
    if (!match) continue;
    const id = parseInt(match[1], 10);
    if (!Number.isFinite(id) || id === 0) continue;
    result.push({ id, overrides: match[2] ? parsePresetOverrides(match[2]) : {} });
  }
  return result;
}
