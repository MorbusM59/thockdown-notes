// verify: reads-repository (scripts/verify.mjs, "what a test reads from disk")
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// @ts-expect-error -- a plain .mjs script, without types
import { buildSolidIconCatalog, CATALOG_PATH, METADATA_PATH, serializeCatalog } from '../../../scripts/generateSolidIconCatalog.mjs'
import { MUSIC_SET_ICON_PATTERN } from '../../shared/audioPlayer'
import { filterSolidIcons } from './musicSetIconPicker'

describe('the solid icon catalog', () => {
  it('is what the installed Font Awesome generates (re-run scripts/generateSolidIconCatalog.mjs)', () => {
    const metadata = JSON.parse(readFileSync(METADATA_PATH, 'utf8'))
    expect(readFileSync(CATALOG_PATH, 'utf8')).toBe(serializeCatalog(buildSolidIconCatalog(metadata)))
  })

  it('names only icons a set may store', () => {
    const catalog = JSON.parse(readFileSync(CATALOG_PATH, 'utf8')) as Array<[string, string]>
    for (const [name] of catalog) expect(`fa-${name}`).toMatch(MUSIC_SET_ICON_PATTERN)
  })
})

describe('filterSolidIcons', () => {
  const catalog: Array<[string, string]> = [
    ['guitar', 'acoustic band music rock'],
    ['headphones', 'audio listen music'],
    ['house', 'home building'],
  ]

  it('keeps everything for an empty query', () => {
    expect(filterSolidIcons(catalog, '  ')).toEqual(['guitar', 'headphones', 'house'])
  })

  it('matches every word against the name or the search words', () => {
    expect(filterSolidIcons(catalog, 'Music')).toEqual(['guitar', 'headphones'])
    expect(filterSolidIcons(catalog, 'music rock')).toEqual(['guitar'])
    expect(filterSolidIcons(catalog, 'head')).toEqual(['headphones'])
  })
})
