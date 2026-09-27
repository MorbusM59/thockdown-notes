import { describe, expect, it } from 'vitest'
import { fileURLToPath } from 'node:url'
import { readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import ts from 'typescript'
import { SECONDARY_PRESS_ATTRIBUTE } from './pressTracking'

/**
 * A control that handles a right-click must SAY so, because nothing else can
 * tell the press tracker whether a secondary press on it means anything --
 * see `pressTracking.ts` on why the event, the fiber and the stylesheets all
 * fail to answer that question.
 *
 * A declaration that has to be remembered is exactly the drift this codebase
 * keeps paying for, so it is not remembered: every `onContextMenu` in the app
 * must carry `data-secondary-press` on the same element, and the value may be
 * computed. What is forbidden is an undecided site, not a conditional one.
 *
 * Parsed with the TypeScript compiler rather than matched with a regex. The
 * question is "does this JSX element have both attributes", and a regex can
 * only approximate the element boundary -- it would also trip over the three
 * places where `handleTrashViewButtonContextMenu` appears as a plain
 * identifier in a list, which are not JSX at all.
 */

const SRC = fileURLToPath(new URL('..', import.meta.url))

function tsxFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...tsxFiles(full))
    else if (entry.name.endsWith('.tsx') && !entry.name.endsWith('.test.tsx')) out.push(full)
  }
  return out
}

function undeclaredSites(file: string): string[] {
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const found: string[] = []

  const visit = (node: ts.Node): void => {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const names = new Set(
        node.attributes.properties
          .filter(ts.isJsxAttribute)
          .map((attribute) => attribute.name.getText(source)),
      )
      if (names.has('onContextMenu') && !names.has(SECONDARY_PRESS_ATTRIBUTE)) {
        const { line } = source.getLineAndCharacterOfPosition(node.getStart(source))
        found.push(`${relative(SRC, file)}:${line + 1} <${node.tagName.getText(source)}>`)
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return found
}

describe('secondary-press declarations', () => {
  it('every onContextMenu site says what a right press on it means', () => {
    const missing = tsxFiles(SRC).flatMap(undeclaredSites)
    expect(missing, `add ${SECONDARY_PRESS_ATTRIBUTE}="action" (it does something) or "none" (it does not) to:\n  ${missing.join('\n  ')}\n`).toEqual([])
  })

  it('catches a site that forgot the declaration', () => {
    // The test above only fails when someone forgets; this one proves it can.
    const probe = ts.createSourceFile('probe.tsx', '<button onContextMenu={f} />', ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
    let seen = 0
    const visit = (node: ts.Node): void => {
      if (ts.isJsxSelfClosingElement(node)) {
        const names = node.attributes.properties.filter(ts.isJsxAttribute).map((a) => a.name.getText(probe))
        if (names.includes('onContextMenu') && !names.includes(SECONDARY_PRESS_ATTRIBUTE)) seen += 1
      }
      ts.forEachChild(node, visit)
    }
    visit(probe)
    expect(seen).toBe(1)
  })
})
