import { describe, expect, it } from 'vitest'
import { fileURLToPath } from 'node:url'
import { readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'

// Hover is app state (`packages/interaction/hoverTracking.ts`): stylesheets
// select on `[data-hovered]`, never on `:hover`, which the browser leaves
// stale when content moves under a still pointer. A `:hover` rule beside the
// attribute would light the element the pointer left as well as the one that
// arrived. A scrollbar pseudo-element is the one exception: it has no
// attributes and is never moved by the DOM.

const ROOTS = [
  fileURLToPath(new URL('..', import.meta.url)),
  fileURLToPath(new URL('../../../soundscapes/src', import.meta.url)),
  fileURLToPath(new URL('../../../../packages', import.meta.url)),
]

function cssFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === 'node_modules') return []
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return cssFiles(path)
    return entry.name.endsWith('.css') ? [path] : []
  })
}

describe('hover is state, not :hover', () => {
  it('no stylesheet selects on :hover outside a scrollbar pseudo-element', () => {
    const offenders: string[] = []
    for (const root of ROOTS) {
      for (const file of cssFiles(root)) {
        const css = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
        css.split('\n').forEach((line, index) => {
          if (/(?<!::-webkit-scrollbar-[\w-]+):hover/.test(line)) offenders.push(`${relative(root, file)}:${index + 1}`)
        })
      }
    }
    expect(offenders).toEqual([])
  })
})
