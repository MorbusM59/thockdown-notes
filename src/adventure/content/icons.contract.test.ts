import { existsSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import { readdirSync, readFileSync } from 'node:fs'

import { THOCKQUEST } from './thockquest'

/**
 * Every Font Awesome class the adventure names has to exist in the FREE set
 * this app ships. `fa-solid fa-swords` is Pro, and a Pro icon does not fail:
 * it renders as an EMPTY BOX in the ring, which reads as a rendering fault
 * rather than as a missing dependency. Two of them shipped that way already
 * (`fa-lips` for charisma, and this one), which is why the check is a test
 * and not a habit.
 *
 * Read off the shipped package rather than a list, so it cannot go stale.
 */
const SOLID = path.join(
  process.cwd(),
  'node_modules/@fortawesome/fontawesome-free/svgs/solid',
)

function nameOf(iconClass: string): string | null {
  const match = /fa-([a-z0-9-]+)\s*$/.exec(iconClass.trim())
  return match ? match[1] : null
}

/** Every non-test source under a directory, however deep. */
function sourcesUnder(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) return sourcesUnder(full)
    if (!entry.name.endsWith('.ts') && !entry.name.endsWith('.tsx')) return []
    if (entry.name.includes('.test.')) return []
    return [full]
  })
}

function collectIcons(): { icon: string; where: string }[] {
  const found: { icon: string; where: string }[] = []
  for (const cls of THOCKQUEST.monsterClasses) found.push({ icon: cls.icon, where: `class ${cls.id}` })
  for (const origin of THOCKQUEST.origins) found.push({ icon: origin.icon, where: `origin ${origin.id}` })
  for (const region of THOCKQUEST.regions) found.push({ icon: region.icon, where: `region ${region.id}` })
  for (const modifier of [...THOCKQUEST.items, ...THOCKQUEST.traits]) {
    found.push({ icon: modifier.icon, where: `modifier ${modifier.id}` })
  }
  return found
}

describe('every icon the adventure names', () => {
  it('exists in the free set that ships', () => {
    const missing = collectIcons()
      .filter(({ icon }) => {
        const name = nameOf(icon)
        return name === null || !existsSync(path.join(SOLID, `${name}.svg`))
      })
      .map(({ icon, where }) => `${where}: ${icon}`)
    expect(missing).toEqual([])
  })

  it('covers every icon the MODULE names inline, wherever in it they live', () => {
    // Stages write their icons into `present` rather than into content, so a
    // scan of content alone would have missed `fa-swords` -- the one that
    // actually shipped as an empty box. The sources are parsed for the same
    // reason pressTracking.contract.test.ts parses JSX: a hand-kept list of
    // where icons live is the drift hazard the check exists to remove.
    //
    // It scanned `stages/` ALONE at first, which was a list of where icons
    // live wearing a different hat -- and it went stale the moment the spell
    // table and the charm effects put six new glyphs in `model/`. The whole
    // module is walked now, so a glyph named in a file nobody thought of is
    // still checked.
    const missing: string[] = []
    for (const file of sourcesUnder(path.join(process.cwd(), 'src/adventure'))) {
      const source = readFileSync(file, 'utf8')
      // Unquoted on purpose: an icon also appears inside a narration token
      // (`[fa-solid fa-burst|hit]`, see escapeMenu/narrationMarkup.ts), which
      // is built in a template literal and would slip past a pattern that
      // insisted on its own quotes. A false positive here would be a comment
      // naming a real free icon, which costs nothing.
      for (const match of source.matchAll(/fa-(?:solid|regular|brands) (fa-[a-z0-9-]+)/g)) {
        const name = match[1].slice('fa-'.length)
        if (!existsSync(path.join(SOLID, `${name}.svg`))) missing.push(`${path.relative(process.cwd(), file)}: ${match[0]}`)
      }
    }
    expect(missing).toEqual([])
  })
})
