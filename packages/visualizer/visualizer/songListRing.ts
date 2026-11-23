export function listRing<T>(entries: readonly T[]): T[] {
  return [...entries]
}

export function wrapListIndex(index: number, length: number): number {
  if (length <= 0) return 0
  const wrapped = index % length
  return wrapped < 0 ? wrapped + length : wrapped
}

export function shortestListDistance(from: number, to: number, length: number): number {
  if (length <= 0) return 0
  const forward = wrapListIndex(to - from, length)
  return forward * 2 <= length ? forward : forward - length
}
