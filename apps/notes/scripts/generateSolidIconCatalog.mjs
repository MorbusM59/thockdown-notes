// Writes apps/notes/src/sidebar/iconPicker/solidIconCatalog.json: every icon of
// Font Awesome Free's classic solid style, with the words a reader may search
// it by, out of the package's own metadata (5 MB, nearly all of it SVG paths
// the app never needs). Run after updating @fortawesome/fontawesome-free:
//   node apps/notes/scripts/generateSolidIconCatalog.mjs
// solidIconCatalog.test.ts fails while the file is out of date.
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
export const METADATA_PATH = resolve(here, '../../../node_modules/@fortawesome/fontawesome-free/metadata/icon-families.json')
export const CATALOG_PATH = resolve(here, '../src/sidebar/iconPicker/solidIconCatalog.json')

/**
 * The catalog: `[name, words]` per icon, sorted by name. `words` is the
 * label and the search terms, lower-cased, deduplicated, space-separated.
 */
export function buildSolidIconCatalog(metadata) {
  return Object.entries(metadata)
    .filter(([, icon]) => (icon.familyStylesByLicense?.free ?? []).some((style) => style.family === 'classic' && style.style === 'solid'))
    .map(([name, icon]) => {
      const words = new Set([icon.label, ...(icon.search?.terms ?? [])].map((word) => String(word).toLowerCase()))
      words.delete(name)
      return [name, [...words].join(' ')]
    })
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
}

export function serializeCatalog(catalog) {
  return `[\n${catalog.map((entry) => JSON.stringify(entry)).join(',\n')}\n]\n`
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const catalog = buildSolidIconCatalog(JSON.parse(readFileSync(METADATA_PATH, 'utf8')))
  writeFileSync(CATALOG_PATH, serializeCatalog(catalog))
  console.log(`${catalog.length} icons written to ${CATALOG_PATH}`)
}
