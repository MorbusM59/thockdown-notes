import { PROTECTED_TAGS } from './tags'

/**
 * The category tree's grouping, for anything that carries an ordered tag
 * list (notes, images). An item sits in exactly ONE place, chosen by the
 * ORDER of its tags: the first non-protected tag is its primary group (a
 * subsection of the list), the second its secondary (a divider inside it).
 * Tags past the second do not place an item. A missing level falls back to a
 * fixed name, so an untagged item is still placed rather than dropped.
 */
export type TagSecondaryGroup<T> = { name: string; items: T[] }
export type TagPrimaryGroup<T> = { name: string; secondary: TagSecondaryGroup<T>[] }

/** The secondary fallback; the tree draws it unlabelled, as the primary's own contents. */
export const GENERAL_SECONDARY_NAME = 'General'
export const UNCATEGORIZED_PRIMARY_NAME = 'Uncategorized'

export function hierarchyFromTags(tags: readonly string[]): { primary: string; secondary: string } {
  const nonProtected = tags.filter((tag) => !PROTECTED_TAGS.has(tag))
  return {
    primary: nonProtected[0] ?? UNCATEGORIZED_PRIMARY_NAME,
    secondary: nonProtected[1] ?? GENERAL_SECONDARY_NAME,
  }
}

/** Groups keep their items' input order; the group names are sorted case-insensitively at both levels. */
export function buildTagHierarchy<T>(items: readonly T[], tagsOf: (item: T) => readonly string[]): TagPrimaryGroup<T>[] {
  const primaryMap = new Map<string, Map<string, T[]>>()
  for (const item of items) {
    const { primary, secondary } = hierarchyFromTags(tagsOf(item))
    let secondaryMap = primaryMap.get(primary)
    if (!secondaryMap) primaryMap.set(primary, secondaryMap = new Map())
    let bucket = secondaryMap.get(secondary)
    if (!bucket) secondaryMap.set(secondary, bucket = [])
    bucket.push(item)
  }
  const compareLabel = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: 'base' })
  const sorted = <V,>(map: Map<string, V>) => [...map.entries()].sort(([a], [b]) => compareLabel(a, b))
  return sorted(primaryMap).map(([name, secondaryMap]) => ({
    name,
    secondary: sorted(secondaryMap).map(([secondaryName, items]) => ({ name: secondaryName, items })),
  }))
}

export function tagHierarchyContains<T>(groups: readonly TagPrimaryGroup<T>[], matches: (item: T) => boolean): boolean {
  return groups.some((primary) => primary.secondary.some((secondary) => secondary.items.some(matches)))
}
