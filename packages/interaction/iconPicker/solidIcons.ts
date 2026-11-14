/**
 * The names (`guitar`, without `fa-`) of the icons a query keeps: every word
 * of it must appear in the icon's name or in its search words, so "music"
 * finds a guitar as well as the music note.
 */
export function filterSolidIcons(catalog: ReadonlyArray<readonly [string, string]>, query: string): string[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  return catalog
    .filter(([name, terms]) => words.every((word) => name.includes(word) || terms.includes(word)))
    .map(([name]) => name)
}
