import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import ts from 'typescript'

/**
 * A whole-document remark parse never runs on the main thread.
 *
 * This rule was true in intent and false in fact at eight call sites across
 * THREE modules, found on three separate days, each time in the same shape:
 * a `useMemo` computing the parse during React's render phase.
 *
 *   - the block map, in usePreviewMarkdownRendering: 26 seconds on the first
 *     open of a 2MB note in a packaged build, with a worker sitting right
 *     there, built for exactly that parse, that could never win because a
 *     synchronous reader upstream always got the answer first.
 *   - three more behind a single OPTIONAL `blocks` parameter that quietly
 *     parsed when handed none.
 *   - the visible-text projection, in useDocumentFind: 115 seconds on the
 *     first find in render view on the same note.
 *
 * The first fix guarded PreviewBlockSplit's entry points by name, which is
 * why the projection -- a second `unified()` processor, in a different
 * module -- walked straight past it a day later. So the rule is stated once,
 * over every whole-document entry point there is: each may be imported only
 * by the worker that exists to run them, by the client that owns the
 * documented no-worker fallback, and by tests. Everything else on the main
 * thread takes an entry point that cannot parse
 * (`splitPreviewBlocksWithoutFullParse` returns null instead) or awaits the
 * worker.
 *
 * ADD TO THIS LIST when you add a function that parses a whole document.
 * The second case below makes a rename fail loudly rather than silently
 * disarm the first, but nothing can make an omission fail except noticing.
 *
 * Parsed with the TypeScript compiler rather than matched with a regex,
 * because the question is about IMPORT BINDINGS: the same identifiers appear
 * in prose comments across these files (deliberately -- they explain why the
 * call is not there), and a regex cannot tell a comment from a binding.
 */

/** Every function that can parse an entire document, by module. */
const WHOLE_DOCUMENT_PARSE_EXPORTS: Record<string, string[]> = {
  './PreviewBlockSplit': [
    'splitMarkdownIntoPreviewBlocks',
    'splitMarkdownIntoPreviewBlocksIncremental',
    'splitPreviewBlockRangesProgressively',
  ],
  './PreviewVisibleText': [
    'buildPreviewVisibleTextProjection',
    'getPreviewVisibleTextProjection',
    // Not the accumulator trio (createPreviewVisibleTextAccumulator,
    // appendProjectionNodes, finishPreviewVisibleTextProjection): those parse
    // nothing, they walk nodes somebody else parsed. Nor
    // projectionNeedsWholeDocumentParse, which is a line scan.
  ],
  './FindReplaceEngine': [
    // Not the edit-mode sibling `buildDocumentFindHits`, which is an indexOf
    // scan over raw text and belongs on the main thread.
    'buildPreviewVisibleDocumentFindHits',
  ],
}

const FORBIDDEN_IMPORTS = new Set(Object.values(WHOLE_DOCUMENT_PARSE_EXPORTS).flat())

/**
 * The worker runs the parse; the client owns the fallback for an environment
 * that cannot construct one (see documentFactsClient.ts's own doc comment on
 * why that fallback is a slow path rather than a broken one).
 */
const ALLOWED = new Set([
  'editor/documentFacts.worker.ts',
  'editor/documentFactsClient.ts',
  // Its own module: PreviewVisibleText's projection is what the find builder
  // is built out of, and FindReplaceEngine runs only in the worker.
  'editor/FindReplaceEngine.ts',
])

const SRC = new URL('..', import.meta.url).pathname

function sourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...sourceFiles(full))
    else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) out.push(full)
  }
  return out
}

function wholeDocumentParseImports(file: string): string[] {
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const found: string[] = []

  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement)) continue
    const bindings = statement.importClause?.namedBindings
    if (!bindings || !ts.isNamedImports(bindings)) continue
    for (const element of bindings.elements) {
      // `propertyName` is the exported name in `import { a as b }`; without
      // one the local name IS the exported name.
      const imported = (element.propertyName ?? element.name).text
      if (element.isTypeOnly) continue
      if (FORBIDDEN_IMPORTS.has(imported)) found.push(imported)
    }
  }
  return found
}

describe('the whole-document parse contract', () => {
  it('keeps every whole-document parse off the main thread', () => {
    const offenders: string[] = []
    for (const file of sourceFiles(SRC)) {
      const path = relative(SRC, file).split('\\').join('/')
      if (ALLOWED.has(path)) continue
      for (const imported of wholeDocumentParseImports(file)) {
        offenders.push(`${path} imports ${imported}`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('names entry points that actually exist, so a rename cannot silently disarm it', async () => {
    for (const [specifier, names] of Object.entries(WHOLE_DOCUMENT_PARSE_EXPORTS)) {
      const module = (await import(specifier)) as Record<string, unknown>
      for (const name of names) {
        expect(typeof module[name], `${specifier} -> ${name}`).toBe('function')
      }
    }
    const split = await import('./PreviewBlockSplit')
    expect(typeof split.splitPreviewBlocksWithoutFullParse).toBe('function')
  })
})
