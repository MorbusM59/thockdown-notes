export function songListCycle<T>(entries: readonly T[]): T[] {
  return [...entries]
}

export function wrapSongListIndex(index: number, length: number): number {
  if (length <= 0) return 0
  const wrapped = index % length
  return wrapped < 0 ? wrapped + length : wrapped
}

export function shortestSongListDistance(from: number, to: number, length: number): number {
  if (length <= 0) return 0
  const forward = wrapSongListIndex(to - from, length)
  return forward * 2 <= length ? forward : forward - length
}
