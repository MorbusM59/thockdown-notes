/** Tag applied to freshly-created debug notes; excluded from suggestions like the other protected tags. */
export const DEBUG_TAG_NAME = 'debug'

/** Tags with special lifecycle meaning (archive/trash/external-file status, debug marker) — never freely editable. */
export const PROTECTED_TAGS = new Set(['archived', 'deleted', 'external', DEBUG_TAG_NAME])

export function normalizeTagName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, '-')
}

export function isProtectedTagName(name: string): boolean {
  return PROTECTED_TAGS.has(normalizeTagName(name))
}

export function isExternalTagName(name: string): boolean {
  return normalizeTagName(name) === 'external'
}
