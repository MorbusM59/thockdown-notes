// verify: reads-repository (scripts/verify.mjs, "what a test reads from disk")
import { describe, expect, it } from 'vitest'
import { fileURLToPath } from 'node:url'
import { readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'

/**
 * NO TWO SOURCE FILES DIFFER ONLY IN CASE.
 *
 * Windows and macOS file systems ignore case, so `DragLayer.tsx` and
 * `dragLayer.ts` side by side are one file there: a checkout keeps only one
 * of them, and the bundler resolves an import of either to whichever is
 * left. On Linux, where the cloud sessions build, both exist and everything
 * passes, so the first sign was a blank desktop window ("does not provide an
 * export named DragLayer"). An extension does not keep two files apart
 * either, since imports leave it out.
 */
const root = join(dirname(fileURLToPath(import.meta.url)), '../../../..')
const SKIPPED = new Set(['node_modules', 'dist', 'build', '.gradle', 'release', 'data'])

function walk(directory: string, found: string[]): void {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || SKIPPED.has(entry.name)) continue
    const path = join(directory, entry.name)
    if (entry.isDirectory()) walk(path, found)
    else if (/\.(tsx?|mjs|cjs|js|css)$/.test(entry.name)) found.push(path)
  }
}

describe('source file names', () => {
  it('no two differ only in case or extension', () => {
    const files: string[] = []
    for (const top of ['apps', 'packages']) walk(join(root, top), files)
    const byKey = new Map<string, string[]>()
    for (const file of files) {
      const key = file.slice(root.length).replace(/\.(tsx?|mjs|cjs|js|css)$/, '').toLowerCase() + (file.endsWith('.css') ? '.css' : '')
      byKey.set(key, [...(byKey.get(key) ?? []), file.slice(root.length + 1)])
    }
    expect([...byKey.values()].filter((paths) => paths.length > 1)).toEqual([])
  })
})
