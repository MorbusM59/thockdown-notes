import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import ts from 'typescript'

/**
 * NO "--" IN ANYTHING A READER SEES.
 *
 * It is an em dash or it is a hyphen; "--" is a typewriter's apology for not
 * having one and it renders as two hyphens. The rule is the author's and it
 * is about the PRODUCT, not about the source: this codebase's comments use
 * " -- " as a house style throughout and deliberately keep it.
 *
 * So the question this asks is "can a reader see this string", and it answers
 * it from the string's POSITION rather than from a list of files somebody has
 * to keep joining -- the same argument as `focusOwnership.ts`'s predicate
 * replacing its allowlist. Three positions qualify:
 *
 *   - anything in `src/adventure/`, which is a game and is text end to end;
 *   - anything in `electron/help/`, which is the shipped documentation;
 *   - a string that lands in a JSX attribute a reader reads (`data-tooltip`,
 *     `aria-label`, `title`, `placeholder`), anywhere in the app.
 *
 * MARKDOWN IS EXEMPT, and only markdown: `---` is a horizontal rule and a
 * table delimiter in the guide's prose, which is syntax and not punctuation.
 * The exemption is for three or more hyphens exactly, so a stray "--" beside
 * a table cannot hide behind it.
 *
 * Parsed with the TypeScript compiler rather than grepped, because the
 * distinction this rests on -- a string literal versus a comment containing
 * the same characters -- is precisely the one a regex cannot draw.
 */

const ROOT = new URL('../..', import.meta.url).pathname

/** Attributes whose value is read by a person rather than by a machine. */
const READER_FACING_ATTRIBUTES = new Set([
  'data-tooltip',
  'aria-label',
  'aria-valuetext',
  'aria-description',
  'title',
  'placeholder',
])

function sourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue
      out.push(...sourceFiles(full))
    } else if (/\.tsx?$/.test(entry.name) && !entry.name.includes('.test.')) {
      out.push(full)
    }
  }
  return out
}

/** Every "--" that is not part of a markdown rule of three or more hyphens. */
function looseDoubleHyphens(text: string): boolean {
  return /(^|[^-])--([^-]|$)/.test(text)
}

/** The text of a literal, including every fixed chunk of a template. */
function literalTexts(node: ts.Node): string[] {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return [node.text]
  if (ts.isTemplateExpression(node)) {
    return [node.head.text, ...node.templateSpans.map((span) => span.literal.text)]
  }
  return []
}

/** Is this literal inside an attribute a reader reads? */
function inReaderFacingAttribute(node: ts.Node): boolean {
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (ts.isJsxAttribute(parent)) return READER_FACING_ATTRIBUTES.has(parent.name.getText())
    // Only walk through the shapes an attribute value can legally take.
    if (
      !ts.isJsxExpression(parent)
      && !ts.isConditionalExpression(parent)
      && !ts.isBinaryExpression(parent)
      && !ts.isParenthesizedExpression(parent)
    ) return false
  }
  return false
}

function offences(): string[] {
  const files = [
    ...sourceFiles(join(ROOT, 'src', 'adventure')),
    ...sourceFiles(join(ROOT, 'electron', 'help')),
    ...sourceFiles(join(ROOT, 'src')).filter((file) => file.endsWith('.tsx')),
  ]
  const found: string[] = []
  for (const file of new Set(files)) {
    const text = readFileSync(file, 'utf8')
    if (!text.includes('--')) continue
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
    const alwaysReaderFacing = file.includes(`${join('src', 'adventure')}`) || file.includes(join('electron', 'help'))
    const visit = (node: ts.Node) => {
      for (const literal of literalTexts(node)) {
        if (!looseDoubleHyphens(literal)) continue
        if (!alwaysReaderFacing && !inReaderFacingAttribute(node)) continue
        const line = source.getLineAndCharacterOfPosition(node.getStart()).line + 1
        found.push(`${relative(ROOT, file)}:${line}  ${literal.replace(/\n/g, '\\n').slice(0, 80)}`)
      }
      ts.forEachChild(node, visit)
    }
    visit(source)
  }
  return found
}

describe('text a reader sees', () => {
  it('never writes "--" where an em dash or a hyphen is meant', () => {
    expect(offences()).toEqual([])
  })

  it('catches a "--" and lets a markdown rule through', () => {
    // The detector itself, checked against both cases -- an exemption that
    // swallowed the rule would make the test above pass by finding nothing.
    expect(looseDoubleHyphens('a -- b')).toBe(true)
    expect(looseDoubleHyphens('a--b')).toBe(true)
    expect(looseDoubleHyphens('--lead')).toBe(true)
    expect(looseDoubleHyphens('| --- | --- |')).toBe(false)
    expect(looseDoubleHyphens('\n---\n')).toBe(false)
    expect(looseDoubleHyphens('an — em dash')).toBe(false)
  })
})
