export const LIST_RETURN_GRACE_MS = 2000

export type VisibleListEntry<T> =
  | { kind: 'item'; value: T }
  | { kind: 'ellipsis' }

export function maximumListOffset(itemCount: number, slotCount: number): number {
  if (slotCount <= 0 || itemCount <= slotCount) return 0
  if (slotCount === 1) return itemCount - 1
  return itemCount - slotCount
}

export function clampListOffset(offset: number, itemCount: number, slotCount: number): number {
  return Math.max(0, Math.min(maximumListOffset(itemCount, slotCount), Math.floor(offset)))
}

export function visibleListWindow<T>(
  items: readonly T[],
  offset: number,
  slotCount: number,
): VisibleListEntry<T>[] {
  if (slotCount <= 0) return []
  if (items.length <= slotCount) return items.map((value) => ({ kind: 'item', value }))

  const scrollOffset = clampListOffset(offset, items.length, slotCount)
  if (slotCount === 1) {
    return scrollOffset === items.length - 1
      ? [{ kind: 'item', value: items[scrollOffset] }]
      : [{ kind: 'ellipsis' }]
  }

  const above = scrollOffset > 0
  const start = above ? scrollOffset + 1 : 0
  const itemCapacity = slotCount - (above ? 1 : 0)
  const below = start + itemCapacity < items.length
  const itemCount = itemCapacity - (below ? 1 : 0)
  const visible: VisibleListEntry<T>[] = []
  if (above) visible.push({ kind: 'ellipsis' })
  for (const value of items.slice(start, start + itemCount)) visible.push({ kind: 'item', value })
  if (below) visible.push({ kind: 'ellipsis' })
  return visible
}
