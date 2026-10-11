import { PROTECTED_TAGS } from './tags'

/**
 * The category tree's grouping, for anything that carries an ordered tag
 * list (notes, images). An item sits in exactly ONE place, chosen by the
 * ORDER of its tags: the first non-protected tag is its primary group, the
 * second its secondary, the third its tertiary. A missing level falls back
 * to a fixed name, so an untagged item is still placed rather than dropped.
 */
export type TagTertiaryGroup<T> = { name: string; items: T[] }
export type TagSecondaryGroup<T> = { name: string; tertiary: TagTertiaryGroup<T>[] }
export type TagPrimaryGroup<T> = { name: string; secondary: TagSecondaryGroup<T>[] }

/** The secondary fallback; the tree draws it unlabelled, as the primary's own contents. */
export const GENERAL_SECONDARY_NAME = 'General'
export const UNCATEGORIZED_PRIMARY_NAME = 'Uncategorized'

export function hierarchyFromTags(tags: readonly string[], tertiaryFallback: string): { primary: string; secondary: string; tertiary: string } {
  const nonProtected = tags.filter((tag) => !PROTECTED_TAGS.has(tag))
  return {
    primary: nonProtected[0] ?? UNCATEGORIZED_PRIMARY_NAME,
    secondary: nonProtected[1] ?? GENERAL_SECONDARY_NAME,
    tertiary: nonProtected[2] ?? tertiaryFallback,
  }
}

/** Groups keep their items' input order; the group names are sorted case-insensitively at every level. */
export function buildTagHierarchy<T>(items: readonly T[], tagsOf: (item: T) => readonly string[], tertiaryFallback: string): TagPrimaryGroup<T>[] {
  const primaryMap = new Map<string, Map<string, Map<string, T[]>>>()
  for (const item of items) {
    const { primary, secondary, tertiary } = hierarchyFromTags(tagsOf(item), tertiaryFallback)
    let secondaryMap = primaryMap.get(primary)
    if (!secondaryMap) primaryMap.set(primary, secondaryMap = new Map())
    let tertiaryMap = secondaryMap.get(secondary)
    if (!tertiaryMap) secondaryMap.set(secondary, tertiaryMap = new Map())
    let bucket = tertiaryMap.get(tertiary)
    if (!bucket) tertiaryMap.set(tertiary, bucket = [])
    bucket.push(item)
  }
  const compareLabel = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: 'base' })
  const sorted = <V,>(map: Map<string, V>) => [...map.entries()].sort(([a], [b]) => compareLabel(a, b))
  return sorted(primaryMap).map(([name, secondaryMap]) => ({
    name,
    secondary: sorted(secondaryMap).map(([secondaryName, tertiaryMap]) => ({
      name: secondaryName,
      tertiary: sorted(tertiaryMap).map(([tertiaryName, grouped]) => ({ name: tertiaryName, items: grouped })),
    })),
  }))
}

export function tagHierarchyContains<T>(groups: readonly TagPrimaryGroup<T>[], matches: (item: T) => boolean): boolean {
  return groups.some((primary) => primary.secondary.some((secondary) => secondary.tertiary.some((tertiary) => tertiary.items.some(matches))))
}
