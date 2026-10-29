// verify: reads-repository (scripts/verify.mjs, "what a test reads from disk")
import { describe, expect, it } from 'vitest'
import { fileURLToPath } from 'node:url'
import { readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'

// A press is a POINTER event, never a mouse one. A finger produces mouse
// compatibility events only for a tap, after it lifts, so a press, hold or
// drag written on mousedown/mouseup/mousemove cannot be done by touch at all
// (`packages/interaction/touchInput.ts`). A mouse listener is still right
// where the mouse event's own semantics are the point -- focus suppression,
// which `focusOwnership.ts` reads from mousedown, or a trace of it -- and such
// a site says so with a `mouse-default:` comment on the lines above it.
// Hover and leave handlers are not covered: a finger lift fires
// pointerleave, so leave deliberately stays a mouse event.

const ROOTS = [
  fileURLToPath(new URL('..', import.meta.url)),
  fileURLToPath(new URL('../../../soundscapes/src', import.meta.url)),
  fileURLToPath(new URL('../../../../packages', import.meta.url)),
]

const PRESS_HANDLER =
  /\bonMouse(Down|Up|Move)(Capture)?\s*=|addEventListener\(\s*['"]mouse(down|up|move)['"]/
const MARKER_WINDOW = 3

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === 'node_modules') return []
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return sourceFiles(path)
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [path] : []
  })
}

describe('a press is a pointer event', () => {
  it('every mouse press listener declares why it is not a pointer listener', () => {
    const offenders: string[] = []
    for (const root of ROOTS) {
      for (const file of sourceFiles(root)) {
        const lines = readFileSync(file, 'utf8').split('\n')
        lines.forEach((line, index) => {
          if (!PRESS_HANDLER.test(line)) return
          const above = lines.slice(Math.max(0, index - MARKER_WINDOW), index + 1).join('\n')
          if (!above.includes('mouse-default:')) offenders.push(`${relative(root, file)}:${index + 1}`)
        })
      }
    }
    expect(offenders).toEqual([])
  })
})
