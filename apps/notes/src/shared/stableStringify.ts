/**
 * JSON with every object's keys in sorted order, so two values that are equal
 * field for field serialize to the same string whatever order their keys were
 * written in. Used where a serialization is a KEY or a SIGNATURE (a loadout's
 * identity, the browser mock's texture cache) rather than a payload.
 */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value)
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`
  }

  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, nested]) => `${JSON.stringify(key)}:${stableStringify(nested)}`)
  return `{${entries.join(',')}}`
}
