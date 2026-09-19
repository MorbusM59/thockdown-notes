import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import ts from 'typescript'

/**
 * NOTHING SHIPPED IMPORTS `src/adventure/testing/`.
 *
 * The two helpers in this folder exist because five suites walked character
 * creation by hand and eight built a monster by hand, and when creation went
 * from three questions to five and a monster became four vectors, all
 * thirteen broke in the same way. One helper is one place to fix next time.
 *
 * But they live under `src/`, which means nothing about the build stops a
 * shipped module importing one -- and a test fixture reached by the real app
 * is a fixture that can no longer be changed freely, which is the whole
 * value it has. The folder's own doc comments SAY nothing shipped imports it;
 * this is what makes that true rather than hopeful.
 *
 * Parsed with the TypeScript compiler rather than matched with a regex,
 * because the question is about IMPORT SPECIFIERS: the path appears in prose
 * comments in these files (deliberately -- they explain what the folder is
 * for), and a regex cannot tell a comment from an import.
 */

const SRC = join(process.cwd(), 'src')

function sourcesUnder(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) return sourcesUnder(full)
    if (!entry.name.endsWith('.ts') && !entry.name.endsWith('.tsx')) return []
    return [full]
  })
}

/** Every module specifier a file imports from, including type-only ones. */
function importSpecifiers(file: string): string[] {
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.ESNext, true)
  const found: string[] = []
  const visit = (node: ts.Node): void => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node))
      && node.moduleSpecifier
      && ts.isStringLiteral(node.moduleSpecifier)) {
      found.push(node.moduleSpecifier.text)
    }
    // `await import('...')`, which a lazy shipped module could reach for.
    if (ts.isCallExpression(node)
      && node.expression.kind === ts.SyntaxKind.ImportKeyword
      && node.arguments.length > 0
      && ts.isStringLiteral(node.arguments[0])) {
      found.push((node.arguments[0] as ts.StringLiteral).text)
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return found
}

const isTest = (file: string) => file.includes('.test.')
const reachesTesting = (specifier: string) => /(^|\/)testing\/[A-Za-z]/.test(specifier) && specifier.startsWith('.')

describe('the test-only fixtures', () => {
  it('are imported by tests and by nothing else', () => {
    const offenders = sourcesUnder(SRC)
      .filter((file) => !isTest(file))
      .filter((file) => !file.includes(join('adventure', 'testing')))
      .filter((file) => importSpecifiers(file).some(reachesTesting))
      .map((file) => relative(process.cwd(), file))
    expect(offenders).toEqual([])
  })

  it('import nothing that does not exist, so the guard cannot pass by being dead', () => {
    // The check above is a search for something absent, which passes just as
    // happily when the folder has been renamed and the search matches
    // nothing. This is the half that fails loudly instead.
    const fixtures = sourcesUnder(join(SRC, 'adventure', 'testing')).filter((file) => !isTest(file))
    expect(fixtures.length).toBeGreaterThan(0)
    const importers = sourcesUnder(SRC)
      .filter(isTest)
      .filter((file) => importSpecifiers(file).some(reachesTesting))
    expect(importers.length).toBeGreaterThan(0)
  })
})
