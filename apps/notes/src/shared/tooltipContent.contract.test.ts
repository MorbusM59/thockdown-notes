// verify: reads-repository (scripts/verify.mjs, "what a test reads from disk")
import { describe, expect, it } from 'vitest'
import { fileURLToPath } from 'node:url'
import { readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import ts from 'typescript'

/**
 * A TOOLTIP'S GESTURES ARE FIELDS, NOT PROSE.
 *
 * The reader chooses which elements of a tooltip they see (Options > Advanced
 * > Tooltips, `@thockdown/interaction/tooltipContent`). A plain tooltip string
 * is read as an INTENTION, so a gesture written into one ("Hold right-click
 * to ...") would show while gestures are switched off and vanish while
 * intentions are. This fails on any string literal in a `data-tooltip` or
 * `data-live-tooltip` attribute that spells out a press; such a press goes in
 * `encodeTooltip`'s `gestures`.
 */

const ROOTS = ['apps/notes/src', 'apps/soundscapes/src', 'packages']
const PRESS_WORDS = /\b(right[- ]?click|left[- ]?click|click to|hold (left|right|to)|right[- ]drag|scroll to)\b/i

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist') continue
    const path = join(dir, entry.name)
    if (entry.isDirectory()) sourceFiles(path, out)
    else if (entry.name.endsWith('.tsx')) out.push(path)
  }
  return out
}

describe('tooltip content', () => {
  it('spells no press out in a tooltip string', () => {
    const repo = fileURLToPath(new URL('../../../..', import.meta.url))
    const offenders: string[] = []
    for (const root of ROOTS) {
      for (const file of sourceFiles(join(repo, root))) {
        const text = readFileSync(file, 'utf8')
        if (!text.includes('tooltip')) continue
        const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
        const visit = (node: ts.Node, inTooltip: boolean) => {
          let inside = inTooltip
          if (ts.isJsxAttribute(node)) {
            const name = node.name.getText(source)
            inside = name === 'data-tooltip' || name === 'data-live-tooltip'
          }
          if (inside && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node))) {
            if (PRESS_WORDS.test(node.text)) {
              const { line } = source.getLineAndCharacterOfPosition(node.getStart(source))
              offenders.push(`${relative(repo, file)}:${line + 1}: ${node.text}`)
            }
          }
          ts.forEachChild(node, (child) => visit(child, inside))
        }
        visit(source, false)
      }
    }
    expect(offenders).toEqual([])
  })
})
