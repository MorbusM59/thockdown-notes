/** Tags with special lifecycle meaning (archive/trash/external-file status) — never freely editable. */
export const PROTECTED_TAGS = new Set(['archived', 'deleted', 'external'])

export function normalizeTagName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, '-')
}

export function isProtectedTagName(name: string): boolean {
  return PROTECTED_TAGS.has(normalizeTagName(name))
}

export function isExternalTagName(name: string): boolean {
  return normalizeTagName(name) === 'external'
}
