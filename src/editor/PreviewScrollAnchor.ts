export type PreviewSourceAnchorEntry = {
  element: HTMLElement
  line: number
  lineStart: number
  lineEnd: number
  text: string | null
}

export function resolvePreviewSourceAnchorEntry(
  entries: PreviewSourceAnchorEntry[],
  sourceLine: number,
): PreviewSourceAnchorEntry | null {
  if (entries.length === 0) return null

  const sortedEntries = [...entries].sort((a, b) => a.lineStart - b.lineStart)

  const spanningEntry = sortedEntries.find((entry) => entry.lineStart <= sourceLine && sourceLine <= entry.lineEnd)
  if (spanningEntry) {
    return spanningEntry
  }

  const beforeEntry = [...sortedEntries]
    .reverse()
    .find((entry) => entry.lineEnd <= sourceLine)

  if (beforeEntry) {
    return beforeEntry
  }

  return sortedEntries[0]
}
